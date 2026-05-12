import type { ActionFunctionArgs } from "react-router"
import { data } from "react-router"
import {
	type ActivityContext,
	getActivityContext,
	isInstanceConfiguredForApp,
	recordEvidenceDownload,
	recordManualEvidenceUpload,
} from "~/db/queries/evidence-downloads.server"
import {
	isOracleEvidenceActivityType,
	type OracleEvidenceActivityType,
	oracleEvidenceTypesForActivity,
} from "~/db/schema/routines"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { requireAnySectionRole } from "~/lib/authorization.server"
import {
	downloadEvidenceFile,
	type EvidenceTypeStatus,
	getEvidenceStatus,
	type OracleEvidenceType,
} from "~/lib/oracle-revisjon.server"
import { isValidUuid } from "~/lib/utils"

const MAX_UPLOAD_SIZE_BYTES = 50 * 1024 * 1024 // 50 MB
const VALID_FORMATS = ["excel", "pdf"]
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

function validateEvidenceType(ctx: ActivityContext, evidenceType: string): void {
	if (!isOracleEvidenceActivityType(ctx.activityType)) {
		throw data({ error: "Aktiviteten er ikke en Oracle-bevistype" }, { status: 400 })
	}
	const allowed = oracleEvidenceTypesForActivity[ctx.activityType as OracleEvidenceActivityType]
	if (!allowed.includes(evidenceType)) {
		throw data({ error: `Bevistypen '${evidenceType}' er ikke tillatt for denne aktiviteten` }, { status: 400 })
	}
}

async function validateInstanceForApp(ctx: ActivityContext, instanceId: string): Promise<void> {
	if (!ctx.applicationId) {
		throw data({ error: "Gjennomgangen mangler applikasjonstilknytning" }, { status: 400 })
	}
	const configured = await isInstanceConfiguredForApp(ctx.applicationId, instanceId)
	if (!configured) {
		throw data({ error: "Oracle-instansen er ikke konfigurert for denne applikasjonen" }, { status: 403 })
	}
}

