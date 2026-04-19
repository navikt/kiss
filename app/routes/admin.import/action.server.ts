import type { ActionFunctionArgs } from "react-router"
import { data } from "react-router"
import { saveBucketObject } from "~/db/queries/buckets.server"
import {
	applyFrameworkImport,
	computeImportDiff,
	discardPendingImport,
	getActiveFrameworkVersion,
	getPendingFrameworkImport,
	stageFrameworkImport,
} from "~/db/queries/framework.server"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { requireAdmin } from "~/lib/authorization.server"
import {
	type ParsedFramework,
	type ParsedFrameworkRow,
	parseFrameworkExcel,
	summarizeFramework,
} from "~/lib/excel-parser.server"
import { getStorageProvider } from "~/lib/storage/index.server"
import { type ActionResult, MAX_SIZE, MAX_SIZE_MB, type SerializedControl } from "./shared"

function serializeControls(rows: Iterable<ParsedFrameworkRow>): SerializedControl[] {
	return Array.from(rows).map((row) => ({
		controlId: row.controlId,
		domain: row.domain,
		riskId: row.riskId,
		riskDescription: row.riskDescription,
		technologyElement: row.technologyElement,
		requirement: row.requirement,
		responsible: row.responsible,
		routine: row.routine,
		frequency: row.frequency,
		documentationRequirement: row.documentationRequirement,
		testProcedure: row.testProcedure,
		dependencies: row.dependencies,
		references: row.references,
		commonPitfalls: row.commonPitfalls,
	}))
}

async function loadPreviousParsed(): Promise<ParsedFramework | undefined> {
	const storage = getStorageProvider()
	const activeVersion = await getActiveFrameworkVersion()
	if (!activeVersion?.sourceBucketPath) return undefined
	try {
		const prevBuffer = await storage.download(activeVersion.sourceBucketPath)
		if (prevBuffer.byteLength > MAX_SIZE) {
			console.warn(
				`[admin.import] Forrige aktive xlsx (${activeVersion.sourceBucketPath}) er ${prevBuffer.byteLength} bytes — over MAX_SIZE; hopper over diff.`,
			)
			return undefined
		}
		return parseFrameworkExcel(prevBuffer)
	} catch {
		// Previous file unavailable — treat all changes as xlsx-changed
		return undefined
	}
}

const TOO_LARGE_ERROR = `Lagret fil er større enn ${MAX_SIZE_MB} MB. Kontakt en administrator.`

export async function action({ request }: ActionFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	requireAdmin(authedUser)
	const userName = authedUser.navIdent
	const formData = await request.formData()
	const intent = formData.get("intent")

	if (intent === "discard") {
		await discardPendingImport()
		return data<ActionResult>({ discarded: true })
	}

	if (intent === "continue") {
		try {
			const pending = await getPendingFrameworkImport()
			if (!pending) {
				return data<ActionResult>({ success: false, error: "Ingen ventende import funnet." })
			}
			const storage = getStorageProvider()
			const fileBuffer = await storage.download(pending.sourceBucketPath)
			if (fileBuffer.byteLength > MAX_SIZE) {
				return data<ActionResult>({ success: false, error: TOO_LARGE_ERROR })
			}
			const parsed = parseFrameworkExcel(fileBuffer)

			const previousParsed = await loadPreviousParsed()
			const stagingDiff = await computeImportDiff(parsed, previousParsed)
			const summary = summarizeFramework(parsed)

			return data<ActionResult>({
				success: true,
				versionId: pending.id,
				stagingDiff,
				summary: {
					domainCount: summary.domains.size,
					riskCount: summary.risks.size,
					controlCount: summary.controls.size,
					fileName: pending.sourceFileName,
					uploadedAt: pending.createdAt.toISOString(),
					uploadedBy: pending.createdBy,
					controls: serializeControls(summary.controls.values()),
				},
			})
		} catch (err) {
			return data<ActionResult>({
				success: false,
				error: err instanceof Error ? err.message : "Ukjent feil ved lasting av ventende import.",
			})
		}
	}

	if (intent === "activate") {
		try {
			const pending = await getPendingFrameworkImport()
			if (!pending) {
				return data<ActionResult>({
					success: false,
					error: "Ingen ventende import funnet. Last opp en fil først.",
				})
			}

			const excludedRaw = formData.get("excludedChanges")
			const excludedChanges = excludedRaw ? new Set<string>(JSON.parse(String(excludedRaw)) as string[]) : undefined

			const storage = getStorageProvider()
			const fileBuffer = await storage.download(pending.sourceBucketPath)
			if (fileBuffer.byteLength > MAX_SIZE) {
				return data<ActionResult>({ success: false, error: TOO_LARGE_ERROR })
			}
			const parsed = parseFrameworkExcel(fileBuffer)

			await applyFrameworkImport(pending.id, parsed, userName, [], excludedChanges)
			return data<ActionResult>({ activated: true })
		} catch (err) {
			return data<ActionResult>({
				success: false,
				error: err instanceof Error ? err.message : "Ukjent feil ved aktivering.",
			})
		}
	}

	const file = formData.get("file")

	if (!file || !(file instanceof File) || file.size === 0) {
		return data<ActionResult>({
			success: false,
			error: "Ingen fil valgt. Vennligst last opp en .xlsx-fil.",
		})
	}

	if (!file.name.endsWith(".xlsx")) {
		return data<ActionResult>({
			success: false,
			error: "Ugyldig filformat. Kun .xlsx-filer støttes.",
		})
	}

	if (file.size > MAX_SIZE) {
		return data<ActionResult>({
			success: false,
			error: `Filen er for stor. Maks ${MAX_SIZE_MB} MB.`,
		})
	}

	try {
		const arrayBuffer = await file.arrayBuffer()
		const buffer = Buffer.from(arrayBuffer)
		const parsed = parseFrameworkExcel(buffer)
		const summary = summarizeFramework(parsed)

		const bucketName = process.env.GCS_BUCKET_NAME ?? "kiss-data-local"
		const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_")
		const bucketPath = `framework-uploads/${Date.now()}-${sanitizedName}`
		const contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
		const storage = getStorageProvider()
		const uploadResult = await storage.upload(bucketPath, buffer, { contentType })

		await saveBucketObject({
			bucketName,
			objectPath: uploadResult.path,
			contentType: uploadResult.contentType,
			sizeBytes: uploadResult.sizeBytes,
			objectType: "framework-import",
			uploadedBy: userName,
			metadata: { originalFileName: file.name },
		})

		const versionId = await stageFrameworkImport(parsed, file.name, userName, uploadResult.path)

		const previousParsed = await loadPreviousParsed()
		const stagingDiff = await computeImportDiff(parsed, previousParsed)

		return data<ActionResult>({
			success: true,
			versionId,
			stagingDiff,
			summary: {
				domainCount: summary.domains.size,
				riskCount: summary.risks.size,
				controlCount: summary.controls.size,
				fileName: file.name,
				uploadedAt: new Date().toISOString(),
				uploadedBy: userName,
				controls: serializeControls(summary.controls.values()),
			},
		})
	} catch (err) {
		return data<ActionResult>({
			success: false,
			error: err instanceof Error ? err.message : "Ukjent feil ved parsing av fil.",
		})
	}
}
