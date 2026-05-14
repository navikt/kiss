import { logger } from "./logger.server"
import { runTrackedNaisSync } from "./nais-sync-jobs.server"

const SYNC_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes
const INITIAL_DELAY_MS = 30 * 1000 // 30 seconds after startup

let intervalId: ReturnType<typeof setInterval> | null = null

async function runSync() {
	const token = process.env.NAIS_API_KEY || process.env.NAIS_API_TOKEN || undefined

	try {
		const tracked = await runTrackedNaisSync({
			token,
			performedBy: "nais-scheduler",
			scopeType: "scheduler",
			scopeId: "nais-scheduler",
		})
		if (tracked.result) {
			logger.info(
				`[nais-scheduler] Sync complete: ${tracked.result.teams.new} new teams, ${tracked.result.apps.length} teams scanned`,
			)
		} else {
			logger.info("[nais-scheduler] Sync skipped — another pod holds the lock")
		}
	} catch (err) {
		logger.error("[nais-scheduler] Sync failed", err)
	}
}

/** Start periodic Nais scanning. Safe to call from multiple pods — advisory locks prevent duplicates. */
export function startNaisScheduler() {
	if (intervalId) return

	const enabled = process.env.ENABLE_NAIS_SYNC === "true"
	if (!enabled) {
		logger.info("[nais-scheduler] Disabled (set ENABLE_NAIS_SYNC=true to enable)")
		return
	}

	logger.info(
		`[nais-scheduler] Starting — interval ${SYNC_INTERVAL_MS / 1000}s, initial delay ${INITIAL_DELAY_MS / 1000}s`,
	)

	setTimeout(() => {
		runSync()
		intervalId = setInterval(runSync, SYNC_INTERVAL_MS)
	}, INITIAL_DELAY_MS)
}
