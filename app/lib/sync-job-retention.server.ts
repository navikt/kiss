import { deleteOldFinishedSyncJobs } from "~/db/queries/sync-jobs.server"
import { withAdvisoryLock } from "~/lib/lock.server"
import { logger } from "~/lib/logger.server"

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
}): Promise<{ deletedCount: number; retentionDays: number; batchSize: number } | null> {
	const retentionDays =
		params?.retentionDays ?? parsePositiveInt(process.env.SYNC_JOB_RETENTION_DAYS, DEFAULT_RETENTION_DAYS)
	const batchSize = params?.batchSize ?? parsePositiveInt(process.env.SYNC_JOB_RETENTION_BATCH_SIZE, DEFAULT_BATCH_SIZE)
	const performedBy = params?.performedBy ?? "sync-job-retention-cleanup"
	const olderThan = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)

	return withAdvisoryLock(RETENTION_LOCK_NAME, async () => {
		const { deletedJobIds } = await deleteOldFinishedSyncJobs({
			olderThan,
			limit: batchSize,
		})

		logger.info(
			`[sync-job-retention] completed: deleted=${deletedJobIds.length}, retentionDays=${retentionDays}, batchSize=${batchSize}, performedBy=${performedBy}`,
		)

		return {
			deletedCount: deletedJobIds.length,
			retentionDays,
			batchSize,
		}
	})
}
