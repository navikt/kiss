import {
	createSyncJob,
	getLastCompletedSyncJobAt,
	markSyncJobCompleted,
	markSyncJobFailed,
	markSyncJobRunning,
	markSyncJobSkipped,
} from "~/db/queries/sync-jobs.server"
import type { SyncResult } from "~/lib/nais-sync.server"
import { runFullNaisSync } from "~/lib/nais-sync.server"
import { SYNC_JOB_TYPES } from "~/lib/sync-job-types"

export interface NaisSyncJobResult {
	/** null when the run was skipped due to cooldown (no job record was created). */
	jobId: string | null
	state: "completed" | "skipped"
	result: {
		teams: SyncResult
		apps: { teamSlug: string; result: SyncResult }[]
	} | null
}

function formatCompletedMessage(result: { teams: SyncResult; apps: { teamSlug: string; result: SyncResult }[] }) {
	const discoveredApps = result.apps.reduce((sum, item) => sum + item.result.discovered, 0)
	return `Synkronisering fullført: ${result.teams.discovered} team, ${discoveredApps} applikasjoner oppdaget`
}

export async function runTrackedNaisSync({
	token,
	performedBy,
	scopeType,
	scopeId,
	minIntervalMs,
}: {
	token?: string
	performedBy: string
	scopeType?: string
	scopeId?: string
	/** If the last completed nais_full_sync finished within this window, skip silently (cross-pod cooldown). */
	minIntervalMs?: number
}): Promise<NaisSyncJobResult> {
	if (minIntervalMs !== undefined) {
		const lastAt = await getLastCompletedSyncJobAt(SYNC_JOB_TYPES.NAIS_FULL_SYNC)
		if (lastAt && Date.now() - lastAt.getTime() < minIntervalMs) {
			return { jobId: null, state: "skipped", result: null }
		}
	}

	const job = await createSyncJob({
		jobType: SYNC_JOB_TYPES.NAIS_FULL_SYNC,
		performedBy,
		scopeType,
		scopeId,
		message: "Venter på start",
	})

	await markSyncJobRunning(job.id, performedBy, "Synkronisering pågår")

	const execution = await runFullNaisSync(token, job.id).then(
		(result) => ({ ok: true as const, result }),
		(error) => ({ ok: false as const, error }),
	)

	if (!execution.ok) {
		const message = execution.error instanceof Error ? execution.error.message : String(execution.error)
		await markSyncJobFailed(job.id, message, performedBy, "Synkronisering feilet")
		throw execution.error
	}

	if (execution.result === null) {
		await markSyncJobSkipped(job.id, "Synkronisering pågår allerede i en annen prosess.", performedBy)
		return {
			jobId: job.id,
			state: "skipped",
			result: null,
		}
	}

	await markSyncJobCompleted(job.id, execution.result, performedBy, formatCompletedMessage(execution.result))
	return {
		jobId: job.id,
		state: "completed",
		result: execution.result,
	}
}
