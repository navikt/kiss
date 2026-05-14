import { beforeEach, describe, expect, it, vi } from "vitest"

const mockSyncRpaGroupMembers = vi.fn()
const mockSyncRpaUserGroupMemberships = vi.fn()
const mockMarkRpaGroupSynced = vi.fn()

const mockFetchGroupMembers = vi.fn()
const mockFetchUserGroupMemberships = vi.fn()

vi.mock("~/db/queries/rpa.server", () => ({
	batchSyncRpaUserGroupMemberships: vi.fn(),
	cleanupOrphanedUserGroupMemberships: vi.fn(),
	getActiveRpaGroups: vi.fn(),
	getRpaGroupUpdatedAt: vi.fn(),
	markRpaGroupSynced: mockMarkRpaGroupSynced,
	syncRpaGroupMembers: mockSyncRpaGroupMembers,
	syncRpaUserGroupMemberships: mockSyncRpaUserGroupMemberships,
}))

vi.mock("~/lib/graph.server", () => ({
	fetchGroupMembers: mockFetchGroupMembers,
	fetchUserGroupMemberships: mockFetchUserGroupMemberships,
}))

vi.mock("~/lib/lock.server", () => ({
	withAdvisoryLock: vi.fn(async (_name: string, fn: () => Promise<unknown>) => fn()),
}))

vi.mock("~/lib/logger.server", () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}))

const { syncSingleRpaGroup } = await import("~/lib/rpa-sync.server")

describe("syncSingleRpaGroup", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockSyncRpaGroupMembers.mockResolvedValue({ added: 1, updated: 0, archived: 0 })
		mockSyncRpaUserGroupMemberships.mockResolvedValue(undefined)
		mockMarkRpaGroupSynced.mockResolvedValue(undefined)
	})

	it("marks group as synced when all membership lookups succeed", async () => {
		mockFetchGroupMembers.mockResolvedValue([
			{ userObjectId: "u1", displayName: "U1" },
			{ userObjectId: "u2", displayName: "U2" },
		])
		mockFetchUserGroupMemberships.mockResolvedValue([{ groupId: "g1", displayName: "G1" }])

		await syncSingleRpaGroup("db-group-1", "entra-group-1", "Testgruppe")

		expect(mockMarkRpaGroupSynced).toHaveBeenCalledTimes(1)
		expect(mockMarkRpaGroupSynced).toHaveBeenCalledWith("db-group-1")
	})

	it("does not mark group as synced when any membership lookup fails", async () => {
		mockFetchGroupMembers.mockResolvedValue([
			{ userObjectId: "u1", displayName: "U1" },
			{ userObjectId: "u2", displayName: "U2" },
		])
		mockFetchUserGroupMemberships.mockImplementation(async (userObjectId: string) => {
			if (userObjectId === "u1") throw new Error("memberOf failed")
			return [{ groupId: "g2", displayName: "G2" }]
		})

		await syncSingleRpaGroup("db-group-1", "entra-group-1", "Testgruppe")

		expect(mockMarkRpaGroupSynced).not.toHaveBeenCalled()
	})
})
