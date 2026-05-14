import {
	createSyncJob,
	getSyncJob,
	markSyncJobCompleted,
	markSyncJobFailed,
	markSyncJobRunning,
	markSyncJobSkipped,
	type SyncJob,
} from "~/db/queries/sync-jobs.server"

const RPA_SYNC_JOB_TYPE = "rpa_group_member_sync"

export interface RpaSyncJobResult {
	groupsSynced: number
	totalAdded: number
	totalArchived: number
}

export interface RpaSyncJob extends Omit<SyncJob, "result"> {
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

export async function createRpaSyncJob(performedBy: string): Promise<RpaSyncJob> {
	const job = await createSyncJob({
		jobType: RPA_SYNC_JOB_TYPE,
		performedBy,
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
	const job = await getSyncJob(jobId, RPA_SYNC_JOB_TYPE)
	return job ? toRpaSyncJob(job) : null
}
