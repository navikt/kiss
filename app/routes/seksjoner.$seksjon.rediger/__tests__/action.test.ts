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
vi.mock("~/db/queries/sections.server", () => ({
	getSectionDetail: mockGetSectionDetail,
	updateSection: mockUpdateSection,
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

	describe("admin users", () => {
		beforeEach(() => {
			mockGetAuthenticatedUser.mockResolvedValue(adminUser)
			mockRequireUser.mockReturnValue(adminUser)
			mockRequireAdmin.mockImplementation(() => {})
			mockGetSectionDetail.mockResolvedValue(mockSection)
		})

		it("updates section and redirects", async () => {
			mockUpdateSection.mockResolvedValue({ slug: "nytt-navn" })

			const formData = new FormData()
			formData.set("name", "Nytt navn")
			formData.set("description", "Ny beskrivelse")

			try {
				await callAction(formData)
			} catch (thrown) {
				expect(thrown).toBeInstanceOf(Response)
				expect((thrown as Response).status).toBe(302)
				expect((thrown as Response).headers.get("Location")).toBe("/seksjoner/nytt-navn")
			}

			expect(mockUpdateSection).toHaveBeenCalledWith("sec-1", "Nytt navn", "Ny beskrivelse", "Z999999")
		})

		it("returns 400 when name is missing", async () => {
			const formData = new FormData()
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
})
