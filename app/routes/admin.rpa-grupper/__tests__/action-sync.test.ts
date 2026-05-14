import { beforeEach, describe, expect, it, vi } from "vitest"

const mockGetAuthenticatedUser = vi.fn()
const mockRequireUser = vi.fn()
vi.mock("~/lib/auth.server", () => ({
	getAuthenticatedUser: mockGetAuthenticatedUser,
	requireUser: mockRequireUser,
}))

const mockRequireAdmin = vi.fn()
vi.mock("~/lib/authorization.server", () => ({
	requireAdmin: mockRequireAdmin,
}))

vi.mock("~/db/queries/audit.server", () => ({
	getAuditLogByAction: vi.fn().mockResolvedValue([]),
}))

vi.mock("~/db/queries/rpa.server", () => ({
	addRpaGroup: vi.fn(),
	getActiveRpaGroups: vi.fn().mockResolvedValue([]),
	getAllActiveRpaMembers: vi.fn().mockResolvedValue([]),
	getMemberCountPerRpaGroup: vi.fn().mockResolvedValue([]),
	removeRpaGroup: vi.fn(),
}))

const mockRunRpaGroupMemberSync = vi.fn()
vi.mock("~/lib/rpa-sync.server", () => ({
	runRpaGroupMemberSync: mockRunRpaGroupMemberSync,
	syncSingleRpaGroup: vi.fn(),
}))

const mockCreateRpaSyncJob = vi.fn()
const mockMarkRunning = vi.fn()
const mockMarkCompleted = vi.fn()
const mockMarkFailed = vi.fn()
const mockMarkSkipped = vi.fn()
vi.mock("~/lib/rpa-sync-jobs.server", () => ({
	createRpaSyncJob: mockCreateRpaSyncJob,
	markRpaSyncJobRunning: mockMarkRunning,
	markRpaSyncJobCompleted: mockMarkCompleted,
	markRpaSyncJobFailed: mockMarkFailed,
	markRpaSyncJobSkipped: mockMarkSkipped,
}))

const { action } = await import("../index")

describe("admin.rpa-grupper action sync-all", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		const user = { navIdent: "Z123456", name: "Admin", groups: [], token: "token" }
		mockGetAuthenticatedUser.mockResolvedValue(user)
		mockRequireUser.mockReturnValue(user)
		mockRequireAdmin.mockImplementation(() => {})
		mockCreateRpaSyncJob.mockResolvedValue({ id: "job-1" })
		mockRunRpaGroupMemberSync.mockResolvedValue({ groupsSynced: 2, totalAdded: 5, totalArchived: 1 })
	})

	it("returns started response with jobId and marks job running", async () => {
		const formData = new FormData()
		formData.set("intent", "sync-all")

		const response = (await action({
			request: new Request("http://localhost/admin/rpa-grupper", { method: "POST", body: formData }),
			params: {},
			context: {},
		} as unknown as Parameters<typeof action>[0])) as { started?: boolean; jobId?: string }

		expect(response.started).toBe(true)
		expect(response.jobId).toBe("job-1")
		expect(mockCreateRpaSyncJob).toHaveBeenCalledWith("Z123456")
		expect(mockMarkRunning).toHaveBeenCalledWith("job-1", "Z123456")
		expect(mockRunRpaGroupMemberSync).toHaveBeenCalledWith({ force: true, jobId: "job-1" })
		expect(mockMarkRunning.mock.invocationCallOrder[0]).toBeLessThan(
			mockRunRpaGroupMemberSync.mock.invocationCallOrder[0],
		)
	})
})
