import {
	createSyncJob,
	getSyncJob,
	markSyncJobCompleted,
	markSyncJobFailed,
	markSyncJobRunning,
	markSyncJobSkipped,
	type SyncJob,
} from "~/db/queries/sync-jobs.server"
import { type EntraTeamSyncResult, runEntraTeamMemberSync } from "~/lib/entra-team-sync.server"
import { SYNC_JOB_TYPES } from "~/lib/sync-job-types"

export interface EntraTeamSyncJob extends Omit<SyncJob, "result"> {
	result: EntraTeamSyncResult | null
}

export interface TrackedEntraTeamSyncResult {
	jobId: string
	state: "completed" | "skipped"
	result: EntraTeamSyncResult | null
}

function toEntraTeamSyncJob(job: SyncJob): EntraTeamSyncJob {
	const result = job.result
	const parsedResult =
		result &&
		typeof result.teamsSynced === "number" &&
		typeof result.teamsGroupDeleted === "number" &&
		typeof result.totalAdded === "number" &&
		typeof result.totalArchived === "number"
			? {
					teamsSynced: result.teamsSynced,
					teamsGroupDeleted: result.teamsGroupDeleted,
					totalAdded: result.totalAdded,
					totalArchived: result.totalArchived,
				}
			: null
	return { ...job, result: parsedResult }
}

export async function createEntraTeamSyncJob(
	performedBy: string,
	options?: { scopeType?: string; scopeId?: string },
): Promise<EntraTeamSyncJob> {
	const job = await createSyncJob({
		jobType: SYNC_JOB_TYPES.ENTRA_TEAM_MEMBER_SYNC,
		performedBy,
		scopeType: options?.scopeType,
		scopeId: options?.scopeId,
		message: "Venter på start",
	})
	return toEntraTeamSyncJob(job)
}

export async function getEntraTeamSyncJob(jobId: string): Promise<EntraTeamSyncJob | null> {
	const job = await getSyncJob(jobId, SYNC_JOB_TYPES.ENTRA_TEAM_MEMBER_SYNC)
	return job ? toEntraTeamSyncJob(job) : null
}

export async function runTrackedEntraTeamMemberSync({
	performedBy,
	scopeType,
	scopeId,
}: {
	performedBy: string
	scopeType?: string
	scopeId?: string
}): Promise<TrackedEntraTeamSyncResult> {
	const job = await createEntraTeamSyncJob(performedBy, { scopeType, scopeId })
	await markSyncJobRunning(job.id, performedBy, "Synkronisering pågår")

	const execution = await runEntraTeamMemberSync({ jobId: job.id }).then(
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
		return { jobId: job.id, state: "skipped", result: null }
	}

	const r = execution.result
	await markSyncJobCompleted(
		job.id,
		{
			teamsSynced: r.teamsSynced,
			teamsGroupDeleted: r.teamsGroupDeleted,
			totalAdded: r.totalAdded,
			totalArchived: r.totalArchived,
		},
		performedBy,
		`Synkronisering fullført: ${r.teamsSynced} team, ${r.teamsGroupDeleted} med slettet gruppe, +${r.totalAdded} lagt til, -${r.totalArchived} arkivert`,
	)
	return { jobId: job.id, state: "completed", result: r }
}
