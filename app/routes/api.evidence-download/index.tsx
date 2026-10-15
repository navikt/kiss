import { data } from "react-router"
import { getAppScopeIdsForApps } from "~/db/queries/applications.server"
import { getNdaAppParamsGroup } from "~/db/queries/deployment-audit.server"
import {
	type ActivityContext,
	getActivityContext,
	recordEvidenceDownload,
	recordManualEvidenceUpload,
} from "~/db/queries/evidence-downloads.server"
import {
	beginNdaReportGeneration,
	type NdaReportGenerationMode,
	saveNdaReportGenerationState,
} from "~/db/queries/routines.server"
import type { EvidenceProviderType, NdaReportGenerationState, NdaReportSnapshot } from "~/db/schema/routines"
import { getProviderTypeForActivity } from "~/lib/activity-types"
import { requireAuthenticatedUser } from "~/lib/auth.server"
import { requireReviewAccess } from "~/lib/authorization.server"
import { getEvidenceProvider, isEvidenceProviderType } from "~/lib/evidence-providers/index.server"
import {
	buildProviderMetadata,
	extractProviderParams,
	getProviderSourceId,
	validateProviderAccess,
	validateProviderDownloadConstraints,
	validateProviderEvidenceType,
} from "~/lib/evidence-providers/validation.server"
import { withAdvisoryLock } from "~/lib/lock.server"
import { logger } from "~/lib/logger.server"
import { isPeriodEnded, isValidPeriodStart, isValidPeriodType } from "~/lib/period-validation"
import { isValidUuid } from "~/lib/utils"
import type { Route } from "./+types/index"

const MAX_UPLOAD_SIZE_BYTES = 50 * 1024 * 1024 // 50 MB
const VALID_UPLOAD_EXTENSIONS = [".pdf", ".xlsx", ".xls"]

async function requireWritableActivity(
	activityId: string,
	user: Parameters<typeof requireReviewAccess>[0],
): Promise<ActivityContext> {
	const ctx = await getActivityContext(activityId)
	if (!ctx) throw data({ error: "Aktivitet ikke funnet" }, { status: 404 })
	await requireReviewAccess(user, { applicationId: ctx.applicationId, sectionId: ctx.sectionId })
	if (ctx.reviewStatus !== "draft") {
		throw data({ error: `Gjennomgangen kan ikke endres (status: ${ctx.reviewStatus})` }, { status: 403 })
	}
	if (ctx.activityStatus !== "pending") {
		throw data({ error: "Aktiviteten er allerede fullført" }, { status: 403 })
	}
	return ctx
}

const NDA_GENERATION_CONCURRENCY = 2

async function mapWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
	const queue = [...items]
	const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
		for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
			await fn(item)
		}
	})
	await Promise.all(workers)
}

export async function action({ request }: Route.ActionArgs) {
	const authedUser = await requireAuthenticatedUser(request)

	const formData = await request.formData()
	const intent = formData.get("intent") as string
	const providerType = formData.get("providerType") as string

	if (!providerType || !isEvidenceProviderType(providerType)) {
		return data({ error: "Ugyldig eller manglende providerType" }, { status: 400 })
	}

	if ((intent === "download-from-api" || intent === "upload-manual") && providerType === "deployments") {
		return data({ error: "Leveranserapporter lagres når gjennomgangen fullføres" }, { status: 400 })
	}

	if (intent === "download-from-api") {
		return handleDownloadFromApi(formData, providerType, authedUser)
	}

	if (intent === "upload-manual") {
		return handleManualUpload(formData, providerType, authedUser)
	}

	if (intent === "generate-report-set") {
		return handleGenerateReportSet(formData, providerType, authedUser)
	}

	if (intent === "poll-job") {
		return handlePollJob(formData, providerType, authedUser)
	}

	return data({ error: "Ukjent intent" }, { status: 400 })
}

