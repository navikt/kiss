import { runTrackedComplianceSync } from "./compliance-sync-jobs.server"
import { logger } from "./logger.server"

const SYNC_INTERVAL_MS = 15 * 60 * 1000 // 15 minutes
const INITIAL_DELAY_MS = 60 * 1000 // 60 seconds after startup

let intervalId: ReturnType<typeof setInterval> | null = null
let timeoutId: ReturnType<typeof setTimeout> | null = null

async function runSync() {
	try {
		const tracked = await runTrackedComplianceSync({
			performedBy: "compliance-sync",
			scopeType: "scheduler",
			scopeId: "compliance-sync-scheduler",
		})

		if (tracked.result) {
			logger.info(
				`[compliance-sync] Complete: ${tracked.result.synced} synced, ${tracked.result.errors} errors (${tracked.result.durationMs}ms)`,
			)
		} else {
			logger.info("[compliance-sync] Skipped — another pod holds the lock")
		}
	} catch (err) {
		logger.error("[compliance-sync] Sync failed", err)
	}
}

/** Start periodic compliance cache sync. Advisory locks prevent duplicate runs across pods. */
export function startComplianceSyncScheduler() {
	if (intervalId) return

	const enabled = process.env.ENABLE_COMPLIANCE_SYNC === "true"
	if (!enabled) {
		logger.info("[compliance-sync] Disabled (set ENABLE_COMPLIANCE_SYNC=true to enable)")
		return
	}

	logger.info(
		`[compliance-sync] Starting — interval ${SYNC_INTERVAL_MS / 1000}s, initial delay ${INITIAL_DELAY_MS / 1000}s`,
	)

	timeoutId = setTimeout(() => {
		timeoutId = null
		runSync()
		intervalId = setInterval(runSync, SYNC_INTERVAL_MS)
	}, INITIAL_DELAY_MS)
}

/** Stop the scheduler (for graceful shutdown). */
export function stopComplianceSyncScheduler() {
	if (timeoutId) {
		clearTimeout(timeoutId)
		timeoutId = null
	}
	if (intervalId) {
		clearInterval(intervalId)
		intervalId = null
		logger.info("[compliance-sync] Stopped")
	}
}
