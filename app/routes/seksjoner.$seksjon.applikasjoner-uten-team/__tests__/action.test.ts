import { beforeEach, describe, expect, it, vi } from "vitest"

// --- Mocks -----------------------------------------------------------

const mockGetAuthenticatedUser = vi.fn()
const mockRequireUser = vi.fn()
vi.mock("~/lib/auth.server", () => ({
	getAuthenticatedUser: mockGetAuthenticatedUser,
	requireUser: mockRequireUser,
}))

const mockCanManageTeam = vi.fn()
vi.mock("~/lib/authorization.server", () => ({
	canManageTeam: mockCanManageTeam,
	isAdmin: vi.fn(() => false),
}))

const mockGetSectionDetail = vi.fn()
const mockGetTeamsForSection = vi.fn()
vi.mock("~/db/queries/sections.server", () => ({
	getSectionDetail: mockGetSectionDetail,
	getTeamsForSection: mockGetTeamsForSection,
}))

const mockGetUnassignedAppsForSection = vi.fn()
vi.mock("~/db/queries/nais.server", () => ({
	getUnassignedAppsForSection: mockGetUnassignedAppsForSection,
}))

const mockLinkAppToTeam = vi.fn()
vi.mock("~/db/queries/applications.server", () => ({
	linkAppToTeam: mockLinkAppToTeam,
}))

const { action } = await import("../index")

// --- Helpers ---------------------------------------------------------

function makeRequest(formData: FormData) {
	return new Request("http://localhost/seksjoner/test-seksjon/applikasjoner-uten-team", {
		method: "POST",
		body: formData,
	})
}

function callAction(formData: FormData, seksjon = "test-seksjon") {
	return action({
		request: makeRequest(formData),
		params: { seksjon },
		context: {},
	} as unknown as Parameters<typeof action>[0])
}

const teamLeadUser = {
	navIdent: "Z999999",
	name: "Team Lead",
	groups: [],
	token: "test-token",
	dbRoles: [{ role: "tech_lead", devTeamId: "team-1", sectionId: null, devTeamSectionId: null }],
}

const regularUser = {
	navIdent: "Z888888",
	name: "Vanlig Bruker",
	groups: [],
	token: "test-token",
	dbRoles: [],
}

const mockSection = {
	section: { id: "sec-1", name: "Test Seksjon", slug: "test-seksjon", description: "Beskrivelse" },
}

const mockTeams = [
	{ id: "team-1", name: "Team Alfa", slug: "team-alfa", sectionId: "sec-1" },
	{ id: "team-2", name: "Team Beta", slug: "team-beta", sectionId: "sec-1" },
]

const mockUnassignedApps = [
	{ appId: "app-1", appName: "app-en", naisTeamSlug: "nais-team", environments: ["dev"] },
	{ appId: "app-2", appName: "app-to", naisTeamSlug: "nais-team", environments: ["dev", "prod"] },
]

// --- Tests -----------------------------------------------------------

