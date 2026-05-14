import { beforeEach, describe, expect, it, vi } from "vitest"

const mockCreateSyncJob = vi.fn()
const mockMarkSyncJobRunning = vi.fn()
const mockMarkSyncJobCompleted = vi.fn()
const mockMarkSyncJobSkipped = vi.fn()
const mockMarkSyncJobFailed = vi.fn()

vi.mock("~/db/queries/sync-jobs.server", () => ({
	createSyncJob: mockCreateSyncJob,
	markSyncJobRunning: mockMarkSyncJobRunning,
	markSyncJobCompleted: mockMarkSyncJobCompleted,
	markSyncJobSkipped: mockMarkSyncJobSkipped,
	markSyncJobFailed: mockMarkSyncJobFailed,
}))

const mockRunFullNaisSync = vi.fn()
vi.mock("~/lib/nais-sync.server", () => ({
	runFullNaisSync: mockRunFullNaisSync,
}))

const { runTrackedNaisSync } = await import("~/lib/nais-sync-jobs.server")

describe("nais sync jobs wrapper", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockCreateSyncJob.mockResolvedValue({ id: "job-1" })
	})

	it("marks completed on successful sync", async () => {
		mockRunFullNaisSync.mockResolvedValue({
			teams: { discovered: 2, new: 1, skipped: 1 },
			apps: [{ teamSlug: "team-a", result: { discovered: 3, new: 1, skipped: 2 } }],
		})

		const result = await runTrackedNaisSync({
			token: "token",
			performedBy: "Z123456",
			scopeType: "manual",
			scopeId: "admin",
		})

		expect(result.state).toBe("completed")
		expect(result.jobId).toBe("job-1")
		expect(mockCreateSyncJob).toHaveBeenCalledWith({
			jobType: "nais_full_sync",
			performedBy: "Z123456",
			scopeType: "manual",
			scopeId: "admin",
			message: "Venter på start",
		})
		expect(mockMarkSyncJobRunning).toHaveBeenCalledWith("job-1", "Z123456", "Synkronisering pågår")
		expect(mockMarkSyncJobCompleted).toHaveBeenCalled()
		expect(mockMarkSyncJobSkipped).not.toHaveBeenCalled()
		expect(mockMarkSyncJobFailed).not.toHaveBeenCalled()
	})

	it("marks skipped when lock is held", async () => {
		mockRunFullNaisSync.mockResolvedValue(null)

		const result = await runTrackedNaisSync({
			performedBy: "scheduler",
		})

		expect(result.state).toBe("skipped")
		expect(result.result).toBeNull()
		expect(mockMarkSyncJobSkipped).toHaveBeenCalledWith(
			"job-1",
			"Synkronisering pågår allerede i en annen prosess.",
			"scheduler",
		)
		expect(mockMarkSyncJobCompleted).not.toHaveBeenCalled()
		expect(mockMarkSyncJobFailed).not.toHaveBeenCalled()
	})

	it("marks failed and rethrows when sync run fails", async () => {
		const error = new Error("boom")
		mockRunFullNaisSync.mockRejectedValue(error)

		await expect(
			runTrackedNaisSync({
				performedBy: "scheduler",
			}),
		).rejects.toThrow("boom")

		expect(mockMarkSyncJobFailed).toHaveBeenCalledWith("job-1", "boom", "scheduler", "Synkronisering feilet")
		expect(mockMarkSyncJobCompleted).not.toHaveBeenCalled()
		expect(mockMarkSyncJobSkipped).not.toHaveBeenCalled()
	})

	it("does not mark failed when completion persistence fails", async () => {
		mockRunFullNaisSync.mockResolvedValue({
			teams: { discovered: 1, new: 0, skipped: 1 },
			apps: [],
		})
		mockMarkSyncJobCompleted.mockRejectedValue(new Error("db failure"))

		await expect(
			runTrackedNaisSync({
				performedBy: "scheduler",
			}),
		).rejects.toThrow("db failure")

		expect(mockMarkSyncJobFailed).not.toHaveBeenCalled()
	})
})
