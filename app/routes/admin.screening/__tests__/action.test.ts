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

const mockDeleteScreeningQuestion = vi.fn()
const mockReorderScreeningQuestions = vi.fn()
vi.mock("~/db/queries/screening.server", () => ({
	deleteScreeningQuestion: mockDeleteScreeningQuestion,
	reorderScreeningQuestions: mockReorderScreeningQuestions,
	getScreeningQuestions: vi.fn(),
	getEffectsForQuestion: vi.fn(),
}))

vi.mock("~/lib/markdown.server", () => ({
	renderMarkdown: vi.fn(() => ""),
}))

const { action } = await import("../index")

// --- Helpers ---------------------------------------------------------

function makeRequest(formData: FormData): Request {
	return new Request("http://localhost/admin/screening", {
		method: "POST",
		body: formData,
	})
}

function callAction(formData: FormData) {
	return action({
		request: makeRequest(formData),
		params: {},
		context: {},
	} as Parameters<typeof action>[0])
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

// --- Tests -----------------------------------------------------------

describe("admin.screening action – authorization", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("non-admin users receive 403", () => {
		beforeEach(() => {
			mockGetAuthenticatedUser.mockResolvedValue(regularUser)
			mockRequireUser.mockReturnValue(regularUser)
			mockRequireAdmin.mockImplementation(() => {
				throw new Response("Ikke autorisert", { status: 403 })
			})
		})

		it("rejects delete for non-admin", async () => {
			const formData = new FormData()
			formData.set("intent", "deleteQuestion")
			formData.set("questionId", "some-id")

			try {
				await callAction(formData)
				expect.unreachable("Should have thrown 403")
			} catch (thrown) {
				expect(thrown).toBeInstanceOf(Response)
				expect((thrown as Response).status).toBe(403)
			}

			expect(mockDeleteScreeningQuestion).not.toHaveBeenCalled()
		})

		it("rejects reorder for non-admin", async () => {
			const formData = new FormData()
			formData.set("intent", "reorder")
			formData.set("orderedIds", JSON.stringify(["id1", "id2"]))

			try {
				await callAction(formData)
				expect.unreachable("Should have thrown 403")
			} catch (thrown) {
				expect(thrown).toBeInstanceOf(Response)
				expect((thrown as Response).status).toBe(403)
			}

			expect(mockReorderScreeningQuestions).not.toHaveBeenCalled()
		})
	})

	describe("admin users can perform operations", () => {
		beforeEach(() => {
			mockGetAuthenticatedUser.mockResolvedValue(adminUser)
			mockRequireUser.mockReturnValue(adminUser)
			mockRequireAdmin.mockImplementation(() => {})
		})

		it("allows delete for admin", async () => {
			const formData = new FormData()
			formData.set("intent", "deleteQuestion")
			formData.set("questionId", "some-id")

			await callAction(formData)

			expect(mockDeleteScreeningQuestion).toHaveBeenCalledWith("some-id", "Z999999")
		})

		it("allows reorder for admin", async () => {
			const formData = new FormData()
			formData.set("intent", "reorder")
			formData.set("orderedIds", JSON.stringify(["id1", "id2"]))

			await callAction(formData)

			expect(mockReorderScreeningQuestions).toHaveBeenCalledWith(["id1", "id2"], "Z999999")
		})
	})
})
