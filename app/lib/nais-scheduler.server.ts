import { runFullNaisSync } from "./nais-sync.server"

const SYNC_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes
const INITIAL_DELAY_MS = 30 * 1000 // 30 seconds after startup

let intervalId: ReturnType<typeof setInterval> | null = null

async function runSync() {
	const token = process.env.NAIS_API_KEY || process.env.NAIS_API_TOKEN || undefined

	try {
		const result = await runFullNaisSync(token)
		if (result) {
			console.log(`[nais-scheduler] Sync complete: ${result.teams.new} new teams, ${result.apps.length} teams scanned`)
		} else {
			console.log("[nais-scheduler] Sync skipped — another pod holds the lock")
		}
	} catch (err) {
		console.error("[nais-scheduler] Sync failed:", err)
	}
}

/** Start periodic Nais scanning. Safe to call from multiple pods — advisory locks prevent duplicates. */
export function startNaisScheduler() {
	if (intervalId) return

	const enabled = process.env.ENABLE_NAIS_SYNC === "true"
	if (!enabled) {
		console.log("[nais-scheduler] Disabled (set ENABLE_NAIS_SYNC=true to enable)")
		return
	}

	console.log(
		`[nais-scheduler] Starting — interval ${SYNC_INTERVAL_MS / 1000}s, initial delay ${INITIAL_DELAY_MS / 1000}s`,
	)

	setTimeout(() => {
		runSync()
		intervalId = setInterval(runSync, SYNC_INTERVAL_MS)
	}, INITIAL_DELAY_MS)
}

/** Stop the scheduler (for graceful shutdown). */
export function stopNaisScheduler() {
	if (intervalId) {
		clearInterval(intervalId)
		intervalId = null
		console.log("[nais-scheduler] Stopped")
	}
}
