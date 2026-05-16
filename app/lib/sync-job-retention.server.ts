import {
	createSyncJob,
	deleteOldFinishedSyncJobs,
	markSyncJobCompleted,
	markSyncJobFailed,
	markSyncJobRunning,
} from "~/db/queries/sync-jobs.server"
import { withAdvisoryLock } from "~/lib/lock.server"
import { logger } from "~/lib/logger.server"
import { SYNC_JOB_TYPES } from "~/lib/sync-job-types"

const DEFAULT_RETENTION_DAYS = 90
const DEFAULT_BATCH_SIZE = 500
const RETENTION_LOCK_NAME = "sync-jobs-retention-cleanup"

function parsePositiveInt(value: string | undefined, fallback: number): number {
	if (!value) return fallback
	const parsed = Number(value)
	if (!Number.isInteger(parsed) || parsed <= 0) return fallback
	return parsed
}

export async function runSyncJobRetentionCleanup(params?: {
	performedBy?: string
	retentionDays?: number
	batchSize?: number
}): Promise<{
	deletedCount: number
	retentionDays: number
	batchSize: number
} | null> {
	const retentionDays =
		params?.retentionDays ?? parsePositiveInt(process.env.SYNC_JOB_RETENTION_DAYS, DEFAULT_RETENTION_DAYS)
	const batchSize = params?.batchSize ?? parsePositiveInt(process.env.SYNC_JOB_RETENTION_BATCH_SIZE, DEFAULT_BATCH_SIZE)
	const performedBy = params?.performedBy ?? "sync-job-retention-cleanup"
	const olderThan = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)

	return withAdvisoryLock(RETENTION_LOCK_NAME, async () => {
		const job = await createSyncJob({
			jobType: SYNC_JOB_TYPES.SYNC_JOB_RETENTION_CLEANUP,
			performedBy,
			scopeType: "scheduler",
			scopeId: "unified-scheduler",
			message: "Venter på start",
		})
		await markSyncJobRunning(job.id, performedBy, "Opprydding av gamle sync-jobber pågår")

		const execution = await deleteOldFinishedSyncJobs({
			olderThan,
			limit: batchSize,
		}).then(
			(result) => ({ ok: true as const, result }),
			(error) => ({ ok: false as const, error }),
		)

		if (!execution.ok) {
			const message = execution.error instanceof Error ? execution.error.message : String(execution.error)
			await markSyncJobFailed(job.id, message, performedBy, "Opprydding av sync-jobber feilet")
			throw execution.error
		}

		const deletedCount = execution.result.deletedJobIds.length
		await markSyncJobCompleted(
			job.id,
			{
				deletedCount,
				retentionDays,
				batchSize,
			},
			performedBy,
			`Opprydding fullført: ${deletedCount} gamle sync-jobber slettet`,
		)

		logger.info(
			`[sync-job-retention] completed: deleted=${deletedCount}, retentionDays=${retentionDays}, batchSize=${batchSize}, performedBy=${performedBy}`,
		)

		return {
			deletedCount,
			retentionDays,
			batchSize,
		}
	})
}