describe("seksjoner.$seksjon.applikasjoner-uten-team action", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("authorization", () => {
		it("rejects unauthenticated users", async () => {
			mockGetAuthenticatedUser.mockResolvedValue(null)
			mockRequireUser.mockImplementation(() => {
				throw new Response("Ikke autentisert", { status: 401 })
			})

			const formData = new FormData()
			formData.set("intent", "bulk-assign-team")

			try {
				await callAction(formData)
				expect.unreachable("Should have thrown 401")
			} catch (thrown) {
				expect(thrown).toBeInstanceOf(Response)
				expect((thrown as Response).status).toBe(401)
			}
		})

		it("returns 403 when user cannot manage target team", async () => {
			mockGetAuthenticatedUser.mockResolvedValue(regularUser)
			mockRequireUser.mockReturnValue(regularUser)
			mockGetSectionDetail.mockResolvedValue(mockSection)
			mockCanManageTeam.mockReturnValue(false)

			const formData = new FormData()
			formData.set("intent", "bulk-assign-team")
			formData.set("teamId", "team-1")
			formData.append("appId", "app-1")

			try {
				await callAction(formData)
				expect.unreachable("Should have thrown 403")
			} catch (thrown) {
				expect(thrown).toBeInstanceOf(Response)
				expect((thrown as Response).status).toBe(403)
			}

			expect(mockLinkAppToTeam).not.toHaveBeenCalled()
		})

		it("returns 403 when team does not belong to section", async () => {
			mockGetAuthenticatedUser.mockResolvedValue(teamLeadUser)
			mockRequireUser.mockReturnValue(teamLeadUser)
			mockGetSectionDetail.mockResolvedValue(mockSection)
			mockCanManageTeam.mockReturnValue(true)
			mockGetTeamsForSection.mockResolvedValue([]) // no teams in this section

			const formData = new FormData()
			formData.set("intent", "bulk-assign-team")
			formData.set("teamId", "team-from-other-section")
			formData.append("appId", "app-1")

			try {
				await callAction(formData)
				expect.unreachable("Should have thrown 403")
			} catch (thrown) {
				expect(thrown).toBeInstanceOf(Response)
				expect((thrown as Response).status).toBe(403)
			}

			expect(mockLinkAppToTeam).not.toHaveBeenCalled()
		})
	})

	describe("validation", () => {
		beforeEach(() => {
			mockGetAuthenticatedUser.mockResolvedValue(teamLeadUser)
			mockRequireUser.mockReturnValue(teamLeadUser)
			mockGetSectionDetail.mockResolvedValue(mockSection)
			mockCanManageTeam.mockReturnValue(true)
			mockGetTeamsForSection.mockResolvedValue(mockTeams)
		})

		it("returns 400 when teamId is missing", async () => {
			const formData = new FormData()
			formData.set("intent", "bulk-assign-team")
			formData.append("appId", "app-1")

			try {
				await callAction(formData)
				expect.unreachable("Should have thrown 400")
			} catch (thrown) {
				expect(thrown).toBeInstanceOf(Response)
				expect((thrown as Response).status).toBe(400)
			}
		})

		it("returns 400 when no appIds are provided", async () => {
			const formData = new FormData()
			formData.set("intent", "bulk-assign-team")
			formData.set("teamId", "team-1")

			try {
				await callAction(formData)
				expect.unreachable("Should have thrown 400")
			} catch (thrown) {
				expect(thrown).toBeInstanceOf(Response)
				expect((thrown as Response).status).toBe(400)
			}
		})

		it("returns 400 when app is not unassigned in section", async () => {
			mockGetUnassignedAppsForSection.mockResolvedValue(mockUnassignedApps)

			const formData = new FormData()
			formData.set("intent", "bulk-assign-team")
			formData.set("teamId", "team-1")
			formData.append("appId", "app-not-in-section")

			try {
				await callAction(formData)
				expect.unreachable("Should have thrown 400")
			} catch (thrown) {
				expect(thrown).toBeInstanceOf(Response)
				expect((thrown as Response).status).toBe(400)
			}

			expect(mockLinkAppToTeam).not.toHaveBeenCalled()
		})

		it("deduplicates appIds", async () => {
			mockGetUnassignedAppsForSection.mockResolvedValue(mockUnassignedApps)
			mockLinkAppToTeam.mockResolvedValue({ id: "mapping-1" })

			const formData = new FormData()
			formData.set("intent", "bulk-assign-team")
			formData.set("teamId", "team-1")
			formData.append("appId", "app-1")
			formData.append("appId", "app-1")
			formData.append("appId", "app-1")

			const response = await callAction(formData)
			expect((response as Response).status).toBe(302)
			expect(mockLinkAppToTeam).toHaveBeenCalledTimes(1)
		})
	})

	describe("success", () => {
		beforeEach(() => {
			mockGetAuthenticatedUser.mockResolvedValue(teamLeadUser)
			mockRequireUser.mockReturnValue(teamLeadUser)
			mockGetSectionDetail.mockResolvedValue(mockSection)
			mockCanManageTeam.mockReturnValue(true)
			mockGetTeamsForSection.mockResolvedValue(mockTeams)
			mockGetUnassignedAppsForSection.mockResolvedValue(mockUnassignedApps)
			mockLinkAppToTeam.mockResolvedValue({ id: "mapping-1" })
		})

		it("links apps and redirects on success", async () => {
			const formData = new FormData()
			formData.set("intent", "bulk-assign-team")
			formData.set("teamId", "team-1")
			formData.append("appId", "app-1")
			formData.append("appId", "app-2")

			const response = await callAction(formData)
			expect(response).toBeInstanceOf(Response)
			expect((response as Response).status).toBe(302)
			expect((response as Response).headers.get("Location")).toBe("/seksjoner/test-seksjon/applikasjoner-uten-team")

			expect(mockLinkAppToTeam).toHaveBeenCalledTimes(2)
			expect(mockLinkAppToTeam).toHaveBeenCalledWith("app-1", "team-1", "Z999999")
			expect(mockLinkAppToTeam).toHaveBeenCalledWith("app-2", "team-1", "Z999999")
		})
	})

	describe("unknown intent", () => {
		it("returns 400 for unknown intent", async () => {
			mockGetAuthenticatedUser.mockResolvedValue(teamLeadUser)
			mockRequireUser.mockReturnValue(teamLeadUser)
			mockGetSectionDetail.mockResolvedValue(mockSection)

			const formData = new FormData()
			formData.set("intent", "unknown-action")

			try {
				await callAction(formData)
				expect.unreachable("Should have thrown 400")
			} catch (thrown) {
				expect(thrown).toBeInstanceOf(Response)
				expect((thrown as Response).status).toBe(400)
			}
		})
	})
})
