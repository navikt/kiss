import { beforeEach, describe, expect, it, vi } from "vitest"

const mockGetDevTeamsWithEntraGroup = vi.fn()
const mockSyncDevTeamEntraMembers = vi.fn()
const mockClearDevTeamEntraMembers = vi.fn()
const mockFetchTeamEntraMembers = vi.fn()
const mockWithAdvisoryLock = vi.fn(async (_name: string, fn: () => Promise<unknown>) => fn())

vi.mock("~/db/queries/dev-team-entra.server", () => ({
	getDevTeamsWithEntraGroup: mockGetDevTeamsWithEntraGroup,
	syncDevTeamEntraMembers: mockSyncDevTeamEntraMembers,
	clearDevTeamEntraMembers: mockClearDevTeamEntraMembers,
}))

vi.mock("~/lib/graph.server", () => ({
	fetchTeamEntraMembers: mockFetchTeamEntraMembers,
}))

vi.mock("~/lib/lock.server", () => ({
	withAdvisoryLock: (...args: unknown[]) => mockWithAdvisoryLock(...(args as [string, () => Promise<unknown>])),
}))

vi.mock("~/lib/logger.server", () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const { runEntraTeamMemberSync } = await import("~/lib/entra-team-sync.server")

const TEAM_A = { devTeamId: "team-a", entraGroupId: "group-a", teamName: "Team A" }
const TEAM_B = { devTeamId: "team-b", entraGroupId: "group-b", teamName: "Team B" }

describe("runEntraTeamMemberSync", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockWithAdvisoryLock.mockImplementation(async (_name: string, fn: () => Promise<unknown>) => fn())
	})

	it("returnerer nullstilt resultat når ingen team er koblet til en Entra-gruppe", async () => {
		mockGetDevTeamsWithEntraGroup.mockResolvedValue([])

		const result = await runEntraTeamMemberSync()

		expect(result).toEqual({ teamsSynced: 0, teamsGroupDeleted: 0, totalAdded: 0, totalArchived: 0 })
		expect(mockFetchTeamEntraMembers).not.toHaveBeenCalled()
	})

	it("synker team med vellykket Graph-svar, sender med forventet entraGroupId (race-guard)", async () => {
		mockGetDevTeamsWithEntraGroup.mockResolvedValue([TEAM_A])
		mockFetchTeamEntraMembers.mockResolvedValue([{ navIdent: "Z990001", displayName: "Glad Fjord", mail: null }])
		mockSyncDevTeamEntraMembers.mockResolvedValue({ added: 1, updated: 0, archived: 0, skipped: false })

		const result = await runEntraTeamMemberSync({ jobId: "job-1" })

		expect(result).toEqual({ teamsSynced: 1, teamsGroupDeleted: 0, totalAdded: 1, totalArchived: 0 })
		expect(mockSyncDevTeamEntraMembers).toHaveBeenCalledWith(
			"team-a",
			"group-a",
			[{ navIdent: "Z990001", displayName: "Glad Fjord", mail: null }],
			"system:entra-team-sync",
			"job-1",
		)
	})

	it("tømmer cache umiddelbart når Graph returnerer null (gruppe slettet)", async () => {
		mockGetDevTeamsWithEntraGroup.mockResolvedValue([TEAM_A])
		mockFetchTeamEntraMembers.mockResolvedValue(null)
		mockClearDevTeamEntraMembers.mockResolvedValue({ archived: 3, skipped: false })

		const result = await runEntraTeamMemberSync()

		expect(mockClearDevTeamEntraMembers).toHaveBeenCalledWith("team-a", "group-a", "system:entra-team-sync", undefined)
		expect(mockSyncDevTeamEntraMembers).not.toHaveBeenCalled()
		expect(result).toEqual({ teamsSynced: 0, teamsGroupDeleted: 1, totalAdded: 0, totalArchived: 3 })
	})

	it("teller ikke team som skipped når query-laget oppdager at teamet er av-/omkoblet (race)", async () => {
		mockGetDevTeamsWithEntraGroup.mockResolvedValue([TEAM_A])
		mockFetchTeamEntraMembers.mockResolvedValue([{ navIdent: "Z990001", displayName: "Glad Fjord", mail: null }])
		mockSyncDevTeamEntraMembers.mockResolvedValue({ added: 0, updated: 0, archived: 0, skipped: true })

		const result = await runEntraTeamMemberSync()

		expect(result).toEqual({ teamsSynced: 0, teamsGroupDeleted: 0, totalAdded: 0, totalArchived: 0 })
	})

	it("beholder cache uendret når Graph-kallet kaster (transient feil)", async () => {
		mockGetDevTeamsWithEntraGroup.mockResolvedValue([TEAM_A, TEAM_B])
		mockFetchTeamEntraMembers.mockImplementation(async (groupId: string) => {
			if (groupId === "group-a") throw new Error("Graph API nede")
			return [{ navIdent: "Z990002", displayName: "Rask Elv", mail: null }]
		})
		mockSyncDevTeamEntraMembers.mockResolvedValue({ added: 1, updated: 0, archived: 0, skipped: false })

		const result = await runEntraTeamMemberSync()

		// Kun team B (vellykket Graph-kall) skal synkes — team A sin cache røres ikke
		expect(mockSyncDevTeamEntraMembers).toHaveBeenCalledTimes(1)
		expect(mockSyncDevTeamEntraMembers).toHaveBeenCalledWith(
			"team-b",
			"group-b",
			expect.any(Array),
			"system:entra-team-sync",
			undefined,
		)
		expect(mockClearDevTeamEntraMembers).not.toHaveBeenCalled()
		expect(result?.teamsSynced).toBe(1)
	})

	it("returnerer null når advisory-låsen allerede holdes av en annen pod", async () => {
		mockGetDevTeamsWithEntraGroup.mockResolvedValue([TEAM_A])
		mockFetchTeamEntraMembers.mockResolvedValue([])
		mockWithAdvisoryLock.mockResolvedValue(null)

		const result = await runEntraTeamMemberSync()

		expect(result).toBeNull()
	})
})
