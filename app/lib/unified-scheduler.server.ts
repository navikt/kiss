/**
 * Unified sequential scheduler — runs all background sync jobs sequentially
 * to minimize database connection usage.
 *
 * Previously, 4 independent schedulers could overlap and hold 5-6 pool
 * connections simultaneously for advisory locks. This unified scheduler
 * runs jobs one at a time within each cycle, so at most 1 advisory lock
 * connection is held at any moment (plus 1 for the actual work).
 * Each job still acquires its own advisory lock for cross-pod safety.
 *
 * Cadence is based on wall-clock time since the last *finished* sync job of
 * that type — completed, failed or skipped (read from the database via
 * `getLastFinishedSyncJobAt`) — NOT on an in-memory cycle counter. This is
 * deliberate: `cycleCount` resets to 0 on every pod restart, so a job with
 * e.g. a 30-minute cadence would never fire if the pod never survives 30
 * uninterrupted minutes (which happens easily during a burst of deploys).
 * Using the DB timestamp means cadence survives restarts — a job only runs
 * once `minIntervalMs` has actually elapsed since it last finished (in any
 * terminal state), regardless of how many times the scheduler itself has
 * restarted in between. Gating on any terminal state — not just "completed"
 * — also prevents a failing or lock-skipped job from being retried every
 * single 5-minute cycle, which would otherwise bypass the intended cadence.
 *
 * Job frequencies:
 *   - NAIS sync:             every 5 min
 *   - Compliance sync:       every 15 min
 *   - Audit summary sync:    every 30 min
 *   - Deployment audit sync: every 30 min
 *   - Sync-job retention:    every 24h (runs immediately if never run before)
 */

import { logPoolStats } from "~/db/connection.server"
import { getLastFinishedSyncJobAt, markStaleRunningSyncJobsAsFailed } from "~/db/queries/sync-jobs.server"
import { runTrackedEntraTeamMemberSync } from "./entra-team-sync-jobs.server"
import { logger } from "./logger.server"
import { SYNC_JOB_TYPES, type SyncJobType } from "./sync-job-types"

export const CYCLE_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes — base cycle
const INITIAL_DELAY_MS = 30 * 1000 // 30 seconds after startup
const ONE_DAY_MS = 24 * 60 * 60 * 1000

let running = false
let timeoutId: ReturnType<typeof setTimeout> | null = null
let cycleCount = 0 // used only for logging, no longer for cadence decisions
let generation = 0 // Incremented on each start to invalidate stale loops
let pendingResolve: (() => void) | null = null

interface JobConfig {
	name: string
	/** Job type used to look up the last finished run (any terminal state) in the database. */
	jobType: SyncJobType
	/** Minimum wall-clock time since the last finished run (completed/failed/skipped) before this job may run again. */
	minIntervalMs: number
	envVar: string
	run: () => Promise<void>
}

