import type { ActionFunctionArgs } from "react-router"
import { data } from "react-router"
import {
	type ActivityContext,
	getActivityContext,
	recordEvidenceDownload,
	recordManualEvidenceUpload,
} from "~/db/queries/evidence-downloads.server"
import type { EvidenceProviderType } from "~/db/schema/routines"
import { getProviderTypeForActivity } from "~/lib/activity-types"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { requireAnySectionRole } from "~/lib/authorization.server"
import { getEvidenceProvider, isEvidenceProviderType } from "~/lib/evidence-providers/index.server"
import {
	buildProviderMetadata,
	extractProviderParams,
	getProviderSourceId,
	validateProviderAccess,
	validateProviderDownloadConstraints,
	validateProviderEvidenceType,
} from "~/lib/evidence-providers/validation.server"
import { isValidUuid } from "~/lib/utils"

const MAX_UPLOAD_SIZE_BYTES = 50 * 1024 * 1024 // 50 MB
const VALID_UPLOAD_EXTENSIONS = [".pdf", ".xlsx", ".xls"]

async function requireWritableActivity(
	activityId: string,
	user: Parameters<typeof requireAnySectionRole>[0],
): Promise<ActivityContext> {
	const ctx = await getActivityContext(activityId)
	if (!ctx) throw data({ error: "Aktivitet ikke funnet" }, { status: 404 })
	requireAnySectionRole(user, ctx.sectionId)
	if (ctx.reviewStatus !== "draft") {
		throw data({ error: `Gjennomgangen kan ikke endres (status: ${ctx.reviewStatus})` }, { status: 403 })
	}
	if (ctx.activityStatus !== "pending") {
		throw data({ error: "Aktiviteten er allerede fullført" }, { status: 403 })
	}
	if (ctx.routineArchivedAt) {
		throw data({ error: "Rutinen er arkivert" }, { status: 403 })
	}
	return ctx
}

export async function action({ request }: ActionFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)

	const formData = await request.formData()
	const intent = formData.get("intent") as string
	const providerType = formData.get("providerType") as string

	if (!providerType || !isEvidenceProviderType(providerType)) {
		return data({ error: "Ugyldig eller manglende providerType" }, { status: 400 })
	}

	if (intent === "download-from-api") {
		return handleDownloadFromApi(formData, providerType, authedUser)
	}

	if (intent === "upload-manual") {
		return handleManualUpload(formData, providerType, authedUser)
	}

	if (intent === "generate-report") {
		return handleGenerateReport(formData, providerType, authedUser)
	}

	if (intent === "poll-job") {
		return handlePollJob(formData, providerType, authedUser)
	}

	return data({ error: "Ukjent intent" }, { status: 400 })
}

