import { beforeEach, describe, expect, it, vi } from "vitest"

const mockCreateSyncJob = vi.fn()
const mockDeleteOldFinishedSyncJobs = vi.fn()
const mockMarkSyncJobCompleted = vi.fn()
const mockMarkSyncJobFailed = vi.fn()
const mockMarkSyncJobRunning = vi.fn()
const mockWithAdvisoryLock = vi.fn()
const mockLoggerInfo = vi.fn()

vi.mock("~/db/queries/sync-jobs.server", () => ({
	createSyncJob: mockCreateSyncJob,
	deleteOldFinishedSyncJobs: mockDeleteOldFinishedSyncJobs,
	markSyncJobCompleted: mockMarkSyncJobCompleted,
	markSyncJobFailed: mockMarkSyncJobFailed,
	markSyncJobRunning: mockMarkSyncJobRunning,
}))

vi.mock("~/lib/lock.server", () => ({
	withAdvisoryLock: mockWithAdvisoryLock,
}))

vi.mock("~/lib/logger.server", () => ({
	logger: {
		info: mockLoggerInfo,
	},
}))

const { runSyncJobRetentionCleanup } = await import("~/lib/sync-job-retention.server")

describe("sync job retention cleanup", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		delete process.env.SYNC_JOB_RETENTION_DAYS
		delete process.env.SYNC_JOB_RETENTION_BATCH_SIZE
		mockCreateSyncJob.mockResolvedValue({ id: "retention-job-1" })
	})

	it("returns null when lock is already held", async () => {
		mockWithAdvisoryLock.mockResolvedValue(null)

		const result = await runSyncJobRetentionCleanup({ performedBy: "unified-scheduler" })

		expect(result).toBeNull()
		expect(mockDeleteOldFinishedSyncJobs).not.toHaveBeenCalled()
	})

	it("deletes old finished jobs with configured retention settings", async () => {
		process.env.SYNC_JOB_RETENTION_DAYS = "120"
		process.env.SYNC_JOB_RETENTION_BATCH_SIZE = "250"
		mockDeleteOldFinishedSyncJobs.mockResolvedValue({
			deletedJobIds: ["j1", "j2"],
		})
		mockWithAdvisoryLock.mockImplementation(async (_name: string, fn: () => Promise<unknown>) => fn())

		const result = await runSyncJobRetentionCleanup({ performedBy: "unified-scheduler" })

		expect(mockDeleteOldFinishedSyncJobs).toHaveBeenCalledTimes(1)
		expect(mockDeleteOldFinishedSyncJobs.mock.calls[0][0]).toMatchObject({
			limit: 250,
		})
		expect(mockCreateSyncJob).toHaveBeenCalledTimes(1)
		expect(mockMarkSyncJobRunning).toHaveBeenCalledWith(
			"retention-job-1",
			"unified-scheduler",
			"Opprydding av gamle sync-jobber pågår",
		)
		expect(mockMarkSyncJobCompleted).toHaveBeenCalledTimes(1)
		expect(mockMarkSyncJobFailed).not.toHaveBeenCalled()
		expect(result).toEqual({
			deletedCount: 2,
			retentionDays: 120,
			batchSize: 250,
		})
		expect(mockLoggerInfo).toHaveBeenCalled()
	})
})