export async function action({ request }: ActionFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)

	const formData = await request.formData()
	const intent = formData.get("intent") as string

	if (intent === "download-from-api") {
		const instanceId = (formData.get("instanceId") as string)?.trim()
		const evidenceType = (formData.get("evidenceType") as string)?.trim() as OracleEvidenceType
		const format = (formData.get("format") as string)?.trim()?.toLowerCase()
		const activityId = (formData.get("activityId") as string)?.trim()
		const fromUtc = (formData.get("fromUtc") as string)?.trim() || undefined
		const toUtc = (formData.get("toUtc") as string)?.trim() || undefined
		const forceFetchJustification = (formData.get("forceFetchJustification") as string)?.trim() || undefined

		if (!instanceId || !evidenceType || !format || !activityId) {
			return data({ error: "Mangler påkrevde felt" }, { status: 400 })
		}
		if (!isValidUuid(activityId)) {
			return data({ error: "Ugyldig activityId-format" }, { status: 400 })
		}
		if (!VALID_FORMATS.includes(format)) {
			return data({ error: `Ugyldig format: ${format}` }, { status: 400 })
		}
		const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
		if (fromUtc && !DATE_PATTERN.test(fromUtc)) {
			return data({ error: "Ugyldig datoformat for fromUtc (forventet YYYY-MM-DD)" }, { status: 400 })
		}
		if (toUtc && !DATE_PATTERN.test(toUtc)) {
			return data({ error: "Ugyldig datoformat for toUtc (forventet YYYY-MM-DD)" }, { status: 400 })
		}
		if (fromUtc && toUtc && fromUtc > toUtc) {
			return data({ error: "Fra-dato kan ikke være etter til-dato" }, { status: 400 })
		}

		const ctx = await requireWritableActivity(activityId, authedUser)
		validateEvidenceType(ctx, evidenceType)
		await validateInstanceForApp(ctx, instanceId)

		// Period evidence requires date range
		if (evidenceType === "period" && (!fromUtc || !toUtc)) {
			return data({ error: "Periodebevis krever fra- og til-dato" }, { status: 400 })
		}

		// Server-side force-fetch enforcement: require justification for non-OK evidence
		const evidenceStatus = await getEvidenceStatus(instanceId, fromUtc, toUtc)
		let typeStatus: EvidenceTypeStatus | undefined
		if (!evidenceStatus) {
			if (!forceFetchJustification?.trim()) {
				return data({ error: "Kunne ikke verifisere bevisstatus. Begrunnelse er påkrevd." }, { status: 400 })
			}
		} else {
			typeStatus = evidenceStatus.evidenceTypes.find((et) => et.type === evidenceType)
			if (!typeStatus) {
				// Evidence type not found in status response — fail closed, require justification
				if (!forceFetchJustification?.trim()) {
					return data(
						{ error: "Bevistypen ble ikke funnet i statusresponsen. Begrunnelse er påkrevd." },
						{ status: 400 },
					)
				}
			} else if (typeStatus.status !== "OK" && !forceFetchJustification?.trim()) {
				return data(
					{ error: "Beviset er ikke fullført. Begrunnelse er påkrevd for å hente ufullstendig bevis." },
					{ status: 400 },
				)
			}
			// Validate that the requested format is supported for this evidence type
			if (typeStatus && !typeStatus.formats.map((f) => f.toLowerCase()).includes(format)) {
				return data({ error: `Formatet '${format}' er ikke støttet for denne bevistypen` }, { status: 400 })
			}
		}

		let file: { buffer: Buffer; fileName: string; contentType: string }
		try {
			file = await downloadEvidenceFile(instanceId, evidenceType, format as "excel" | "pdf", fromUtc, toUtc)
		} catch {
			return data(
				{ error: "Kunne ikke laste ned bevis fra pensjon-oracle-revisjon. Prøv igjen senere." },
				{ status: 502 },
			)
		}

		if (file.buffer.length > MAX_UPLOAD_SIZE_BYTES) {
			return data({ error: "Filen fra API-et er for stor (maks 50 MB)" }, { status: 400 })
		}

		// Derive metadata from server-side status (not client-supplied values)
		const record = await recordEvidenceDownload({
			activityId,
			instanceId,
			evidenceType,
			providerType: "oracle",
			providerMetadata: {
				instanceId,
				evidenceType,
				apiInstanceName: evidenceStatus?.instanceName ?? null,
				reviewProgressSnapshot: typeStatus?.review ?? null,
			},
			format,
			buffer: file.buffer,
			fileName: file.fileName,
			contentType: file.contentType,
			collectedAt: evidenceStatus?.collectedAt ? new Date(evidenceStatus.collectedAt) : null,
			apiInstanceName: evidenceStatus?.instanceName ?? null,
			forceFetchJustification,
			reviewProgressSnapshot: typeStatus?.review ?? null,
			performedBy: authedUser.navIdent,
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

	if (intent === "upload-manual") {
		const instanceId = (formData.get("instanceId") as string)?.trim()
		const evidenceType = (formData.get("evidenceType") as string)?.trim()
		const activityId = (formData.get("activityId") as string)?.trim()
		const file = formData.get("file") as File | null

		if (!instanceId || !evidenceType || !activityId || !file) {
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

		const ctx = await requireWritableActivity(activityId, authedUser)
		validateEvidenceType(ctx, evidenceType)
		await validateInstanceForApp(ctx, instanceId)

		const arrayBuffer = await file.arrayBuffer()
		const buffer = Buffer.from(arrayBuffer)
		const ext = lowerName.endsWith(".pdf") ? "pdf" : "excel"

		const record = await recordManualEvidenceUpload({
			activityId,
			instanceId,
			evidenceType,
			providerType: "oracle",
			providerMetadata: {
				instanceId,
				evidenceType,
				apiInstanceName: null,
				reviewProgressSnapshot: null,
			},
			format: ext,
			buffer,
			fileName: file.name,
			contentType: file.type || "application/octet-stream",
			performedBy: authedUser.navIdent,
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

	return data({ error: "Ukjent intent" }, { status: 400 })
}
