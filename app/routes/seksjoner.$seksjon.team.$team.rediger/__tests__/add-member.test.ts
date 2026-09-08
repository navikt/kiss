import { beforeEach, describe, expect, it, vi } from "vitest"

// --- Mocks -----------------------------------------------------------

const mockRequireAuthenticatedUser = vi.fn()
vi.mock("~/lib/auth.server", () => ({
	requireAuthenticatedUser: (...args: unknown[]) => mockRequireAuthenticatedUser(...args),
}))

const mockCanManageTeam = vi.fn((..._args: unknown[]) => true)
const mockCanManageSection = vi.fn((..._args: unknown[]) => true)
vi.mock("~/lib/authorization.server", () => ({
	canManageTeam: (...args: unknown[]) => mockCanManageTeam(...args),
	canManageSection: (...args: unknown[]) => mockCanManageSection(...args),
}))

const mockGetTeamBySlug = vi.fn()
const mockGetSectionBySlug = vi.fn()
vi.mock("~/db/queries/sections.server", () => ({
	getTeamBySlug: (...args: unknown[]) => mockGetTeamBySlug(...args),
	getSectionBySlug: (...args: unknown[]) => mockGetSectionBySlug(...args),
	getTeamApps: vi.fn(),
	archiveTeam: vi.fn(),
	unarchiveTeam: vi.fn(),
	updateTeam: vi.fn(),
	getNaisTeamsForDevTeam: vi.fn(),
	linkNaisTeamToDevTeam: vi.fn(),
	unlinkNaisTeamFromDevTeam: vi.fn(),
}))

const mockAssignRole = vi.fn()
vi.mock("~/db/queries/users.server", () => ({
	assignRole: (...args: unknown[]) => mockAssignRole(...args),
	getTeamMemberRoleById: vi.fn(),
	getTeamMemberRoles: vi.fn(),
	removeRole: vi.fn(),
}))

const mockGetActiveDevTeamEntraMembers = vi.fn()
vi.mock("~/db/queries/dev-team-entra.server", () => ({
	getActiveDevTeamEntraMembers: (...args: unknown[]) => mockGetActiveDevTeamEntraMembers(...args),
	linkEntraGroupToTeam: vi.fn(),
	unlinkEntraGroupFromTeam: vi.fn(),
}))

const mockGetUserByNavIdent = vi.fn()
vi.mock("~/lib/graph.server", () => ({
	getUserByNavIdent: (...args: unknown[]) => mockGetUserByNavIdent(...args),
}))

vi.mock("~/db/queries/applications.server", () => ({
	getAvailableAppsForTeam: vi.fn(),
	linkAppToTeam: vi.fn(),
	unlinkAppFromTeam: vi.fn(),
}))

vi.mock("~/db/queries/nais.server", () => ({
	getNaisTeamsForSection: vi.fn(),
}))

vi.mock("~/lib/entra-team-sync.server", () => ({
	syncSingleDevTeamEntraGroup: vi.fn(),
}))

const { action } = await import("../index")

// --- Helpers ---------------------------------------------------------

function makeRequest(formData: FormData): Request {
	return new Request("http://localhost/seksjoner/pensjon-og-ufore/team/starte-pensjon/rediger", {
		method: "POST",
		body: formData,
	})
}

const baseTeamRecord = {
	id: "team-1",
	sectionId: "section-1",
	archivedAt: null,
	entraGroupId: null as string | null,
}

beforeEach(() => {
	vi.clearAllMocks()
	mockCanManageTeam.mockReturnValue(true)
	mockCanManageSection.mockReturnValue(true)
	mockRequireAuthenticatedUser.mockResolvedValue({ navIdent: "Z990099" })
	mockGetSectionBySlug.mockResolvedValue({ id: "section-1" })
})