async function handleGenerateReportSet(
	formData: FormData,
	providerType: EvidenceProviderType,
	user: Awaited<ReturnType<typeof requireAuthenticatedUser>>,
) {
	const activityId = (formData.get("activityId") as string)?.trim()
	const periodType = (formData.get("periodType") as string)?.trim()
	const periodStart = (formData.get("periodStart") as string)?.trim()
	const mode = formData.get("mode") as NdaReportGenerationMode

	if (!activityId || !isValidUuid(activityId)) {
		return data({ error: "Mangler gyldig activityId" }, { status: 400 })
	}
	if (providerType !== "deployments") {
		return data({ error: "Rapportgenerering støttes bare for leveranserapporter" }, { status: 400 })
	}
	if (!periodType || !isValidPeriodType(periodType) || !periodStart || !isValidPeriodStart(periodType, periodStart)) {
		return data({ error: "Ugyldig eller manglende rapportperiode" }, { status: 400 })
	}
	if (!isPeriodEnded(periodType, periodStart)) {
		return data({ error: "Perioden er ikke avsluttet ennå" }, { status: 400 })
	}
	if (!["initial", "refresh"].includes(mode)) {
		return data({ error: "Ugyldig modus for rapportgenerering" }, { status: 400 })
	}

	const ctx = await requireWritableActivity(activityId, user)
	if (getProviderTypeForActivity(ctx.activityType) !== providerType) {
		return data({ error: "Aktiviteten støtter ikke generering av leveranserapporter" }, { status: 400 })
	}
	if (!ctx.applicationId) {
		return data({ error: "Aktiviteten mangler applikasjon" }, { status: 409 })
	}

	// Tilgang gis på gjennomgangens applikasjon og gjelder hele den sammenslåtte gruppen; sammenslåing krever forvaltningstilgang til alle medlemmene.
	const appsGroup = await getNdaAppParamsGroup(ctx.applicationId, ctx.sectionId)
	const scopeByApp = await getAppScopeIdsForApps(appsGroup.map((app) => app.applicationId))
	const apps = appsGroup
		.filter((app) => scopeByApp.get(app.applicationId)?.sectionIds.includes(ctx.sectionId))
		.map(({ applicationId, team, environment, appName }) => ({ applicationId, team, environment, appName }))
	if (apps.length === 0) {
		return data({ error: "Fant ingen applikasjoner med rapporter i valgt periode" }, { status: 409 })
	}
	const provider = await getEvidenceProvider(providerType)
	if (!provider.requestGeneration) {
		return data({ error: "NDA støtter ikke rapportgenerering" }, { status: 400 })
	}

	const selectedPeriodCtx: ActivityContext = { ...ctx, periodConfig: { ...ctx.periodConfig, periodType, periodStart } }
	const lockName = `${ctx.activityType}-activity-${activityId}`
	let result: boolean | null
	try {
		result = await withAdvisoryLock(lockName, async () => {
			const { targets } = await beginNdaReportGeneration({
				activityId,
				periodConfig: { periodType, periodStart },
				apps,
				mode,
			})
			if (targets.length === 0) {
				return true
			}

			await mapWithConcurrency(targets, NDA_GENERATION_CONCURRENCY, async (target) => {
				let nextState: NdaReportGenerationState
				try {
					const providerParams = {
						team: target.team,
						environment: target.environment,
						appName: target.appName,
						periodType,
						periodStart,
					}
					await validateProviderAccess(providerType, providerParams, selectedPeriodCtx)
					const response = await provider.requestGeneration?.(providerParams, makeNdaGenerationReason(ctx, user.name))
					if (!response?.jobId) throw new Error("NDA startet ikke rapportgenereringen.")
					nextState = { ...target, jobId: response.jobId, status: "pending", error: null }
				} catch (error) {
					const message = await getGenerationErrorMessage(error)
					logger.warn(
						`NDA report generation request failed [activityId=${activityId}, app=${target.appName}]`,
						error instanceof Error ? error : new Error(message),
					)
					nextState = { ...target, jobId: null, status: "failed", error: message }
				}

				const saved = await saveNdaReportGenerationState({
					activityId,
					periodConfig: { periodType, periodStart },
					state: nextState,
				})
				if (!saved) {
					throw new Response("Rapportene ble oppdatert i en annen fane. Last siden på nytt.", { status: 409 })
				}
			})

			return true
		})
	} catch (error) {
		if (error instanceof Response) {
			return data({ error: (await error.text()) || "Kunne ikke starte rapportgenereringen." }, { status: error.status })
		}
		throw error
	}

	if (result === null) {
		return data(
			{ error: "Rapportgenerering pågår allerede for denne gjennomgangen. Prøv igjen om litt." },
			{ status: 409 },
		)
	}
	return data({ success: true })
}

function makeNdaGenerationReason(ctx: ActivityContext, userName: string): string {
	return `Ny rapport generert for rutinegjennomgang - ${ctx.routineName} - ${userName}`
}

async function getGenerationErrorMessage(error: unknown): Promise<string> {
	if (error instanceof Response) {
		const message = await error.text()
		return message || "NDA kunne ikke starte rapportgenereringen."
	}
	if (error instanceof Error && error.name === "NdaConflictError") {
		return error.message
	}
	return "NDA kunne ikke starte rapportgenereringen. Prøv på nytt."
}

