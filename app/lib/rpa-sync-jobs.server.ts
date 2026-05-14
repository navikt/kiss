import {
	createSyncJob,
	getSyncJob,
	markSyncJobCompleted,
	markSyncJobFailed,
	markSyncJobRunning,
	markSyncJobSkipped,
	type SyncJob,
} from "~/db/queries/sync-jobs.server"
import { runRpaGroupMemberSync } from "~/lib/rpa-sync.server"
import { SYNC_JOB_TYPES } from "~/lib/sync-job-types"

export interface RpaSyncJobResult {
	groupsSynced: number
	totalAdded: number
	totalArchived: number
}

export interface RpaSyncJob extends Omit<SyncJob, "result"> {
	result: RpaSyncJobResult | null
}

export interface TrackedRpaSyncJobResult {
	jobId: string
	state: "completed" | "skipped"
	result: RpaSyncJobResult | null
}

function toRpaSyncJob(job: SyncJob): RpaSyncJob {
	const result = job.result
	const parsedResult =
		result &&
		typeof result.groupsSynced === "number" &&
		typeof result.totalAdded === "number" &&
		typeof result.totalArchived === "number"
			? {
					groupsSynced: result.groupsSynced,
					totalAdded: result.totalAdded,
					totalArchived: result.totalArchived,
				}
			: null
	return {
		...job,
		result: parsedResult,
	}
}

export async function createRpaSyncJob(
	performedBy: string,
	options?: { scopeType?: string; scopeId?: string },
): Promise<RpaSyncJob> {
	const job = await createSyncJob({
		jobType: SYNC_JOB_TYPES.RPA_GROUP_MEMBER_SYNC,
		performedBy,
		scopeType: options?.scopeType,
		scopeId: options?.scopeId,
		message: "Venter på start",
	})
	return toRpaSyncJob(job)
}

export async function markRpaSyncJobRunning(jobId: string, performedBy: string) {
	await markSyncJobRunning(jobId, performedBy, "Synkronisering pågår")
}

export async function markRpaSyncJobCompleted(jobId: string, result: RpaSyncJobResult, performedBy: string) {
	await markSyncJobCompleted(
		jobId,
		{
			groupsSynced: result.groupsSynced,
			totalAdded: result.totalAdded,
			totalArchived: result.totalArchived,
		},
		performedBy,
		`Synkronisering fullført: ${result.groupsSynced} grupper, +${result.totalAdded} lagt til, -${result.totalArchived} arkivert`,
	)
}

export async function markRpaSyncJobSkipped(jobId: string, message: string, performedBy: string) {
	await markSyncJobSkipped(jobId, message, performedBy)
}

export async function markRpaSyncJobFailed(jobId: string, error: string, performedBy: string) {
	await markSyncJobFailed(jobId, error, performedBy, "Synkronisering feilet")
}

export async function getRpaSyncJob(jobId: string): Promise<RpaSyncJob | null> {
	const job = await getSyncJob(jobId, SYNC_JOB_TYPES.RPA_GROUP_MEMBER_SYNC)
	return job ? toRpaSyncJob(job) : null
}

export async function runTrackedRpaGroupMemberSync({
	performedBy,
	force,
	scopeType,
	scopeId,
}: {
	performedBy: string
	force?: boolean
	scopeType?: string
	scopeId?: string
}): Promise<TrackedRpaSyncJobResult> {
	const job = await createRpaSyncJob(performedBy, { scopeType, scopeId })
	await markRpaSyncJobRunning(job.id, performedBy)

	const execution = await runRpaGroupMemberSync({ force, jobId: job.id }).then(
		(result) => ({ ok: true as const, result }),
		(error) => ({ ok: false as const, error }),
	)

	if (!execution.ok) {
		const message = execution.error instanceof Error ? execution.error.message : String(execution.error)
		await markRpaSyncJobFailed(job.id, message, performedBy)
		throw execution.error
	}

	if (execution.result === null) {
		await markRpaSyncJobSkipped(job.id, "Synkronisering pågår allerede i en annen prosess.", performedBy)
		return {
			jobId: job.id,
			state: "skipped",
			result: null,
		}
	}

	await markRpaSyncJobCompleted(job.id, execution.result, performedBy)
	return {
		jobId: job.id,
		state: "completed",
		result: execution.result,
	}
}
