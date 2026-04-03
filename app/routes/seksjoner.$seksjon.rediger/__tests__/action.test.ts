import { beforeEach, describe, expect, it, vi } from "vitest"

// --- Mocks -----------------------------------------------------------

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

const mockGetSectionDetail = vi.fn()
const mockUpdateSection = vi.fn()
const mockGetTeamsForSection = vi.fn()
const mockCreateTeam = vi.fn()
vi.mock("~/db/queries/sections.server", () => ({
	getSectionDetail: mockGetSectionDetail,
	updateSection: mockUpdateSection,
	getTeamsForSection: mockGetTeamsForSection,
	createTeam: mockCreateTeam,
}))

const mockLinkNaisTeamToSection = vi.fn()
const mockUnlinkNaisTeamFromSection = vi.fn()
const mockIgnoreAppForSection = vi.fn()
const mockUnignoreAppForSection = vi.fn()
const mockGetNaisTeamsForSection = vi.fn()
const mockGetUnlinkedNaisTeams = vi.fn()
const mockGetUnassignedAppsForSection = vi.fn()
const mockGetIgnoredAppsForSection = vi.fn()
vi.mock("~/db/queries/nais.server", () => ({
	linkNaisTeamToSection: mockLinkNaisTeamToSection,
	unlinkNaisTeamFromSection: mockUnlinkNaisTeamFromSection,
	ignoreAppForSection: mockIgnoreAppForSection,
	unignoreAppForSection: mockUnignoreAppForSection,
	getNaisTeamsForSection: mockGetNaisTeamsForSection,
	getUnlinkedNaisTeams: mockGetUnlinkedNaisTeams,
	getUnassignedAppsForSection: mockGetUnassignedAppsForSection,
	getIgnoredAppsForSection: mockGetIgnoredAppsForSection,
}))

const { action } = await import("../index")

// --- Helpers ---------------------------------------------------------