async function handleDownloadFromApi(
	formData: FormData,
	providerType: EvidenceProviderType,
	user: Parameters<typeof requireReviewAccess>[0] & { navIdent: string },
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
		const itemId = providerType === "deployments" ? (reportId ?? evidenceType) : evidenceType
		file = await provider.downloadFile(providerParams, itemId, format)
	} catch (err) {
		const message = err instanceof Error ? err.message : ""
		// Provider validation errors (invalid format, unsupported type) → 400
		if (message.includes("Unsupported")) {
			return data({ error: "Formatet eller bevistypen støttes ikke av leverandøren." }, { status: 400 })
		}
		logger.error(
			`Evidence download failed [providerType=${providerType}]`,
			err instanceof Error ? err : new Error(String(err)),
		)
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
		expectedPeriodConfig: providerType === "deployments" ? ctx.periodConfig : undefined,
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
	user: Parameters<typeof requireReviewAccess>[0] & { navIdent: string },
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
		expectedPeriodConfig: providerType === "deployments" ? ctx.periodConfig : undefined,
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

async function handlePollJob(
	formData: FormData,
	providerType: EvidenceProviderType,
	user: Parameters<typeof requireReviewAccess>[0],
) {
	const activityId = (formData.get("activityId") as string)?.trim()
	const jobId = (formData.get("jobId") as string)?.trim()

	if (!activityId || !jobId) {
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
	if (!provider.getJobStatus) {
		return data({ error: "Denne leverandøren støtter ikke jobbstatus" }, { status: 400 })
	}

	const currentState =
		providerType === "deployments"
			? ctx.periodConfig?.reportGeneration?.apps.find(
					(app) =>
						app.jobId === jobId &&
						app.team === String(providerParams.team) &&
						app.environment === String(providerParams.environment) &&
						app.appName === String(providerParams.appName),
				)
			: undefined
	if (providerType === "deployments" && !currentState) {
		return data({ error: "Jobben tilhører ikke gjeldende rapportgenerering. Last siden på nytt." }, { status: 409 })
	}

	try {
		const result = await provider.getJobStatus(providerParams, jobId)
		if (providerType === "deployments" && (result.status === "completed" || result.status === "failed")) {
			if (currentState && ctx.periodConfig) {
				let nextState: NdaReportGenerationState
				if (result.status === "failed") {
					nextState = {
						...currentState,
						status: "failed",
						report: null,
						error: result.error || "NDA klarte ikke å generere rapporten.",
					}
				} else {
					const resultData = result.result
					const report = isRecord(resultData) ? parseNdaReportSnapshot(resultData.report) : null
					if (
						!report ||
						report.periodType !== ctx.periodConfig.periodType ||
						report.periodStart !== ctx.periodConfig.periodStart
					) {
						nextState = {
							...currentState,
							status: "failed",
							report,
							error: "NDA fullførte jobben, men returnerte ikke en rapport for valgt periode.",
						}
					} else {
						const available = new Set(report.availableFormats.map(normalizeReportFormat))
						const missingFormats = ["pdf", "excel"].filter((format) => !available.has(format))
						nextState = {
							...currentState,
							status: missingFormats.length === 0 ? "ready" : "failed",
							report,
							error:
								missingFormats.length === 0
									? null
									: `Rapporten mangler ${missingFormats.map((format) => format.toUpperCase()).join(" og ")}.`,
						}
					}
				}
				const saved = await saveNdaReportGenerationState({
					activityId,
					periodConfig: {
						periodType: ctx.periodConfig.periodType,
						periodStart: ctx.periodConfig.periodStart,
					},
					state: nextState,
				})
				if (!saved) {
					return data({ error: "Rapportene ble oppdatert i en annen fane. Last siden på nytt." }, { status: 409 })
				}
			}
		}
		return data({ success: true, ...result })
	} catch (err) {
		logger.error(
			`Evidence job status poll failed [providerType=${providerType}, jobId=${jobId}]`,
			err instanceof Error ? err : new Error(String(err)),
		)
		return data({ error: "Kunne ikke sjekke jobbstatus. Prøv igjen senere." }, { status: 502 })
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
}

function parseNdaReportSnapshot(value: unknown): NdaReportSnapshot | null {
	if (!isRecord(value)) return null
	const {
		reportId,
		periodType,
		periodStart,
		periodEnd,
		periodLabel,
		generatedAt,
		generatedBy,
		totalDeployments,
		approvedCount,
		withChangeOriginCount,
		contentHash,
		availableFormats,
	} = value
	if (
		typeof reportId !== "string" ||
		typeof periodType !== "string" ||
		!isValidPeriodType(periodType) ||
		typeof periodStart !== "string" ||
		typeof periodEnd !== "string" ||
		typeof periodLabel !== "string" ||
		typeof generatedAt !== "string" ||
		Number.isNaN(new Date(generatedAt).getTime()) ||
		!(generatedBy === null || typeof generatedBy === "string") ||
		typeof totalDeployments !== "number" ||
		typeof approvedCount !== "number" ||
		!(withChangeOriginCount === null || typeof withChangeOriginCount === "number") ||
		typeof contentHash !== "string" ||
		!Array.isArray(availableFormats) ||
		!availableFormats.every((format) => typeof format === "string")
	) {
		return null
	}
	return {
		reportId,
		periodType,
		periodStart,
		periodEnd,
		periodLabel,
		generatedAt,
		generatedBy,
		totalDeployments,
		approvedCount,
		withChangeOriginCount,
		contentHash,
		availableFormats,
	}
}

function normalizeReportFormat(format: string): string {
	return format.toLowerCase() === "xlsx" ? "excel" : format.toLowerCase()
}
