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
const mockUpdateTeam = vi.fn()
const mockDeleteTeam = vi.fn()
vi.mock("~/db/queries/sections.server", () => ({
	getSectionDetail: mockGetSectionDetail,
	updateSection: mockUpdateSection,
	getTeamsForSection: mockGetTeamsForSection,
	createTeam: mockCreateTeam,
	updateTeam: mockUpdateTeam,
	deleteTeam: mockDeleteTeam,
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
				expect((thrown as Response).headers.get("Location")).toBe("/seksjoner/nytt-navn/rediger")
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
				expect((thrown as Response).headers.get("Location")).toBe("/seksjoner/test-seksjon/rediger")
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

	describe("update-team", () => {
		beforeEach(() => {
			mockGetAuthenticatedUser.mockResolvedValue(adminUser)
			mockRequireUser.mockReturnValue(adminUser)
			mockRequireAdmin.mockImplementation(() => {})
			mockGetSectionDetail.mockResolvedValue(mockSection)
		})

		it("updates team and redirects", async () => {
			mockUpdateTeam.mockResolvedValue({})

			const formData = new FormData()
			formData.set("intent", "update-team")
			formData.set("teamId", "team-1")
			formData.set("name", "Oppdatert team")
			formData.set("description", "Ny beskrivelse")

			try {
				await callAction(formData)
			} catch (thrown) {
				expect(thrown).toBeInstanceOf(Response)
				expect((thrown as Response).status).toBe(302)
				expect((thrown as Response).headers.get("Location")).toBe("/seksjoner/test-seksjon/rediger")
			}

			expect(mockUpdateTeam).toHaveBeenCalledWith("team-1", "Oppdatert team", "Ny beskrivelse", "Z999999")
		})

		it("returns 400 when teamId or name is missing", async () => {
			const formData = new FormData()
			formData.set("intent", "update-team")
			formData.set("teamId", "team-1")
			formData.set("name", "")

			try {
				await callAction(formData)
				expect.unreachable("Should have thrown 400")
			} catch (thrown) {
				expect(thrown).toBeInstanceOf(Response)
				expect((thrown as Response).status).toBe(400)
			}

			expect(mockUpdateTeam).not.toHaveBeenCalled()
		})
	})

	describe("delete-team", () => {
		beforeEach(() => {
			mockGetAuthenticatedUser.mockResolvedValue(adminUser)
			mockRequireUser.mockReturnValue(adminUser)
			mockRequireAdmin.mockImplementation(() => {})
			mockGetSectionDetail.mockResolvedValue(mockSection)
		})

		it("deletes team and redirects", async () => {
			mockDeleteTeam.mockResolvedValue({})

			const formData = new FormData()
			formData.set("intent", "delete-team")
			formData.set("teamId", "team-1")

			try {
				await callAction(formData)
			} catch (thrown) {
				expect(thrown).toBeInstanceOf(Response)
				expect((thrown as Response).status).toBe(302)
				expect((thrown as Response).headers.get("Location")).toBe("/seksjoner/test-seksjon/rediger")
			}

			expect(mockDeleteTeam).toHaveBeenCalledWith("team-1", "Z999999")
		})

		it("returns 400 when teamId is missing", async () => {
			const formData = new FormData()
			formData.set("intent", "delete-team")

			try {
				await callAction(formData)
				expect.unreachable("Should have thrown 400")
			} catch (thrown) {
				expect(thrown).toBeInstanceOf(Response)
				expect((thrown as Response).status).toBe(400)
			}

			expect(mockDeleteTeam).not.toHaveBeenCalled()
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
