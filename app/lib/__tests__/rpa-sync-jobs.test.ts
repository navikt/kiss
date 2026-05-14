import { beforeEach, describe, expect, it, vi } from "vitest"
import { SYNC_JOB_TYPES } from "~/lib/sync-job-types"

const mockCreateSyncJob = vi.fn()
const mockGetSyncJob = vi.fn()
const mockMarkSyncJobRunning = vi.fn()
const mockMarkSyncJobCompleted = vi.fn()
const mockMarkSyncJobSkipped = vi.fn()
const mockMarkSyncJobFailed = vi.fn()

vi.mock("~/db/queries/sync-jobs.server", () => ({
	createSyncJob: mockCreateSyncJob,
	getSyncJob: mockGetSyncJob,
	markSyncJobRunning: mockMarkSyncJobRunning,
	markSyncJobCompleted: mockMarkSyncJobCompleted,
	markSyncJobSkipped: mockMarkSyncJobSkipped,
	markSyncJobFailed: mockMarkSyncJobFailed,
}))

const {
	createRpaSyncJob,
	getRpaSyncJob,
	markRpaSyncJobCompleted,
	markRpaSyncJobFailed,
	markRpaSyncJobRunning,
	markRpaSyncJobSkipped,
} = await import("~/lib/rpa-sync-jobs.server")

describe("rpa sync jobs wrapper", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("creates job with fixed RPA job type", async () => {
		mockCreateSyncJob.mockResolvedValue({
			id: "job-1",
			jobType: SYNC_JOB_TYPES.RPA_GROUP_MEMBER_SYNC,
			scopeType: null,
			scopeId: null,
			state: "pending",
			createdAt: new Date().toISOString(),
			startedAt: null,
			finishedAt: null,
			message: "Venter på start",
			result: null,
			error: null,
		})

		await createRpaSyncJob("Z123456")

		expect(mockCreateSyncJob).toHaveBeenCalledWith({
			jobType: SYNC_JOB_TYPES.RPA_GROUP_MEMBER_SYNC,
			performedBy: "Z123456",
			message: "Venter på start",
		})
	})

	it("filters get by RPA job type", async () => {
		mockGetSyncJob.mockResolvedValue({
			id: "job-1",
			jobType: SYNC_JOB_TYPES.RPA_GROUP_MEMBER_SYNC,
			scopeType: null,
			scopeId: null,
			state: "completed",
			createdAt: new Date().toISOString(),
			startedAt: new Date().toISOString(),
			finishedAt: new Date().toISOString(),
			message: "Ferdig",
			result: { groupsSynced: 1, totalAdded: 2, totalArchived: 3 },
			error: null,
		})

		const job = await getRpaSyncJob("job-1")

		expect(mockGetSyncJob).toHaveBeenCalledWith("job-1", SYNC_JOB_TYPES.RPA_GROUP_MEMBER_SYNC)
		expect(job?.result).toEqual({ groupsSynced: 1, totalAdded: 2, totalArchived: 3 })
	})

	it("forwards state transitions to generic query helpers", async () => {
		await markRpaSyncJobRunning("job-1", "Z123456")
		await markRpaSyncJobCompleted("job-1", { groupsSynced: 1, totalAdded: 2, totalArchived: 3 }, "Z123456")
		await markRpaSyncJobSkipped("job-1", "Skippet", "Z123456")
		await markRpaSyncJobFailed("job-1", "Boom", "Z123456")

		expect(mockMarkSyncJobRunning).toHaveBeenCalledWith("job-1", "Z123456", "Synkronisering pågår")
		expect(mockMarkSyncJobCompleted).toHaveBeenCalledWith(
			"job-1",
			{ groupsSynced: 1, totalAdded: 2, totalArchived: 3 },
			"Z123456",
			"Synkronisering fullført: 1 grupper, +2 lagt til, -3 arkivert",
		)
		expect(mockMarkSyncJobSkipped).toHaveBeenCalledWith("job-1", "Skippet", "Z123456")
		expect(mockMarkSyncJobFailed).toHaveBeenCalledWith("job-1", "Boom", "Z123456", "Synkronisering feilet")
	})
})
