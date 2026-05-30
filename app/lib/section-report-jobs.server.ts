import { PassThrough } from "node:stream"
import archiver from "archiver"
import { eq } from "drizzle-orm"
import { db } from "~/db/connection.server"
import { buildAppComplianceArtifact, createSectionBatchReport, updateReportStatus } from "~/db/queries/reports.server"
import {
	createSyncJob,
	markSyncJobCompleted,
	markSyncJobFailed,
	markSyncJobRunning,
} from "~/db/queries/sync-jobs.server"
import { reports } from "~/db/schema/reports"
import { logger } from "~/lib/logger.server"
import { getStorageProvider } from "~/lib/storage/index.server"
import { SYNC_JOB_TYPES } from "~/lib/sync-job-types"

export interface SectionBatchReportParams {
	sectionId: string
	sectionName: string
	sectionSlug: string
	selectedAppIds: string[]
	includeReviews: boolean
	includeAttachments: boolean
	includeRoutineDescription: boolean
	createdBy: string
}

export interface SectionBatchReportJob {
	reportId: string
	jobId: string
}

/**
 * Creates a pending report record and a sync job, then fires the generation in the background.
 * Returns immediately with reportId + jobId so the UI can poll for status.
 */
export async function startSectionBatchReport(params: SectionBatchReportParams): Promise<SectionBatchReportJob> {
	const reportId = await createSectionBatchReport({
		sectionId: params.sectionId,
		sectionName: params.sectionName,
		createdBy: params.createdBy,
	})

	const job = await createSyncJob({
		jobType: SYNC_JOB_TYPES.SECTION_BATCH_REPORT,
		performedBy: params.createdBy,
		scopeType: "section",
		scopeId: params.sectionId,
		message: `Batch-rapport for ${params.selectedAppIds.length} applikasjoner`,
	})

	// Fire and forget — generation continues after HTTP response is sent
	void runSectionBatchReportGeneration(reportId, job.id, params).catch((err) => {
		logger.error("Section batch report generation failed unexpectedly", { reportId, jobId: job.id, error: err })
	})

	return { reportId, jobId: job.id }
}