function makeRequest(formData: FormData): Request {
	return new Request("http://localhost/seksjoner/test-seksjon/rediger", {
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

const adminUser = {
	navIdent: "Z999999",
	name: "Admin Bruker",
	groups: ["admin-group"],
	token: "test-token",
}

const regularUser = {
	navIdent: "Z888888",
	name: "Vanlig Bruker",
	groups: [],
	token: "test-token",
}

const mockSection = {
	section: { id: "sec-1", name: "Test Seksjon", slug: "test-seksjon", description: "Beskrivelse" },
	teams: [],
}

// --- Tests -----------------------------------------------------------

describe("seksjoner.$seksjon.rediger action", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("authorization", () => {
		it("rejects non-admin users with 403", async () => {
			mockGetAuthenticatedUser.mockResolvedValue(regularUser)
			mockRequireUser.mockReturnValue(regularUser)
			mockRequireAdmin.mockImplementation(() => {
				throw new Response("Ikke autorisert", { status: 403 })
			})

			const formData = new FormData()
			formData.set("intent", "update-section")
			formData.set("name", "Nytt navn")

			try {
				await callAction(formData)
				expect.unreachable("Should have thrown 403")
			} catch (thrown) {
				expect(thrown).toBeInstanceOf(Response)
				expect((thrown as Response).status).toBe(403)
			}

			expect(mockUpdateSection).not.toHaveBeenCalled()
		})
	})

	describe("update-section", () => {
		beforeEach(() => {
			mockGetAuthenticatedUser.mockResolvedValue(adminUser)
			mockRequireUser.mockReturnValue(adminUser)
			mockRequireAdmin.mockImplementation(() => {})
			mockGetSectionDetail.mockResolvedValue(mockSection)
		})

		it("updates section and redirects to edit page", async () => {
			mockUpdateSection.mockResolvedValue({ slug: "nytt-navn" })

			const formData = new FormData()
			formData.set("intent", "update-section")
			formData.set("name", "Nytt navn")
			formData.set("description", "Ny beskrivelse")

			try {
				await callAction(formData)
			} catch (thrown) {
				expect(thrown).toBeInstanceOf(Response)
				expect((thrown as Response).status).toBe(302)
				expect((thrown as Response).headers.get("Location")).toBe("/seksjoner/nytt-navn/rediger?fane=seksjon")
			}

			expect(mockUpdateSection).toHaveBeenCalledWith("sec-1", "Nytt navn", "Ny beskrivelse", "Z999999")
		})

		it("returns 400 when name is missing", async () => {
			const formData = new FormData()
			formData.set("intent", "update-section")
			formData.set("name", "   ")

			try {
				await callAction(formData)
				expect.unreachable("Should have thrown 400")
			} catch (thrown) {
				expect(thrown).toBeInstanceOf(Response)
				expect((thrown as Response).status).toBe(400)
			}

			expect(mockUpdateSection).not.toHaveBeenCalled()
		})

		it("returns 404 when section not found", async () => {
			mockGetSectionDetail.mockResolvedValue(null)

			const formData = new FormData()
			formData.set("intent", "update-section")
			formData.set("name", "Test")

			try {
				await callAction(formData)
				expect.unreachable("Should have thrown 404")
			} catch (thrown) {
				expect(thrown).toBeInstanceOf(Response)
				expect((thrown as Response).status).toBe(404)
			}
		})
	})

	describe("create-team", () => {
		beforeEach(() => {
			mockGetAuthenticatedUser.mockResolvedValue(adminUser)
			mockRequireUser.mockReturnValue(adminUser)
			mockRequireAdmin.mockImplementation(() => {})
			mockGetSectionDetail.mockResolvedValue(mockSection)
		})

		it("creates team and redirects", async () => {
			mockCreateTeam.mockResolvedValue({ id: "team-1", slug: "nytt-team" })

			const formData = new FormData()
			formData.set("intent", "create-team")
			formData.set("name", "Nytt team")
			formData.set("description", "Team-beskrivelse")

			try {
				await callAction(formData)
			} catch (thrown) {
				expect(thrown).toBeInstanceOf(Response)
				expect((thrown as Response).status).toBe(302)
				expect((thrown as Response).headers.get("Location")).toBe("/seksjoner/test-seksjon/rediger?fane=team")
			}

			expect(mockCreateTeam).toHaveBeenCalledWith("sec-1", "Nytt team", "Team-beskrivelse", "Z999999")
		})

		it("returns 400 when team name is missing", async () => {
			const formData = new FormData()
			formData.set("intent", "create-team")
			formData.set("name", "   ")

			try {
				await callAction(formData)
				expect.unreachable("Should have thrown 400")
			} catch (thrown) {
				expect(thrown).toBeInstanceOf(Response)
				expect((thrown as Response).status).toBe(400)
			}

			expect(mockCreateTeam).not.toHaveBeenCalled()
		})
	})

	describe("link-nais-team", () => {
		beforeEach(() => {
			mockGetAuthenticatedUser.mockResolvedValue(adminUser)
			mockRequireUser.mockReturnValue(adminUser)
			mockRequireAdmin.mockImplementation(() => {})
			mockGetSectionDetail.mockResolvedValue(mockSection)
		})

		it("links Nais-team and redirects", async () => {
			mockLinkNaisTeamToSection.mockResolvedValue({})

			const formData = new FormData()
			formData.set("intent", "link-nais-team")
			formData.set("naisTeamSlug", "pensjon-person")

			try {
				await callAction(formData)
			} catch (thrown) {
				expect(thrown).toBeInstanceOf(Response)
				expect((thrown as Response).status).toBe(302)
				expect((thrown as Response).headers.get("Location")).toBe("/seksjoner/test-seksjon/rediger?fane=nais")
			}

			expect(mockLinkNaisTeamToSection).toHaveBeenCalledWith("pensjon-person", "sec-1", "Z999999")
		})

		it("returns 400 when naisTeamSlug is missing", async () => {
			const formData = new FormData()
			formData.set("intent", "link-nais-team")

			try {
				await callAction(formData)
				expect.unreachable("Should have thrown 400")
			} catch (thrown) {
				expect(thrown).toBeInstanceOf(Response)
				expect((thrown as Response).status).toBe(400)
			}

			expect(mockLinkNaisTeamToSection).not.toHaveBeenCalled()
		})
	})

	describe("unlink-nais-team", () => {
		beforeEach(() => {
			mockGetAuthenticatedUser.mockResolvedValue(adminUser)
			mockRequireUser.mockReturnValue(adminUser)
			mockRequireAdmin.mockImplementation(() => {})
			mockGetSectionDetail.mockResolvedValue(mockSection)
		})

		it("unlinks Nais-team and redirects", async () => {
			mockUnlinkNaisTeamFromSection.mockResolvedValue({})

			const formData = new FormData()
			formData.set("intent", "unlink-nais-team")
			formData.set("naisTeamSlug", "pensjon-person")

			try {
				await callAction(formData)
			} catch (thrown) {
				expect(thrown).toBeInstanceOf(Response)
				expect((thrown as Response).status).toBe(302)
				expect((thrown as Response).headers.get("Location")).toBe("/seksjoner/test-seksjon/rediger?fane=nais")
			}

			expect(mockUnlinkNaisTeamFromSection).toHaveBeenCalledWith("pensjon-person", "Z999999")
		})

		it("returns 400 when naisTeamSlug is missing", async () => {
			const formData = new FormData()
			formData.set("intent", "unlink-nais-team")

			try {
				await callAction(formData)
				expect.unreachable("Should have thrown 400")
			} catch (thrown) {
				expect(thrown).toBeInstanceOf(Response)
				expect((thrown as Response).status).toBe(400)
			}

			expect(mockUnlinkNaisTeamFromSection).not.toHaveBeenCalled()
		})
	})

	describe("ignore-app", () => {
		beforeEach(() => {
			mockGetAuthenticatedUser.mockResolvedValue(adminUser)
			mockRequireUser.mockReturnValue(adminUser)
			mockRequireAdmin.mockImplementation(() => {})
			mockGetSectionDetail.mockResolvedValue(mockSection)
		})

		it("ignores app and redirects", async () => {
			mockIgnoreAppForSection.mockResolvedValue({})

			const formData = new FormData()
			formData.set("intent", "ignore-app")
			formData.set("applicationId", "app-1")
			formData.set("reason", "Ikke relevant")

			try {
				await callAction(formData)
			} catch (thrown) {
				expect(thrown).toBeInstanceOf(Response)
				expect((thrown as Response).status).toBe(302)
				expect((thrown as Response).headers.get("Location")).toBe("/seksjoner/test-seksjon/rediger?fane=applikasjoner")
			}

			expect(mockIgnoreAppForSection).toHaveBeenCalledWith("sec-1", "app-1", "Z999999", "Ikke relevant")
		})

		it("returns 400 when applicationId is missing", async () => {
			const formData = new FormData()
			formData.set("intent", "ignore-app")

			try {
				await callAction(formData)
				expect.unreachable("Should have thrown 400")
			} catch (thrown) {
				expect(thrown).toBeInstanceOf(Response)
				expect((thrown as Response).status).toBe(400)
			}

			expect(mockIgnoreAppForSection).not.toHaveBeenCalled()
		})
	})

	describe("unignore-app", () => {
		beforeEach(() => {
			mockGetAuthenticatedUser.mockResolvedValue(adminUser)
			mockRequireUser.mockReturnValue(adminUser)
			mockRequireAdmin.mockImplementation(() => {})
			mockGetSectionDetail.mockResolvedValue(mockSection)
		})

		it("unignores app and redirects", async () => {
			mockUnignoreAppForSection.mockResolvedValue({})

			const formData = new FormData()
			formData.set("intent", "unignore-app")
			formData.set("applicationId", "app-1")

			try {
				await callAction(formData)
			} catch (thrown) {
				expect(thrown).toBeInstanceOf(Response)
				expect((thrown as Response).status).toBe(302)
				expect((thrown as Response).headers.get("Location")).toBe("/seksjoner/test-seksjon/rediger?fane=applikasjoner")
			}

			expect(mockUnignoreAppForSection).toHaveBeenCalledWith("sec-1", "app-1", "Z999999")
		})

		it("returns 400 when applicationId is missing", async () => {
			const formData = new FormData()
			formData.set("intent", "unignore-app")

			try {
				await callAction(formData)
				expect.unreachable("Should have thrown 400")
			} catch (thrown) {
				expect(thrown).toBeInstanceOf(Response)
				expect((thrown as Response).status).toBe(400)
			}

			expect(mockUnignoreAppForSection).not.toHaveBeenCalled()
		})
	})

	describe("unknown intent", () => {
		beforeEach(() => {
			mockGetAuthenticatedUser.mockResolvedValue(adminUser)
			mockRequireUser.mockReturnValue(adminUser)
			mockRequireAdmin.mockImplementation(() => {})
			mockGetSectionDetail.mockResolvedValue(mockSection)
		})

		it("returns 400 for unknown intent", async () => {
			const formData = new FormData()
			formData.set("intent", "nonsense")

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
