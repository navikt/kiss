import { beforeEach, describe, expect, it, vi } from "vitest"
import { SYNC_JOB_TYPES } from "~/lib/sync-job-types"

const mockCreateSyncJob = vi.fn()
const mockMarkSyncJobRunning = vi.fn()
const mockMarkSyncJobCompleted = vi.fn()
const mockMarkSyncJobSkipped = vi.fn()
const mockMarkSyncJobFailed = vi.fn()
const mockSyncAllApplicationControls = vi.fn()

vi.mock("~/db/queries/sync-jobs.server", () => ({
	createSyncJob: mockCreateSyncJob,
	markSyncJobRunning: mockMarkSyncJobRunning,
	markSyncJobCompleted: mockMarkSyncJobCompleted,
	markSyncJobSkipped: mockMarkSyncJobSkipped,
	markSyncJobFailed: mockMarkSyncJobFailed,
}))

vi.mock("~/db/queries/application-controls.server", () => ({
	syncAllApplicationControls: mockSyncAllApplicationControls,
}))

const { runTrackedComplianceSync } = await import("~/lib/compliance-sync-jobs.server")

describe("compliance sync jobs wrapper", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockCreateSyncJob.mockResolvedValue({ id: "job-1" })
	})

	it("marks completed on successful run", async () => {
		mockSyncAllApplicationControls.mockResolvedValue({ synced: 10, errors: 1 })

		const result = await runTrackedComplianceSync({
			performedBy: "unified-scheduler",
			scopeType: "scheduler",
			scopeId: "unified-scheduler",
		})

		expect(result.jobId).toBe("job-1")
		expect(result.state).toBe("completed")
		expect(result.result?.synced).toBe(10)
		expect(mockCreateSyncJob).toHaveBeenCalledWith({
			jobType: SYNC_JOB_TYPES.COMPLIANCE_SYNC,
			performedBy: "unified-scheduler",
			scopeType: "scheduler",
			scopeId: "unified-scheduler",
			message: "Venter på start",
		})
		expect(mockMarkSyncJobCompleted).toHaveBeenCalled()
		expect(mockMarkSyncJobSkipped).not.toHaveBeenCalled()
		expect(mockSyncAllApplicationControls).toHaveBeenCalledWith("unified-scheduler", { returnNullWhenLocked: true })
	})

	it("marks skipped when lock is held", async () => {
		mockSyncAllApplicationControls.mockResolvedValue(null)

		const result = await runTrackedComplianceSync({
			performedBy: "unified-scheduler",
		})

		expect(result).toEqual({
			jobId: "job-1",
			state: "skipped",
			result: null,
		})
		expect(mockMarkSyncJobSkipped).toHaveBeenCalledWith(
			"job-1",
			"Synkronisering pågår allerede i en annen prosess.",
			"unified-scheduler",
		)
	})

	it("marks failed and rethrows when sync run fails", async () => {
		const error = new Error("boom")
		mockSyncAllApplicationControls.mockRejectedValue(error)

		await expect(
			runTrackedComplianceSync({
				performedBy: "unified-scheduler",
			}),
		).rejects.toThrow("boom")

		expect(mockMarkSyncJobFailed).toHaveBeenCalledWith("job-1", "boom", "unified-scheduler", "Synkronisering feilet")
		expect(mockMarkSyncJobCompleted).not.toHaveBeenCalled()
		expect(mockMarkSyncJobSkipped).not.toHaveBeenCalled()
	})
})