const jobs: JobConfig[] = [
	{
		name: "nais-sync",
		jobType: SYNC_JOB_TYPES.NAIS_FULL_SYNC,
		minIntervalMs: CYCLE_INTERVAL_MS,
		envVar: "ENABLE_NAIS_SYNC",
		async run() {
			const { runTrackedNaisSync } = await import("./nais-sync-jobs.server")
			const { getNaisToken } = await import("./nais.server")
			const token = getNaisToken()
			// Cadence is already enforced by the scheduler's own minIntervalMs check above
			// (against getLastFinishedSyncJobAt), so no minIntervalMs is passed here — avoids
			// a redundant second DB cooldown lookup/decision inside runTrackedNaisSync.
			const tracked = await runTrackedNaisSync({
				token,
				performedBy: "unified-scheduler",
				scopeType: "scheduler",
				scopeId: "unified-scheduler",
			})
			if (tracked.result) {
				logger.info(
					`[unified-scheduler] nais-sync complete: ${tracked.result.teams.new} new teams, ${tracked.result.apps.length} teams scanned`,
				)
			} else {
				logger.info("[unified-scheduler] nais-sync skipped — another pod holds the lock")
			}
		},
	},
	{
		name: "compliance-sync",
		jobType: SYNC_JOB_TYPES.COMPLIANCE_SYNC,
		minIntervalMs: 3 * CYCLE_INTERVAL_MS,
		envVar: "ENABLE_COMPLIANCE_SYNC",
		async run() {
			const { runTrackedComplianceSync } = await import("./compliance-sync-jobs.server")
			const tracked = await runTrackedComplianceSync({
				performedBy: "unified-scheduler",
				scopeType: "scheduler",
				scopeId: "unified-scheduler",
			})
			if (tracked.result) {
				logger.info(
					`[unified-scheduler] compliance-sync complete: ${tracked.result.synced} synced, ${tracked.result.errors} errors (${tracked.result.durationMs}ms)`,
				)
			} else {
				logger.info("[unified-scheduler] compliance-sync skipped — another pod holds the lock")
			}
		},
	},
	{
		name: "audit-summary-sync",
		jobType: SYNC_JOB_TYPES.AUDIT_SUMMARY_SYNC,
		minIntervalMs: 6 * CYCLE_INTERVAL_MS,
		envVar: "ENABLE_AUDIT_SUMMARY_SYNC",
		async run() {
			const { runAuditSummarySync } = await import("./audit-summary-scheduler.server")
			await runAuditSummarySync()
		},
	},
	{
		name: "deployment-audit-sync",
		jobType: SYNC_JOB_TYPES.DEPLOYMENT_AUDIT_SYNC,
		minIntervalMs: 6 * CYCLE_INTERVAL_MS,
		envVar: "ENABLE_DEPLOYMENT_AUDIT_SYNC",
		async run() {
			const { runDeploymentAuditSync } = await import("./deployment-audit-scheduler.server")
			await runDeploymentAuditSync()
		},
	},
	{
		name: "rpa-group-member-sync",
		jobType: SYNC_JOB_TYPES.RPA_GROUP_MEMBER_SYNC,
		minIntervalMs: 6 * CYCLE_INTERVAL_MS, // scheduler cadence; job itself also checks 24h interval via DB timestamp
		envVar: "ENABLE_RPA_SYNC",
		async run() {
			const { runTrackedRpaGroupMemberSync } = await import("./rpa-sync-jobs.server")
			const tracked = await runTrackedRpaGroupMemberSync({
				performedBy: "unified-scheduler",
				scopeType: "scheduler",
				scopeId: "unified-scheduler",
			})
			if (tracked.result) {
				logger.info(
					`[unified-scheduler] rpa-sync complete: ${tracked.result.groupsSynced} groups, +${tracked.result.totalAdded} added, -${tracked.result.totalArchived} archived`,
				)
			} else {
				logger.info("[unified-scheduler] rpa-sync skipped — another pod holds the lock")
			}
		},
	},
	{
		name: "entra-team-member-sync",
		jobType: SYNC_JOB_TYPES.ENTRA_TEAM_MEMBER_SYNC,
		minIntervalMs: 6 * CYCLE_INTERVAL_MS,
		envVar: "ENABLE_ENTRA_TEAM_SYNC",
		async run() {
			const tracked = await runTrackedEntraTeamMemberSync({
				performedBy: "unified-scheduler",
				scopeType: "scheduler",
				scopeId: "unified-scheduler",
			})
			if (tracked.result) {
				logger.info(
					`[unified-scheduler] entra-team-sync complete: ${tracked.result.teamsSynced} teams, ${tracked.result.teamsGroupDeleted} group-deleted, +${tracked.result.totalAdded} added, -${tracked.result.totalArchived} archived`,
				)
			} else {
				logger.info("[unified-scheduler] entra-team-sync skipped — another pod holds the lock")
			}
		},
	},
	{
		name: "sync-job-retention-cleanup",
		jobType: SYNC_JOB_TYPES.SYNC_JOB_RETENTION_CLEANUP,
		// Never run before → runs immediately; otherwise waits a full 24h since last completion.
		minIntervalMs: ONE_DAY_MS,
		envVar: "ENABLE_SYNC_JOB_RETENTION_CLEANUP",
		async run() {
			const { runSyncJobRetentionCleanup } = await import("./sync-job-retention.server")
			const result = await runSyncJobRetentionCleanup({
				performedBy: "unified-scheduler",
			})
			if (result) {
				logger.info(
					`[unified-scheduler] sync-job-retention-cleanup complete: ${result.deletedCount} jobber slettet (retention ${result.retentionDays} dager, batch ${result.batchSize})`,
				)
			} else {
				logger.info("[unified-scheduler] sync-job-retention-cleanup skipped — another pod holds the lock")
			}
		},
	},
	{
		name: "github-access-sync",
		jobType: SYNC_JOB_TYPES.GITHUB_ACCESS_SYNC,
		minIntervalMs: ONE_DAY_MS,
		envVar: "ENABLE_GITHUB_ACCESS_SYNC",
		async run() {
			const { runTrackedGitHubAccessSync } = await import("./github-access-sync-jobs.server")
			const outcome = await runTrackedGitHubAccessSync({
				performedBy: "unified-scheduler",
				scopeType: "scheduler",
				scopeId: "unified-scheduler",
			})
			logger.info(`[unified-scheduler] github-access-sync ${outcome.state} (jobId: ${outcome.jobId})`)
		},
	},
]

