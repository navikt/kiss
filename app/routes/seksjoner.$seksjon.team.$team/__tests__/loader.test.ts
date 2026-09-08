import { beforeEach, describe, expect, it, vi } from "vitest"

// --- Mocks -----------------------------------------------------------

const mockGetAuthenticatedUser = vi.fn()
vi.mock("~/lib/auth.server", () => ({
	getAuthenticatedUser: (...args: unknown[]) => mockGetAuthenticatedUser(...args),
	requireAuthenticatedUser: vi.fn(),
}))

const mockCanManageTeam = vi.fn((..._args: unknown[]) => false)
vi.mock("~/lib/authorization.server", () => ({
	canManageTeam: (...args: unknown[]) => mockCanManageTeam(...args),
}))

const mockGetTeamApps = vi.fn()
const mockGetSectionBySlug = vi.fn()
vi.mock("~/db/queries/sections.server", () => ({
	getTeamApps: (...args: unknown[]) => mockGetTeamApps(...args),
	getSectionBySlug: (...args: unknown[]) => mockGetSectionBySlug(...args),
	getTeamBySlug: vi.fn(),
}))

const mockGetUsersForTeam = vi.fn()
vi.mock("~/db/queries/users.server", () => ({
	getUsersForTeam: (...args: unknown[]) => mockGetUsersForTeam(...args),
}))

const mockGetActiveDevTeamEntraMembers = vi.fn()
vi.mock("~/db/queries/dev-team-entra.server", () => ({
	getActiveDevTeamEntraMembers: (...args: unknown[]) => mockGetActiveDevTeamEntraMembers(...args),
}))

vi.mock("~/db/queries/applications.server", () => ({
	getAvailableAppsForTeam: vi.fn().mockResolvedValue([]),
	linkAppToTeam: vi.fn(),
}))

vi.mock("~/db/queries/deployment-audit.server", () => ({
	getDeploymentVerificationAggregate: vi.fn().mockResolvedValue(new Map()),
}))

vi.mock("~/db/queries/routines.server", () => ({
	countOpenFollowUpPointsForApps: vi.fn().mockResolvedValue(0),
}))

vi.mock("~/db/queries/screening.server", () => ({
	getScreeningProgressForApps: vi.fn().mockResolvedValue(new Map()),
}))

const { loader } = await import("../index")

// --- Helpers ---------------------------------------------------------

function makeRequest(): Request {
	return new Request("http://localhost/seksjoner/pensjon-og-ufore/team/pensjon-opptjening")
}

function getPayload(result: Awaited<ReturnType<typeof loader>>) {
	if (!result || !("data" in result)) throw new Error("Loader returnerte ikke data()")
	return result.data as { teamUsers: Array<{ navIdent: string; name: string; roles: string[] }> }
}

const baseTeam = {
	id: "team-1",
	name: "Pensjon opptjening",
	slug: "pensjon-opptjening",
	sectionId: "section-1",
	entraGroupId: null as string | null,
}

const baseSection = { id: "section-1", name: "Pensjon og uføre" }

beforeEach(() => {
	vi.clearAllMocks()
	mockCanManageTeam.mockReturnValue(false)
	mockGetSectionBySlug.mockResolvedValue(baseSection)
	mockGetTeamApps.mockResolvedValue({ team: baseTeam, apps: [] })
	mockGetUsersForTeam.mockResolvedValue([])
	mockGetActiveDevTeamEntraMembers.mockResolvedValue([])
	mockGetAuthenticatedUser.mockResolvedValue({ navIdent: "Z990001", dbRoles: [] })
})