async function handleDownloadFromApi(
	formData: FormData,
	providerType: EvidenceProviderType,
	user: Parameters<typeof requireAnySectionRole>[0] & { navIdent: string },
) {
	const evidenceType = (formData.get("evidenceType") as string)?.trim()
	const format = (formData.get("format") as string)?.trim()?.toLowerCase()
	const activityId = (formData.get("activityId") as string)?.trim()
	const forceFetchJustification = (formData.get("forceFetchJustification") as string)?.trim() || undefined
	// For NDA, reportId identifies a specific report to download
	const reportId = (formData.get("reportId") as string)?.trim() || undefined

	if (!evidenceType || !format || !activityId) {
		return data({ error: "Mangler påkrevde felt" }, { status: 400 })
	}
	if (providerType === "deployments" && !reportId) {
		return data({ error: "reportId er påkrevd for nedlasting av leveranserapporter" }, { status: 400 })
	}
	if (!isValidUuid(activityId)) {
		return data({ error: "Ugyldig activityId-format" }, { status: 400 })
	}

	const ctx = await requireWritableActivity(activityId, user)
	const providerParams = extractProviderParams(providerType, formData)
	try {
		validateProviderEvidenceType(providerType, evidenceType, ctx)
		await validateProviderAccess(providerType, providerParams, ctx)
		validateProviderDownloadConstraints(providerType, evidenceType, providerParams)
	} catch (err) {
		if (err instanceof Response) return err
		throw err
	}

	// Get current status for force-fetch enforcement
	const provider = await getEvidenceProvider(providerType)
	const evidenceStatus = await provider.getStatus(providerParams)

	let itemStatus: { status: string; details?: Record<string, unknown> } | undefined
	if (!evidenceStatus) {
		if (!forceFetchJustification?.trim()) {
			return data({ error: "Kunne ikke verifisere bevisstatus. Begrunnelse er påkrevd." }, { status: 400 })
		}
	} else {
		const item = evidenceStatus.items.find((it) => it.id === evidenceType)
		if (!item) {
			if (!forceFetchJustification?.trim()) {
				return data({ error: "Bevistypen ble ikke funnet i statusresponsen. Begrunnelse er påkrevd." }, { status: 400 })
			}
		} else {
			itemStatus = item
			if (item.status !== "ok" && !forceFetchJustification?.trim()) {
				return data(
					{ error: "Beviset er ikke fullført. Begrunnelse er påkrevd for å hente ufullstendig bevis." },
					{ status: 400 },
				)
			}
			if (!item.formats.includes(format)) {
				return data({ error: `Formatet '${format}' er ikke støttet for denne bevistypen` }, { status: 400 })
			}
		}
	}

	// Validate reportId belongs to the current period for deployments
	if (providerType === "deployments" && evidenceStatus) {
		const existingReports = (evidenceStatus.metadata?.existingReports ?? []) as Array<{ reportId: string }>
		if (!existingReports.some((r) => r.reportId === reportId)) {
			return data({ error: "reportId finnes ikke for valgt periode" }, { status: 400 })
		}
	}

	let file: { buffer: Buffer; fileName: string; contentType: string }
	try {
		// Deployments use reportId as itemId; other providers use evidenceType
		const itemId = providerType === "deployments" ? reportId! : evidenceType
		file = await provider.downloadFile(providerParams, itemId, format)
	} catch (err) {
		const message = err instanceof Error ? err.message : ""
		// Provider validation errors (invalid format, unsupported type) → 400
		if (message.includes("Unsupported")) {
			return data({ error: message }, { status: 400 })
		}
		return data({ error: "Kunne ikke laste ned bevis fra leverandøren. Prøv igjen senere." }, { status: 502 })
	}

	if (file.buffer.length > MAX_UPLOAD_SIZE_BYTES) {
		return data({ error: "Filen fra API-et er for stor (maks 50 MB)" }, { status: 400 })
	}

	const providerMetadata = buildProviderMetadata(providerType, providerParams, {
		evidenceType,
		apiInstanceName: evidenceStatus?.sourceLabel ?? null,
		reviewProgressSnapshot: itemStatus?.details?.review ?? null,
		...(reportId ? { reportId } : {}),
	})

	const sourceId = getProviderSourceId(providerType, providerParams)

	const record = await recordEvidenceDownload({
		activityId,
		providerType,
		providerMetadata,
		sourceId,
		evidenceType,
		format,
		buffer: file.buffer,
		fileName: file.fileName,
		contentType: file.contentType,
		collectedAt: evidenceStatus?.collectedAt ? new Date(evidenceStatus.collectedAt) : null,
		forceFetchJustification,
		performedBy: user.navIdent,
	})

	return data({
		success: true,
		download: {
			id: record.id,
			fileName: record.fileName,
			sizeBytes: file.buffer.length,
			source: record.source,
			performedAt: record.performedAt.toISOString(),
		},
	})
}

async function handleManualUpload(
	formData: FormData,
	providerType: EvidenceProviderType,
	user: Parameters<typeof requireAnySectionRole>[0] & { navIdent: string },
) {
	const evidenceType = (formData.get("evidenceType") as string)?.trim()
	const activityId = (formData.get("activityId") as string)?.trim()
	const file = formData.get("file") as File | null

	if (!evidenceType || !activityId || !file) {
		return data({ error: "Mangler påkrevde felt" }, { status: 400 })
	}
	if (!isValidUuid(activityId)) {
		return data({ error: "Ugyldig activityId-format" }, { status: 400 })
	}

	if (file.size > MAX_UPLOAD_SIZE_BYTES) {
		return data({ error: "Filen er for stor (maks 50 MB)" }, { status: 400 })
	}

	const lowerName = file.name.toLowerCase()
	if (!VALID_UPLOAD_EXTENSIONS.some((ext) => lowerName.endsWith(ext))) {
		return data({ error: "Ugyldig filtype. Kun PDF og Excel (.xlsx, .xls) er tillatt." }, { status: 400 })
	}

	const ctx = await requireWritableActivity(activityId, user)
	const providerParams = extractProviderParams(providerType, formData)
	try {
		validateProviderEvidenceType(providerType, evidenceType, ctx)
		await validateProviderAccess(providerType, providerParams, ctx)
	} catch (err) {
		if (err instanceof Response) return err
		throw err
	}

	const arrayBuffer = await file.arrayBuffer()
	const buffer = Buffer.from(arrayBuffer)
	const ext = lowerName.endsWith(".pdf") ? "pdf" : "excel"

	const providerMetadata = buildProviderMetadata(providerType, providerParams, {
		evidenceType,
		apiInstanceName: null,
		reviewProgressSnapshot: null,
	})

	const sourceId = getProviderSourceId(providerType, providerParams)

	const record = await recordManualEvidenceUpload({
		activityId,
		providerType,
		providerMetadata,
		sourceId,
		evidenceType,
		format: ext,
		buffer,
		fileName: file.name,
		contentType: file.type || "application/octet-stream",
		performedBy: user.navIdent,
	})

	return data({
		success: true,
		download: {
			id: record.id,
			fileName: record.fileName,
			sizeBytes: buffer.length,
			source: record.source,
			performedAt: record.performedAt.toISOString(),
		},
	})
}

