import { syncAllApplicationControls } from "~/db/queries/application-controls.server"
import {
	createSyncJob,
	markSyncJobCompleted,
	markSyncJobFailed,
	markSyncJobRunning,
	markSyncJobSkipped,
} from "~/db/queries/sync-jobs.server"
import { SYNC_JOB_TYPES } from "./sync-job-types"

export interface ComplianceSyncJobResult {
	jobId: string
	state: "completed" | "skipped"
	result: { synced: number; errors: number; durationMs: number } | null
}

export async function runTrackedComplianceSync({
	performedBy,
	scopeType,
	scopeId,
}: {
	performedBy: string
	scopeType?: string
	scopeId?: string
}): Promise<ComplianceSyncJobResult> {
	const job = await createSyncJob({
		jobType: SYNC_JOB_TYPES.COMPLIANCE_SYNC,
		performedBy,
		scopeType,
		scopeId,
		message: "Venter på start",
	})

	await markSyncJobRunning(job.id, performedBy, "Synkronisering pågår")

	const execution = await (async () => {
		const start = Date.now()
		const result = await syncAllApplicationControls(performedBy, { returnNullWhenLocked: true })
		return result ? { ...result, durationMs: Date.now() - start } : null
	})().then(
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

	await markSyncJobCompleted(job.id, execution.result, performedBy, "Synkronisering fullført")
	return {
		jobId: job.id,
		state: "completed",
		result: execution.result,
	}
}
