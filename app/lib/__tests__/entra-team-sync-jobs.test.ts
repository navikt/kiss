import { beforeEach, describe, expect, it, vi } from "vitest"
import { SYNC_JOB_TYPES } from "~/lib/sync-job-types"

const mockCreateSyncJob = vi.fn()
const mockGetSyncJob = vi.fn()
const mockMarkSyncJobRunning = vi.fn()
const mockMarkSyncJobCompleted = vi.fn()
const mockMarkSyncJobSkipped = vi.fn()
const mockMarkSyncJobFailed = vi.fn()
const mockRunEntraTeamMemberSync = vi.fn()

vi.mock("~/db/queries/sync-jobs.server", () => ({
	createSyncJob: mockCreateSyncJob,
	getSyncJob: mockGetSyncJob,
	markSyncJobRunning: mockMarkSyncJobRunning,
	markSyncJobCompleted: mockMarkSyncJobCompleted,
	markSyncJobSkipped: mockMarkSyncJobSkipped,
	markSyncJobFailed: mockMarkSyncJobFailed,
}))

vi.mock("~/lib/entra-team-sync.server", () => ({
	runEntraTeamMemberSync: mockRunEntraTeamMemberSync,
}))

const { createEntraTeamSyncJob, getEntraTeamSyncJob, runTrackedEntraTeamMemberSync } = await import(
	"~/lib/entra-team-sync-jobs.server"
)

function pendingJob() {
	return {
		id: "job-1",
		jobType: SYNC_JOB_TYPES.ENTRA_TEAM_MEMBER_SYNC,
		scopeType: null,
		scopeId: null,
		state: "pending",
		createdAt: new Date().toISOString(),
		startedAt: null,
		finishedAt: null,
		message: "Venter på start",
		result: null,
		error: null,
	}
}

describe("entra team sync jobs wrapper", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockCreateSyncJob.mockResolvedValue(pendingJob())
	})

	it("oppretter jobb med riktig jobType", async () => {
		await createEntraTeamSyncJob("Z123456")
		expect(mockCreateSyncJob).toHaveBeenCalledWith({
			jobType: SYNC_JOB_TYPES.ENTRA_TEAM_MEMBER_SYNC,
			performedBy: "Z123456",
			message: "Venter på start",
		})
	})

	it("filtrerer henting på riktig jobType", async () => {
		mockGetSyncJob.mockResolvedValue({ ...pendingJob(), state: "completed" })
		await getEntraTeamSyncJob("job-1")
		expect(mockGetSyncJob).toHaveBeenCalledWith("job-1", SYNC_JOB_TYPES.ENTRA_TEAM_MEMBER_SYNC)
	})

	it("markerer jobb completed med resultatet fra sync-kjøringen", async () => {
		mockRunEntraTeamMemberSync.mockResolvedValue({
			teamsSynced: 2,
			teamsGroupDeleted: 1,
			totalAdded: 3,
			totalArchived: 1,
		})

		const result = await runTrackedEntraTeamMemberSync({ performedBy: "Z123456" })

		expect(result.state).toBe("completed")
		expect(mockMarkSyncJobCompleted).toHaveBeenCalledWith(
			"job-1",
			{ teamsSynced: 2, teamsGroupDeleted: 1, totalAdded: 3, totalArchived: 1 },
			"Z123456",
			expect.stringContaining("2 team"),
		)
	})

	it("markerer jobb skipped når sync returnerer null (annen pod holder låsen)", async () => {
		mockRunEntraTeamMemberSync.mockResolvedValue(null)

		const result = await runTrackedEntraTeamMemberSync({ performedBy: "Z123456" })

		expect(result.state).toBe("skipped")
		expect(mockMarkSyncJobSkipped).toHaveBeenCalled()
	})

	it("markerer jobb failed og rekaster ved feil i sync-kjøringen", async () => {
		mockRunEntraTeamMemberSync.mockRejectedValue(new Error("boom"))

		await expect(runTrackedEntraTeamMemberSync({ performedBy: "Z123456" })).rejects.toThrow("boom")
		expect(mockMarkSyncJobFailed).toHaveBeenCalledWith("job-1", "boom", "Z123456", "Synkronisering feilet")
	})
})
