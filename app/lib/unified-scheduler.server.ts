/**
 * Unified sequential scheduler — runs all background sync jobs sequentially
 * inside a single advisory lock to minimize database connection usage.
 *
 * Previously, 4 independent schedulers could overlap and hold 5-6 pool
 * connections simultaneously for advisory locks. This unified scheduler
 * ensures only 1 lock connection is held at a time (plus 1 for the actual
 * work), dramatically reducing connection pressure on the shared pool.
 *
 * Job frequencies:
 *   - NAIS sync:            every cycle  (5 min)
 *   - Compliance sync:      every 3rd cycle (15 min)
 *   - Audit summary sync:   every 6th cycle (30 min)
 *   - Deployment audit sync: every 6th cycle (30 min)
 */

import { logPoolStats } from "~/db/connection.server"
import { withAdvisoryLock } from "./lock.server"
import { logger } from "./logger.server"

const CYCLE_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes — base cycle
const INITIAL_DELAY_MS = 30 * 1000 // 30 seconds after startup

let intervalId: ReturnType<typeof setInterval> | null = null
let timeoutId: ReturnType<typeof setTimeout> | null = null
let cycleCount = 0

interface JobConfig {
	name: string
	/** Run this job every N cycles (1 = every cycle, 3 = every 3rd, etc.) */
	everyCycles: number
	envVar: string
	run: () => Promise<void>
}

const jobs: JobConfig[] = [
	{
		name: "nais-sync",
		everyCycles: 1,
		envVar: "ENABLE_NAIS_SYNC",
		async run() {
			const { runFullNaisSync } = await import("./nais-sync.server")
			const token = process.env.NAIS_API_KEY || process.env.NAIS_API_TOKEN || undefined
			const result = await runFullNaisSync(token)
			if (result) {
				logger.info(
					`[unified-scheduler] nais-sync complete: ${result.teams.new} new teams, ${result.apps.length} teams scanned`,
				)
			} else {
				logger.info("[unified-scheduler] nais-sync skipped — another pod holds the lock")
			}
		},
	},
	{
		name: "compliance-sync",
		everyCycles: 3,
		envVar: "ENABLE_COMPLIANCE_SYNC",
		async run() {
			const { syncAllApplicationControls } = await import("../db/queries/application-controls.server")
			const result = await withAdvisoryLock("compliance-sync-scheduler", async () => {
				const start = Date.now()
				const { synced, errors } = await syncAllApplicationControls("compliance-sync")
				return { synced, errors, durationMs: Date.now() - start }
			})
			if (result) {
				logger.info(
					`[unified-scheduler] compliance-sync complete: ${result.synced} synced, ${result.errors} errors (${result.durationMs}ms)`,
				)
			} else {
				logger.info("[unified-scheduler] compliance-sync skipped — another pod holds the lock")
			}
		},
	},
	{
		name: "audit-summary-sync",
		everyCycles: 6,
		envVar: "ENABLE_AUDIT_SUMMARY_SYNC",
		async run() {
			const { runAuditSummarySync } = await import("./audit-summary-scheduler.server")
			await runAuditSummarySync()
		},
	},
	{
		name: "deployment-audit-sync",
		everyCycles: 6,
		envVar: "ENABLE_DEPLOYMENT_AUDIT_SYNC",
		async run() {
			const { runDeploymentAuditSync } = await import("./deployment-audit-scheduler.server")
			await runDeploymentAuditSync()
		},
	},
]

async function runCycle() {
	cycleCount++
	const cycleStart = Date.now()
	logPoolStats("cycle-start")
	logger.info(`[unified-scheduler] Starting cycle ${cycleCount}`)

	for (const job of jobs) {
		if (process.env[job.envVar] !== "true") continue
		if (cycleCount % job.everyCycles !== 0) continue

		try {
			const jobStart = Date.now()
			await job.run()
			logger.info(`[unified-scheduler] ${job.name} finished in ${Date.now() - jobStart}ms`)
		} catch (err) {
			logger.error(`[unified-scheduler] ${job.name} failed`, err)
		}
	}

	logPoolStats("cycle-end")
	logger.info(`[unified-scheduler] Cycle ${cycleCount} complete in ${Date.now() - cycleStart}ms`)
}

/** Start the unified sequential scheduler. All sync jobs run sequentially within each cycle. */
export function startUnifiedScheduler() {
	if (intervalId) return

	logger.info(
		`[unified-scheduler] Starting — cycle interval ${CYCLE_INTERVAL_MS / 1000}s, initial delay ${INITIAL_DELAY_MS / 1000}s`,
	)
	logger.info(
		"[unified-scheduler] Jobs run sequentially to minimize connection pool usage (was: 4 independent schedulers)",
	)

	timeoutId = setTimeout(() => {
		timeoutId = null
		runCycle()
		intervalId = setInterval(runCycle, CYCLE_INTERVAL_MS)
	}, INITIAL_DELAY_MS)
}

/** Stop the unified scheduler (for graceful shutdown). */
export function stopUnifiedScheduler() {
	if (timeoutId) {
		clearTimeout(timeoutId)
		timeoutId = null
	}
	if (intervalId) {
		clearInterval(intervalId)
		intervalId = null
		logger.info("[unified-scheduler] Stopped")
	}
}