/**
 * Jobber som blir hengende i "running" fordi podden som kjørte dem ble terminert
 * (f.eks. ved redeploy) før den rakk å markere jobben ferdig. Denne terskelen er satt
 * godt over normal kjøretid for alle sync-jobbene, slik at kun reelt hengende jobber
 * ryddes opp — ikke en jobb som legitimt fortsatt kjører.
 */
const STALE_RUNNING_JOB_THRESHOLD_MS = 60 * 60 * 1000 // 1 time

async function cleanupStaleRunningSyncJobs() {
	try {
		const olderThan = new Date(Date.now() - STALE_RUNNING_JOB_THRESHOLD_MS)
		const { jobIds } = await markStaleRunningSyncJobsAsFailed(olderThan, "unified-scheduler")
		if (jobIds.length > 0) {
			logger.warn(
				`[unified-scheduler] Ryddet opp ${jobIds.length} hengende "Pågår"-synkjobb(er) (sannsynlig pod-restart)`,
			)
		}
	} catch (err) {
		logger.error("[unified-scheduler] Kunne ikke rydde opp hengende synkjobber", err)
	}
}

async function runCycle() {
	cycleCount++
	const cycleStart = Date.now()
	logPoolStats("cycle-start")
	logger.info(`[unified-scheduler] Starting cycle ${cycleCount}`)

	// Kjøres alltid, uavhengig av hvilke enkeltjobber som er skrudd på — dette er
	// en selvhelbredende sikkerhetsmekanisme, ikke en synk-funksjon i seg selv.
	await cleanupStaleRunningSyncJobs()

	for (const job of jobs) {
		if (process.env[job.envVar] !== "true") continue

		const lastFinishedAt = await getLastFinishedSyncJobAt(job.jobType)
		if (lastFinishedAt && Date.now() - lastFinishedAt.getTime() < job.minIntervalMs) continue

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
	if (running) return

	const enabledJobs = jobs.filter((j) => process.env[j.envVar] === "true")
	if (enabledJobs.length === 0) {
		// Ingen enkeltjobber er skrudd på, men scheduleren starter likevel — oppryddingen av
		// hengende "Pågår"-synkjobber (cleanupStaleRunningSyncJobs) kjøres uavhengig av
		// ENABLE_*-flaggene og må derfor kunne kjøre selv når ingen sync-jobber er aktivert.
		logger.info("[unified-scheduler] Ingen synk-jobber enabled — starter likevel for hengende-jobb-opprydding")
	} else {
		logger.info(
			`[unified-scheduler] Starting — ${enabledJobs.length} jobs enabled, cycle interval ${CYCLE_INTERVAL_MS / 1000}s, initial delay ${INITIAL_DELAY_MS / 1000}s`,
		)
		logger.info(
			"[unified-scheduler] Jobs run sequentially to minimize connection pool usage (was: 4 independent schedulers)",
		)
	}

	running = true
	generation++
	const myGeneration = generation
	timeoutId = setTimeout(() => scheduleLoop(myGeneration), INITIAL_DELAY_MS)
}

async function scheduleLoop(myGeneration: number) {
	while (running && generation === myGeneration) {
		await runCycle()
		if (!running || generation !== myGeneration) break
		await new Promise<void>((resolve) => {
			pendingResolve = resolve
			timeoutId = setTimeout(() => {
				timeoutId = null
				pendingResolve = null
				resolve()
			}, CYCLE_INTERVAL_MS)
		})
	}
}

/** Stop the unified scheduler (for graceful shutdown). */
export function stopUnifiedScheduler() {
	if (!running) return
	running = false
	if (timeoutId) {
		clearTimeout(timeoutId)
		timeoutId = null
	}
	if (pendingResolve) {
		pendingResolve()
		pendingResolve = null
	}
	logger.info("[unified-scheduler] Stopped")
}