async function runSectionBatchReportGeneration(
	reportId: string,
	jobId: string,
	params: SectionBatchReportParams,
): Promise<void> {
	const { sectionSlug, selectedAppIds, includeReviews, includeAttachments, includeRoutineDescription, createdBy } =
		params

	await Promise.all([
		markSyncJobRunning(jobId, createdBy, "Genererer rapport…"),
		updateReportStatus(reportId, "running", "Forbereder generering…"),
	])

	// Declare streams outside try so catch block can clean them up
	const archive = archiver("zip", { zlib: { level: 6 } })
	const passThrough = new PassThrough()

	try {
		const storage = getStorageProvider()
		const now = new Date()
		const datePrefix = now.toISOString().slice(0, 10)
		const fileId = crypto.randomUUID()
		const zipPath = `reports/section/${sectionSlug}/${datePrefix}/${fileId}/rapport.zip`

		// Set up streaming archiver → passthrough → storage upload (concurrent)
		archive.pipe(passThrough)

		// Start the storage upload immediately — it consumes the passThrough stream as archiver produces data.
		// Attach .catch so early-exit paths (e.g. thrown before await uploadPromise) don't produce unhandled rejections.
		const uploadPromise = storage.uploadStream(zipPath, passThrough, { contentType: "application/zip" })
		uploadPromise.catch((err) => {
			logger.warn("uploadStream rejected (may already be handled in catch block)", { reportId, error: err })
		})

		archive.on("warning", (err) => {
			if (err.code !== "ENOENT") {
				logger.warn("Archiver warning during section batch report", { reportId, error: err })
			}
		})

		archive.on("error", (err) => {
			logger.error("Archiver error during section batch report", { reportId, error: err })
			passThrough.destroy(err)
		})

		let processedApps = 0
		let includedApps = 0
		const totalApps = selectedAppIds.length

		// Generate each app's artifact sequentially — only one PDF in memory at a time
		for (const appId of selectedAppIds) {
			await updateReportStatus(reportId, "running", `Genererer rapport ${processedApps + 1} av ${totalApps}…`)

			let artifact: Awaited<ReturnType<typeof buildAppComplianceArtifact>>
			try {
				artifact = await buildAppComplianceArtifact({
					applicationId: appId,
					includeReviews,
					includeAttachments,
					includeRoutineDescription,
				})
			} catch (err) {
				logger.warn("Failed to build artifact for app in section batch report", { reportId, appId, error: err })
				processedApps++
				continue
			}

			const safeAppName = artifact.appName.replace(/[^a-zA-Z0-9æøåÆØÅ _-]/g, "_").slice(0, 60)

			archive.append(artifact.pdf, { name: `${safeAppName}/rapport.pdf` })

			if (artifact.nonPdfAttachments.length > 0) {
				const usedNames = new Set<string>()
				for (const att of artifact.nonPdfAttachments) {
					// Sanitize the filename to prevent Zip-Slip path traversal
					const safeFileName = att.fileName.replace(/[/\\]/g, "_").replace(/\.\./g, "_")
					const safeReview = att.reviewTitle.replace(/[^a-zA-Z0-9æøåÆØÅ _-]/g, "_").slice(0, 50)
					const folder = `${att.reviewDate}-${safeReview}`
					const subFolder = att.followUpPointText
						? `/oppfolgingspunkter/${att.followUpPointText.replace(/[^a-zA-Z0-9æøåÆØÅ _-]/g, "_").slice(0, 50)}${att.followUpKind === "description" ? " (beskrivelse)" : " (oppfølging)"}`
						: ""
					let entryName = `${safeAppName}/vedlegg/${folder}${subFolder}/${safeFileName}`
					if (usedNames.has(entryName)) {
						const ext = safeFileName.includes(".") ? `.${safeFileName.split(".").pop()}` : ""
						const base = safeFileName.includes(".")
							? safeFileName.slice(0, safeFileName.lastIndexOf("."))
							: safeFileName
						let counter = 2
						do {
							entryName = `${safeAppName}/vedlegg/${folder}${subFolder}/${base} (${counter})${ext}`
							counter++
						} while (usedNames.has(entryName))
					}
					usedNames.add(entryName)
					archive.append(att.data, { name: entryName })
				}
			}

			includedApps++
			processedApps++
		}

		await updateReportStatus(reportId, "running", "Pakker zip-fil…")
		archive.finalize()

		const uploadResult = await uploadPromise

		// Update report with completed status and bucket path
		await db
			.update(reports)
			.set({
				reportBucketPath: zipPath,
				status: "completed",
				progressMessage: `${includedApps} av ${totalApps} applikasjoner inkludert`,
				updatedAt: new Date(),
			})
			.where(eq(reports.id, reportId))

		// Handle sync-job completion separately — a persist failure here must not mark the report as failed,
		// since the ZIP is already uploaded and the report row is already completed.
		try {
			await markSyncJobCompleted(
				jobId,
				{ reportId, zipPath, appsIncluded: includedApps, totalApps, sizeBytes: uploadResult.sizeBytes },
				createdBy,
				`Rapport fullført: ${includedApps} av ${totalApps} applikasjoner`,
			)
		} catch (completionErr) {
			logger.error("Failed to persist sync job completion, but report was successfully generated", {
				reportId,
				jobId,
				error: completionErr,
			})
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		logger.error("Section batch report generation failed", { reportId, jobId, error: err })
		archive.abort()
		passThrough.destroy()
		await Promise.allSettled([
			updateReportStatus(reportId, "failed", `Feil: ${message}`),
			markSyncJobFailed(jobId, message, createdBy, "Rapportgenerering feilet"),
		])
	}
}
