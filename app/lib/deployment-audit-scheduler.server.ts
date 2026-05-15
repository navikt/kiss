import { and, eq } from "drizzle-orm"
import { db } from "../db/connection.server"
import {
	getAppsWithProdEnvironments,
	touchSyncAttempt,
	upsertDeploymentVerification,
} from "../db/queries/deployment-audit.server"
import {
	createSyncJob,
	markSyncJobCompleted,
	markSyncJobFailed,
	markSyncJobRunning,
	markSyncJobSkipped,
} from "../db/queries/sync-jobs.server"
import { auditLog } from "../db/schema/audit"
import { deploymentVerificationSummaries } from "../db/schema/deployment-audit"
import { getVerificationSummary } from "./deployment-audit.server"
import { withAdvisoryLock } from "./lock.server"
import { logger } from "./logger.server"
import { SYNC_JOB_TYPES } from "./sync-job-types"

const DELAY_BETWEEN_REQUESTS_MS = 200 // Rate limiting: 5 req/sec
const BATCH_SIZE = 50
const NOT_MONITORED_RECHECK_MS = 24 * 60 * 60 * 1000 // 24 hours
const PERFORMER = "deployment-audit-sync"

function buildDeploymentAuditSyncLog(params: {
	processed: number
	succeeded: number
	failed: number
	skippedNotMonitored: number
	durationMs: number
	syncJobId?: string
}) {
	return {
		action: "deployment_verification_synced" as const,
		entityType: "deployment_verification_summary",
		entityId: "batch",
		newValue: JSON.stringify({
			processed: params.processed,
			succeeded: params.succeeded,
			failed: params.failed,
			skippedNotMonitored: params.skippedNotMonitored,
			durationMs: params.durationMs,
		}),
		performedBy: PERFORMER,
		syncJobId: params.syncJobId ?? null,
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

async function syncDeploymentVerifications(syncJobId?: string): Promise<{
	processed: number
	succeeded: number
	failed: number
	skippedNotMonitored: number
	durationMs: number
} | null> {
	return withAdvisoryLock("deployment-audit-sync", async () => {
		const start = Date.now()
		let processed = 0
		let succeeded = 0
		let failed = 0
		let skippedNotMonitored = 0

		try {
			const apps = await getAppsWithProdEnvironments()
			logger.info(`[deployment-audit-sync] Found ${apps.length} apps with prod environments`)

			// Deduplicate by (applicationId, cluster) to avoid double-processing
			const seen = new Set<string>()
			const uniqueApps = apps.filter((app) => {
				const key = `${app.applicationId}:${app.cluster}`
				if (seen.has(key)) return false
				seen.add(key)
				return true
			})

			// Check existing "not_monitored" entries to skip re-checks within 24h
			const existingNotMonitored = new Set<string>()
			for (const app of uniqueApps) {
				const [existing] = await db
					.select({
						status: deploymentVerificationSummaries.status,
						lastSyncAttemptedAt: deploymentVerificationSummaries.lastSyncAttemptedAt,
					})
					.from(deploymentVerificationSummaries)
					.where(
						and(
							eq(deploymentVerificationSummaries.applicationId, app.applicationId),
							eq(deploymentVerificationSummaries.environment, app.cluster),
						),
					)
					.limit(1)

				if (
					existing?.status === "not_monitored" &&
					existing.lastSyncAttemptedAt &&
					Date.now() - existing.lastSyncAttemptedAt.getTime() < NOT_MONITORED_RECHECK_MS
				) {
					existingNotMonitored.add(`${app.applicationId}:${app.cluster}`)
				}
			}

			for (let i = 0; i < uniqueApps.length; i += BATCH_SIZE) {
				const batch = uniqueApps.slice(i, i + BATCH_SIZE)
				const batchNum = Math.floor(i / BATCH_SIZE) + 1
				const totalBatches = Math.ceil(uniqueApps.length / BATCH_SIZE)

				for (const app of batch) {
					const key = `${app.applicationId}:${app.cluster}`

					if (existingNotMonitored.has(key)) {
						skippedNotMonitored++
						continue
					}

					processed++
					try {
						const result = await getVerificationSummary(app.teamSlug, app.cluster, app.appName)

						if (result.data) {
							await upsertDeploymentVerification({
								applicationId: app.applicationId,
								environment: app.cluster,
								teamSlug: app.teamSlug,
								appName: app.appName,
								summary: result.data,
								status: "synced",
								performedBy: PERFORMER,
							})
							succeeded++
						} else if (result.notMonitored) {
							await upsertDeploymentVerification({
								applicationId: app.applicationId,
								environment: app.cluster,
								teamSlug: app.teamSlug,
								appName: app.appName,
								summary: null,
								status: "not_monitored",
								performedBy: PERFORMER,
							})
							skippedNotMonitored++
						} else {
							// Error — preserve existing good data, only update attempt timestamp
							await touchSyncAttempt(app.applicationId, app.cluster, PERFORMER)
							failed++
						}

						await sleep(DELAY_BETWEEN_REQUESTS_MS)
					} catch (err) {
						logger.error("[deployment-audit-sync] Failed to sync app", {
							applicationId: app.applicationId,
							appName: app.appName,
							cluster: app.cluster,
							error: err,
						})
						failed++
					}
				}

				logger.info(`[deployment-audit-sync] Batch ${batchNum}/${totalBatches} complete: ${batch.length} processed`)
			}
		} catch (err) {
			logger.error("[deployment-audit-sync] Sync job failed", err)
			throw err
		}

		const durationMs = Date.now() - start

		if (failed > processed * 0.5 && processed > 0) {
			logger.warn("[deployment-audit-sync] High failure rate", {
				processed,
				failed,
				failureRate: `${Math.round((failed / processed) * 100)}%`,
			})
		}

		if (succeeded > 0 || failed > 0) {
			await db
				.insert(auditLog)
				.values(
					buildDeploymentAuditSyncLog({ processed, succeeded, failed, skippedNotMonitored, durationMs, syncJobId }),
				)
		}

		return { processed, succeeded, failed, skippedNotMonitored, durationMs }
	})
}

/** Run deployment audit sync once (used by unified scheduler). */
export async function runDeploymentAuditSync() {
	const job = await createSyncJob({
		jobType: SYNC_JOB_TYPES.DEPLOYMENT_AUDIT_SYNC,
		performedBy: PERFORMER,
		scopeType: "scheduler",
		scopeId: "deployment-audit-sync",
		message: "Venter på start",
	})
	await markSyncJobRunning(job.id, PERFORMER, "Synkronisering pågår")

	const execution = await syncDeploymentVerifications(job.id).then(
		(result) => ({ ok: true as const, result }),
		(error) => ({ ok: false as const, error }),
	)

	if (!execution.ok) {
		const message = execution.error instanceof Error ? execution.error.message : String(execution.error)
		await markSyncJobFailed(job.id, message, PERFORMER, "Synkronisering feilet")
		logger.error("[deployment-audit-sync] Sync failed", execution.error)
		return
	}

	if (execution.result === null) {
		await markSyncJobSkipped(job.id, "Synkronisering pågår allerede i en annen prosess.", PERFORMER)
		logger.info("[deployment-audit-sync] Skipped — another pod holds the lock")
		return
	}

	await markSyncJobCompleted(
		job.id,
		execution.result,
		PERFORMER,
		`Synkronisering fullført: ${execution.result.succeeded} vellykket, ${execution.result.failed} feilet`,
	)
	logger.info(
		`[deployment-audit-sync] Complete: ${execution.result.succeeded} succeeded, ${execution.result.failed} failed, ${execution.result.skippedNotMonitored} skipped (${execution.result.durationMs}ms)`,
	)
}

export const _testing = { buildDeploymentAuditSyncLog }