async function handleGenerateReport(
	formData: FormData,
	providerType: EvidenceProviderType,
	user: Parameters<typeof requireAnySectionRole>[0] & { navIdent: string },
) {
	const activityId = (formData.get("activityId") as string)?.trim()
	const reason = (formData.get("reason") as string)?.trim() || undefined

	if (!activityId) {
		return data({ error: "Mangler påkrevde felt" }, { status: 400 })
	}
	if (!isValidUuid(activityId)) {
		return data({ error: "Ugyldig activityId-format" }, { status: 400 })
	}

	const ctx = await requireWritableActivity(activityId, user)

	if (getProviderTypeForActivity(ctx.activityType) !== providerType) {
		return data(
			{ error: `Aktivitetstypen '${ctx.activityType}' støtter ikke provider '${providerType}'` },
			{ status: 400 },
		)
	}

	const providerParams = extractProviderParams(providerType, formData)

	try {
		await validateProviderAccess(providerType, providerParams, ctx)
	} catch (err) {
		if (err instanceof Response) return err
		throw err
	}

	const provider = await getEvidenceProvider(providerType)
	if (!provider.requestGeneration) {
		return data({ error: "Denne leverandøren støtter ikke rapportgenerering" }, { status: 400 })
	}

	try {
		const result = await provider.requestGeneration(providerParams, reason)
		return data({ success: true, jobId: result.jobId })
	} catch (err) {
		if (err instanceof Error && err.name === "NdaConflictError") {
			return data(
				{
					error: "En rapport eksisterer allerede for denne perioden. Oppgi begrunnelse for å erstatte.",
					conflict: true,
				},
				{ status: 409 },
			)
		}
		const message = err instanceof Error ? err.message : "Ukjent feil"
		return data({ error: `Kunne ikke starte rapportgenerering: ${message}` }, { status: 502 })
	}
}

async function handlePollJob(
	formData: FormData,
	providerType: EvidenceProviderType,
	user: Parameters<typeof requireAnySectionRole>[0],
) {
	const activityId = (formData.get("activityId") as string)?.trim()
	const jobId = (formData.get("jobId") as string)?.trim()

	if (!activityId || !jobId) {
		return data({ error: "Mangler påkrevde felt" }, { status: 400 })
	}
	if (!isValidUuid(activityId)) {
		return data({ error: "Ugyldig activityId-format" }, { status: 400 })
	}

	const ctx = await getActivityContext(activityId)
	if (!ctx) return data({ error: "Aktivitet ikke funnet" }, { status: 404 })
	requireAnySectionRole(user, ctx.sectionId)

	if (getProviderTypeForActivity(ctx.activityType) !== providerType) {
		return data(
			{ error: `Aktivitetstypen '${ctx.activityType}' støtter ikke provider '${providerType}'` },
			{ status: 400 },
		)
	}

	const providerParams = extractProviderParams(providerType, formData)

	try {
		await validateProviderAccess(providerType, providerParams, ctx)
	} catch (err) {
		if (err instanceof Response) return err
		throw err
	}

	const provider = await getEvidenceProvider(providerType)
	if (!provider.getJobStatus) {
		return data({ error: "Denne leverandøren støtter ikke jobbstatus" }, { status: 400 })
	}

	try {
		const result = await provider.getJobStatus(providerParams, jobId)
		return data({ success: true, ...result })
	} catch (err) {
		const message = err instanceof Error ? err.message : "Ukjent feil"
		return data({ error: `Kunne ikke sjekke jobbstatus: ${message}` }, { status: 502 })
	}
}