describe("loader — teamUsers for Entra-koblede team", () => {
	it("viser ikke Entra-medlemmer når teamet ikke er koblet til en Entra ID-gruppe", async () => {
		mockGetTeamApps.mockResolvedValue({ team: { ...baseTeam, entraGroupId: null }, apps: [] })
		mockGetUsersForTeam.mockResolvedValue([{ navIdent: "Z990002", name: "Rask Elv", roles: ["tech_lead"] }])

		const result = await loader({
			request: makeRequest(),
			params: { seksjon: "pensjon-og-ufore", team: "pensjon-opptjening" },
			context: {},
		} as unknown as Parameters<typeof loader>[0])
		const payload = getPayload(result)

		expect(mockGetActiveDevTeamEntraMembers).not.toHaveBeenCalled()
		expect(payload.teamUsers).toEqual([{ navIdent: "Z990002", name: "Rask Elv", roles: ["tech_lead"] }])
	})

	it("slår sammen synkroniserte Entra-medlemmer med KISS-forvaltede roller for Entra-koblede team", async () => {
		mockGetTeamApps.mockResolvedValue({ team: { ...baseTeam, entraGroupId: "entra-group-1" }, apps: [] })
		mockGetUsersForTeam.mockResolvedValue([{ navIdent: "Z990002", name: "Rask Elv", roles: ["tech_lead"] }])
		mockGetActiveDevTeamEntraMembers.mockResolvedValue([
			{ navIdent: "Z990002", displayName: "Rask Elv" },
			{ navIdent: "Z990003", displayName: "Glad Fjord" },
		])

		const result = await loader({
			request: makeRequest(),
			params: { seksjon: "pensjon-og-ufore", team: "pensjon-opptjening" },
			context: {},
		} as unknown as Parameters<typeof loader>[0])
		const payload = getPayload(result)

		expect(mockGetActiveDevTeamEntraMembers).toHaveBeenCalledWith("team-1")
		expect(payload.teamUsers).toEqual(
			expect.arrayContaining([
				{ navIdent: "Z990002", name: "Rask Elv", roles: ["tech_lead"] },
				{ navIdent: "Z990003", name: "Glad Fjord", roles: ["developer"] },
			]),
		)
		expect(payload.teamUsers).toHaveLength(2)
	})

	it("bruker navIdent som visningsnavn når displayName mangler for et Entra-medlem", async () => {
		mockGetTeamApps.mockResolvedValue({ team: { ...baseTeam, entraGroupId: "entra-group-1" }, apps: [] })
		mockGetActiveDevTeamEntraMembers.mockResolvedValue([{ navIdent: "Z990004", displayName: "  " }])

		const result = await loader({
			request: makeRequest(),
			params: { seksjon: "pensjon-og-ufore", team: "pensjon-opptjening" },
			context: {},
		} as unknown as Parameters<typeof loader>[0])
		const payload = getPayload(result)

		expect(payload.teamUsers).toEqual([{ navIdent: "Z990004", name: "Z990004", roles: ["developer"] }])
	})

	it("dedupliserer navIdent case-insensitivt og med whitespace, og sorterer alfabetisk på navn", async () => {
		mockGetTeamApps.mockResolvedValue({ team: { ...baseTeam, entraGroupId: "entra-group-1" }, apps: [] })
		mockGetUsersForTeam.mockResolvedValue([{ navIdent: " z990002 ", name: "Rask Elv", roles: ["tech_lead"] }])
		mockGetActiveDevTeamEntraMembers.mockResolvedValue([
			{ navIdent: "Z990002", displayName: "Rask Elv" },
			{ navIdent: "Z990001", displayName: "Blid Skog" },
		])

		const result = await loader({
			request: makeRequest(),
			params: { seksjon: "pensjon-og-ufore", team: "pensjon-opptjening" },
			context: {},
		} as unknown as Parameters<typeof loader>[0])
		const payload = getPayload(result)

		expect(payload.teamUsers).toHaveLength(2)
		expect(payload.teamUsers.map((u) => u.name)).toEqual(["Blid Skog", "Rask Elv"])
		expect(payload.teamUsers).toEqual(
			expect.arrayContaining([{ navIdent: " z990002 ", name: "Rask Elv", roles: ["tech_lead"] }]),
		)
	})
})
