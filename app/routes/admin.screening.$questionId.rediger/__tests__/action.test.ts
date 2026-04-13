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

const mockCreateScreeningQuestion = vi.fn()
const mockUpdateScreeningQuestion = vi.fn()
const mockAddChoiceEffect = vi.fn()
const mockDeleteChoiceEffect = vi.fn()
const mockCreateChoice = vi.fn()
const mockDeleteChoice = vi.fn()
const mockGetChoicesForQuestion = vi.fn()
const mockSetQuestionTechnologyElements = vi.fn()
vi.mock("~/db/queries/screening.server", () => ({
	createScreeningQuestion: mockCreateScreeningQuestion,
	updateScreeningQuestion: mockUpdateScreeningQuestion,
	addChoiceEffect: mockAddChoiceEffect,
	deleteChoiceEffect: mockDeleteChoiceEffect,
	createChoice: mockCreateChoice,
	deleteChoice: mockDeleteChoice,
	getScreeningQuestion: vi.fn(),
	getChoicesForQuestion: mockGetChoicesForQuestion,
	getChoiceEffects: vi.fn().mockResolvedValue([]),
	getQuestionTechnologyElements: vi.fn().mockResolvedValue([]),
	setQuestionTechnologyElements: mockSetQuestionTechnologyElements,
	updateChoice: vi.fn(),
}))

vi.mock("~/db/queries/framework.server", () => ({
	getAllControls: vi.fn(),
}))

vi.mock("~/db/queries/technology-elements.server", () => ({
	getAllTechnologyElements: vi.fn().mockResolvedValue([]),
}))

vi.mock("~/lib/markdown.server", () => ({
	renderMarkdown: vi.fn(() => ""),
}))

const { action } = await import("../index")

// --- Helpers ---------------------------------------------------------

function makeRequest(formData: FormData): Request {
	return new Request("http://localhost/admin/screening/test-id/rediger", {
		method: "POST",
		body: formData,
	})
}

function callAction(formData: FormData, questionId = "test-id") {
	return action({
		request: makeRequest(formData),
		params: { questionId },
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

// --- Tests -----------------------------------------------------------

describe("admin.screening.$questionId.rediger action – authorization", () => {
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

		it("rejects create for non-admin", async () => {
			const formData = new FormData()
			formData.set("intent", "updateQuestion")
			formData.set("questionText", "Nytt spørsmål")
			formData.set("displayOrder", "0")

			try {
				await callAction(formData, "ny")
				expect.unreachable("Should have thrown 403")
			} catch (thrown) {
				expect(thrown).toBeInstanceOf(Response)
				expect((thrown as Response).status).toBe(403)
			}

			expect(mockCreateScreeningQuestion).not.toHaveBeenCalled()
		})

		it("rejects update for non-admin", async () => {
			const formData = new FormData()
			formData.set("intent", "updateQuestion")
			formData.set("questionText", "Oppdatert spørsmål")
			formData.set("displayOrder", "1")

			try {
				await callAction(formData)
				expect.unreachable("Should have thrown 403")
			} catch (thrown) {
				expect(thrown).toBeInstanceOf(Response)
				expect((thrown as Response).status).toBe(403)
			}

			expect(mockUpdateScreeningQuestion).not.toHaveBeenCalled()
		})

		it("rejects add effect for non-admin", async () => {
			const formData = new FormData()
			formData.set("intent", "addEffect")
			formData.set("choiceId", "choice-1")
			formData.set("controlTextId", "ctrl-1")

			try {
				await callAction(formData)
				expect.unreachable("Should have thrown 403")
			} catch (thrown) {
				expect(thrown).toBeInstanceOf(Response)
				expect((thrown as Response).status).toBe(403)
			}

			expect(mockAddChoiceEffect).not.toHaveBeenCalled()
		})

		it("rejects delete effect for non-admin", async () => {
			const formData = new FormData()
			formData.set("intent", "deleteEffect")
			formData.set("effectId", "effect-1")

			try {
				await callAction(formData)
				expect.unreachable("Should have thrown 403")
			} catch (thrown) {
				expect(thrown).toBeInstanceOf(Response)
				expect((thrown as Response).status).toBe(403)
			}

			expect(mockDeleteChoiceEffect).not.toHaveBeenCalled()
		})
	})

	describe("admin users can perform operations", () => {
		beforeEach(() => {
			mockGetAuthenticatedUser.mockResolvedValue(adminUser)
			mockRequireUser.mockReturnValue(adminUser)
			mockRequireAdmin.mockImplementation(() => {})
		})

		it("allows create for admin", async () => {
			mockCreateScreeningQuestion.mockResolvedValue({ id: "new-id" })
			mockGetChoicesForQuestion.mockResolvedValue([])

			const formData = new FormData()
			formData.set("intent", "updateQuestion")
			formData.set("questionText", "Nytt spørsmål")
			formData.set("description", "Beskrivelse")
			formData.set("displayOrder", "0")

			try {
				await callAction(formData, "ny")
			} catch (thrown) {
				// redirect throws a Response
				expect(thrown).toBeInstanceOf(Response)
				expect((thrown as Response).status).toBe(302)
				expect((thrown as Response).headers.get("Location")).toContain("/admin/screening")
			}

			expect(mockCreateScreeningQuestion).toHaveBeenCalledWith(
				"Nytt spørsmål",
				"Beskrivelse",
				0,
				"Z999999",
				null,
				"boolean",
				null,
			)
		})

		it("allows update for admin", async () => {
			const formData = new FormData()
			formData.set("intent", "updateQuestion")
			formData.set("questionText", "Oppdatert spørsmål")
			formData.set("description", "Oppdatert beskrivelse")
			formData.set("displayOrder", "1")

			try {
				await callAction(formData)
			} catch (thrown) {
				// redirect throws a Response
				expect(thrown).toBeInstanceOf(Response)
				expect((thrown as Response).status).toBe(302)
			}

			expect(mockUpdateScreeningQuestion).toHaveBeenCalledWith(
				"test-id",
				"Oppdatert spørsmål",
				"Oppdatert beskrivelse",
				1,
				"Z999999",
				null,
			)
		})

		it("allows add effect for admin", async () => {
			const formData = new FormData()
			formData.set("intent", "addEffect")
			formData.set("choiceId", "choice-1")
			formData.set("controlTextId", "ctrl-1")
			formData.set("effect", "implemented")

			await callAction(formData)

			expect(mockAddChoiceEffect).toHaveBeenCalledWith({
				choiceId: "choice-1",
				controlTextId: "ctrl-1",
				effect: "implemented",
				comment: null,
			})
		})

		it("allows delete effect for admin", async () => {
			const formData = new FormData()
			formData.set("intent", "deleteEffect")
			formData.set("effectId", "effect-1")

			await callAction(formData)

			expect(mockDeleteChoiceEffect).toHaveBeenCalledWith("effect-1")
		})
	})
})