describe("action: add-member", () => {
	it("bruker fritekst-person + Graph-oppslag for team uten Entra-kobling", async () => {
		mockGetTeamBySlug.mockResolvedValue({ ...baseTeamRecord, entraGroupId: null })
		mockGetUserByNavIdent.mockResolvedValue({ displayName: "Glad Fjord" })

		const formData = new FormData()
		formData.set("intent", "add-member")
		formData.set("person", JSON.stringify({ navIdent: "z990001", displayName: "ignorert" }))
		formData.set("role", "developer")

		const response = await action({ request: makeRequest(formData), params: { seksjon: "s", team: "t" } } as never)

		expect(mockGetUserByNavIdent).toHaveBeenCalledWith("Z990001")
		expect(mockAssignRole).toHaveBeenCalledWith("Z990001", "Glad Fjord", "developer", "Z990099", undefined, "team-1")
		expect(response).toBeInstanceOf(Response)
	})

	it("krever at navIdent er et aktivt Entra-gruppemedlem for Entra-koblet team", async () => {
		mockGetTeamBySlug.mockResolvedValue({ ...baseTeamRecord, entraGroupId: "group-1" })
		mockGetActiveDevTeamEntraMembers.mockResolvedValue([{ navIdent: "Z990004", displayName: "Snill Bre" }])

		const formData = new FormData()
		formData.set("intent", "add-member")
		formData.set("person", "Z990001")
		formData.set("role", "tech_lead")

		await expect(
			action({ request: makeRequest(formData), params: { seksjon: "s", team: "t" } } as never),
		).rejects.toMatchObject({ status: 400 })
		expect(mockAssignRole).not.toHaveBeenCalled()
		expect(mockGetUserByNavIdent).not.toHaveBeenCalled()
	})

	it("avviser whitespace-only person for Entra-koblet team uten å kalle getActiveDevTeamEntraMembers", async () => {
		mockGetTeamBySlug.mockResolvedValue({ ...baseTeamRecord, entraGroupId: "group-1" })

		const formData = new FormData()
		formData.set("intent", "add-member")
		formData.set("person", "   ")
		formData.set("role", "tech_lead")

		await expect(
			action({ request: makeRequest(formData), params: { seksjon: "s", team: "t" } } as never),
		).rejects.toMatchObject({ status: 400 })
		expect(mockGetActiveDevTeamEntraMembers).not.toHaveBeenCalled()
		expect(mockAssignRole).not.toHaveBeenCalled()
	})

	it("tildeler rolle fra synket displayName uten Graph-oppslag for Entra-koblet team", async () => {
		mockGetTeamBySlug.mockResolvedValue({ ...baseTeamRecord, entraGroupId: "group-1" })
		mockGetActiveDevTeamEntraMembers.mockResolvedValue([{ navIdent: "Z990004", displayName: "Snill Bre" }])

		const formData = new FormData()
		formData.set("intent", "add-member")
		formData.set("person", "z990004")
		formData.set("role", "product_owner")

		await action({ request: makeRequest(formData), params: { seksjon: "s", team: "t" } } as never)

		expect(mockGetUserByNavIdent).not.toHaveBeenCalled()
		expect(mockAssignRole).toHaveBeenCalledWith("Z990004", "Snill Bre", "product_owner", "Z990099", undefined, "team-1")
	})

	it("faller tilbake til navIdent hvis synket displayName er tom/whitespace", async () => {
		mockGetTeamBySlug.mockResolvedValue({ ...baseTeamRecord, entraGroupId: "group-1" })
		mockGetActiveDevTeamEntraMembers.mockResolvedValue([{ navIdent: "Z990004", displayName: "   " }])

		const formData = new FormData()
		formData.set("intent", "add-member")
		formData.set("person", "z990004")
		formData.set("role", "product_owner")

		await action({ request: makeRequest(formData), params: { seksjon: "s", team: "t" } } as never)

		expect(mockAssignRole).toHaveBeenCalledWith("Z990004", "Z990004", "product_owner", "Z990099", undefined, "team-1")
	})

	it("avviser developer-rolle for Entra-koblet team", async () => {
		mockGetTeamBySlug.mockResolvedValue({ ...baseTeamRecord, entraGroupId: "group-1" })

		const formData = new FormData()
		formData.set("intent", "add-member")
		formData.set("person", "Z990004")
		formData.set("role", "developer")

		await expect(
			action({ request: makeRequest(formData), params: { seksjon: "s", team: "t" } } as never),
		).rejects.toMatchObject({ status: 400 })
		expect(mockAssignRole).not.toHaveBeenCalled()
	})

	it("avviser elevated-rolletildeling for Entra-koblet team uten canManageSection", async () => {
		mockCanManageSection.mockReturnValue(false)
		mockGetTeamBySlug.mockResolvedValue({ ...baseTeamRecord, entraGroupId: "group-1" })
		mockGetActiveDevTeamEntraMembers.mockResolvedValue([{ navIdent: "Z990004", displayName: "Snill Bre" }])

		const formData = new FormData()
		formData.set("intent", "add-member")
		formData.set("person", "Z990004")
		formData.set("role", "tech_lead")

		await expect(
			action({ request: makeRequest(formData), params: { seksjon: "s", team: "t" } } as never),
		).rejects.toMatchObject({ status: 403 })
		expect(mockAssignRole).not.toHaveBeenCalled()
	})
})
