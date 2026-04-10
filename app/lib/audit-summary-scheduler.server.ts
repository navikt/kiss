import { eq } from "drizzle-orm"
import { db } from "../db/connection.server"
import { applicationPersistence } from "../db/schema/applications"
import { auditLog } from "../db/schema/audit"
import { persistenceAuditSummaries } from "../db/schema/audit-logging"
import { withAdvisoryLock } from "./lock.server"
import { logger } from "./logger.server"
import { getAuditEvidenceSummary, getOracleInstances } from "./oracle-revisjon.server"

const SYNC_INTERVAL_MS = 30 * 60 * 1000 // 30 minutes
const INITIAL_DELAY_MS = 60 * 1000 // 60 seconds after startup
const RETRY_DELAY_MS = 5 * 1000 // 5 seconds retry delay
const PERFORMER = "audit-summary-sync"

let intervalId: ReturnType<typeof setInterval> | null = null
let timeoutId: ReturnType<typeof setTimeout> | null = null

async function fetchSummaryWithRetry(instanceId: string, retries = 1) {
	const result = await getAuditEvidenceSummary(instanceId)
	if (result !== null) return result

	for (let attempt = 0; attempt < retries; attempt++) {
		await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
		const retryResult = await getAuditEvidenceSummary(instanceId)
		if (retryResult !== null) return retryResult
	}

	return null
}

async function syncAuditSummaries(): Promise<{
	processed: number
	succeeded: number
	failed: number
	skipped: number
	durationMs: number
} | null> {
	return withAdvisoryLock("audit-summary-sync", async () => {
		const start = Date.now()
		let processed = 0
		let succeeded = 0
		let failed = 0
		let skipped = 0

		try {
			const oracleInstances = await getOracleInstances()
			const validInstanceIds = new Set(oracleInstances.map((i) => i.id))

			const oraclePersistence = await db
				.select({ id: applicationPersistence.id, name: applicationPersistence.name })
				.from(applicationPersistence)
				.where(eq(applicationPersistence.type, "oracle"))

			for (const entry of oraclePersistence) {
				processed++
				const now = new Date()

				if (!validInstanceIds.has(entry.name)) {
					skipped++
					continue
				}

				try {
					const summary = await fetchSummaryWithRetry(entry.name)

					if (summary) {
						await db
							.insert(persistenceAuditSummaries)
							.values({
								persistenceId: entry.id,
								conclusion: summary.conclusion,
								reason: summary.reason,
								unifiedAuditingEnabled: summary.unifiedAuditingEnabled,
								activePolicyCount: summary.activePolicyCount,
								auditedObjectCount: summary.auditedObjectCount,
								unauditedTableCount: summary.unauditedTableCount,
								excludedUserCount: summary.excludedUserCount,
								policiesWithoutFailureAudit: summary.policiesWithoutFailureAudit,
								hasAuditTrailData: summary.hasAuditTrailData,
								findings: summary.findings,
								fetchedAt: now,
								lastSyncAttemptedAt: now,
								createdBy: PERFORMER,
								updatedBy: PERFORMER,
							})
							.onConflictDoUpdate({
								target: persistenceAuditSummaries.persistenceId,
								set: {
									conclusion: summary.conclusion,
									reason: summary.reason,
									unifiedAuditingEnabled: summary.unifiedAuditingEnabled,
									activePolicyCount: summary.activePolicyCount,
									auditedObjectCount: summary.auditedObjectCount,
									unauditedTableCount: summary.unauditedTableCount,
									excludedUserCount: summary.excludedUserCount,
									policiesWithoutFailureAudit: summary.policiesWithoutFailureAudit,
									hasAuditTrailData: summary.hasAuditTrailData,
									findings: summary.findings,
									fetchedAt: now,
									lastSyncAttemptedAt: now,
									updatedAt: now,
									updatedBy: PERFORMER,
								},
							})
						succeeded++
					} else {
						// Update last_sync_attempted_at even if no data
						await db
							.insert(persistenceAuditSummaries)
							.values({
								persistenceId: entry.id,
								conclusion: "UKJENT",
								reason: "Ingen data tilgjengelig fra oracle-revisjon",
								fetchedAt: now,
								lastSyncAttemptedAt: now,
								createdBy: PERFORMER,
								updatedBy: PERFORMER,
							})
							.onConflictDoUpdate({
								target: persistenceAuditSummaries.persistenceId,
								set: {
									lastSyncAttemptedAt: now,
									updatedAt: now,
									updatedBy: PERFORMER,
								},
							})
						failed++
					}
				} catch (err) {
					logger.error("[audit-summary-sync] Failed to sync instance", {
						persistenceId: entry.id,
						instanceId: entry.name,
						error: err,
					})
					failed++
				}
			}
		} catch (err) {
			logger.error("[audit-summary-sync] Sync job failed", err)
			throw err
		}

		const durationMs = Date.now() - start

		if (failed > processed * 0.5 && processed > 0) {
			logger.warn("[audit-summary-sync] High failure rate", {
				processed,
				failed,
				failureRate: `${Math.round((failed / processed) * 100)}%`,
			})
		}

		// Audit log the sync run
		if (succeeded > 0 || failed > 0) {
			await db.insert(auditLog).values({
				action: "audit_summary_synced",
				entityType: "persistence_audit_summary",
				entityId: "batch",
				newValue: JSON.stringify({ processed, succeeded, failed, skipped, durationMs }),
				performedBy: PERFORMER,
			})
		}

		return { processed, succeeded, failed, skipped, durationMs }
	})
}

async function runSync() {
	try {
		const result = await syncAuditSummaries()
		if (result) {
			logger.info(
				`[audit-summary-sync] Complete: ${result.succeeded} succeeded, ${result.failed} failed, ${result.skipped} skipped (${result.durationMs}ms)`,
			)
		} else {
			logger.info("[audit-summary-sync] Skipped — another pod holds the lock")
		}
	} catch (err) {
		logger.error("[audit-summary-sync] Sync failed", err)
	}
}

/** Start periodic audit summary sync. Advisory locks prevent duplicate runs across pods. */
export function startAuditSummaryScheduler() {
	if (intervalId) return

	const enabled = process.env.ENABLE_AUDIT_SUMMARY_SYNC === "true"
	if (!enabled) {
		logger.info("[audit-summary-sync] Disabled (set ENABLE_AUDIT_SUMMARY_SYNC=true to enable)")
		return
	}

	logger.info(
		`[audit-summary-sync] Starting — interval ${SYNC_INTERVAL_MS / 1000}s, initial delay ${INITIAL_DELAY_MS / 1000}s`,
	)

	timeoutId = setTimeout(() => {
		timeoutId = null
		runSync()
		intervalId = setInterval(runSync, SYNC_INTERVAL_MS)
	}, INITIAL_DELAY_MS)
}

/** Stop the scheduler (for graceful shutdown). */
export function stopAuditSummaryScheduler() {
	if (timeoutId) {
		clearTimeout(timeoutId)
		timeoutId = null
	}
	if (intervalId) {
		clearInterval(intervalId)
		intervalId = null
		logger.info("[audit-summary-sync] Stopped")
	}
}
