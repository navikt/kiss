import { beforeEach, describe, expect, it, vi } from "vitest"

// --- Mocks -----------------------------------------------------------

const mockRequireAuthenticatedUser = vi.fn()
vi.mock("~/lib/auth.server", () => ({
	requireAuthenticatedUser: mockRequireAuthenticatedUser,
}))

const mockRequireAdmin = vi.fn()
vi.mock("~/lib/authorization.server", () => ({
	requireAdmin: mockRequireAdmin,
}))

const mockCreateScreeningQuestion = vi.fn()
const mockUpdateScreeningQuestion = vi.fn()
const mockAddChoiceEffect = vi.fn()
const mockArchiveChoiceEffect = vi.fn()
const mockCreateChoice = vi.fn()
const mockArchiveChoice = vi.fn()
const mockGetChoicesForQuestion = vi.fn()
const mockSetQuestionTechnologyElements = vi.fn()
vi.mock("~/db/queries/screening.server", () => ({
	createScreeningQuestion: mockCreateScreeningQuestion,
	updateScreeningQuestion: mockUpdateScreeningQuestion,
	addChoiceEffect: mockAddChoiceEffect,
	archiveChoiceEffect: mockArchiveChoiceEffect,
	createChoice: mockCreateChoice,
	archiveChoice: mockArchiveChoice,
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
			mockRequireAuthenticatedUser.mockResolvedValue(regularUser)
			mockRequireAdmin.mockImplementation(() => {
				throw new Response("Ikke autorisert", { status: 403 })
			})
		})

		it("rejects create for non-admin", async () => {
			const formData = new FormData()
			formData.set("intent", "updateQuestion")
			formData.set("questionText", "Nytt spørsmål")

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

		it("rejects archive effect for non-admin", async () => {
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

			expect(mockArchiveChoiceEffect).not.toHaveBeenCalled()
		})
	})

	describe("admin users can perform operations", () => {
		beforeEach(() => {
			mockRequireAuthenticatedUser.mockResolvedValue(adminUser)
			mockRequireAdmin.mockImplementation(() => {})
		})

		it("allows create for admin", async () => {
			mockCreateScreeningQuestion.mockResolvedValue({ id: "new-id" })
			mockGetChoicesForQuestion.mockResolvedValue([])

			const formData = new FormData()
			formData.set("intent", "updateQuestion")
			formData.set("questionText", "Nytt spørsmål")
			formData.set("description", "Beskrivelse")

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
				"Z999999",
				null,
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
				presetRoutineId: null,
			})
		})

		it("allows archive effect for admin (passes performedBy)", async () => {
			const formData = new FormData()
			formData.set("intent", "deleteEffect")
			formData.set("effectId", "effect-1")

			await callAction(formData)

			expect(mockArchiveChoiceEffect).toHaveBeenCalledWith("effect-1", "Z999999")
		})

		it("allows archive choice for admin (passes performedBy)", async () => {
			const formData = new FormData()
			formData.set("intent", "deleteChoice")
			formData.set("choiceId", "choice-1")

			await callAction(formData)

			expect(mockArchiveChoice).toHaveBeenCalledWith("choice-1", "Z999999")
		})
	})
})
