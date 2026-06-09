import { beforeEach, describe, expect, it, vi } from "vitest"

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockGetAuthenticatedUser = vi.fn()
vi.mock("~/lib/auth.server", () => ({
	getAuthenticatedUser: (...args: unknown[]) => mockGetAuthenticatedUser(...args),
}))

const mockHasAnySectionRole = vi.fn()
vi.mock("~/lib/authorization.server", () => ({
	hasAnySectionRole: (...args: unknown[]) => mockHasAnySectionRole(...args),
}))

const mockGetSectionBySlug = vi.fn()
vi.mock("~/db/queries/sections.server", () => ({
	getSectionBySlug: (...args: unknown[]) => mockGetSectionBySlug(...args),
}))

const mockGetScreeningQuestion = vi.fn()
const mockGetChoicesForQuestion = vi.fn()
const mockGetChoiceEffects = vi.fn()
vi.mock("~/db/queries/screening.server", () => ({
	getScreeningQuestion: (...args: unknown[]) => mockGetScreeningQuestion(...args),
	getChoicesForQuestion: (...args: unknown[]) => mockGetChoicesForQuestion(...args),
	getChoiceEffects: (...args: unknown[]) => mockGetChoiceEffects(...args),
}))

vi.mock("~/lib/markdown.server", () => ({
	renderMarkdown: vi.fn((text: string | null) => (text ? `<p>${text}</p>` : "")),
}))

const { loader } = await import("../index")

// ─── Fixtures ────────────────────────────────────────────────────────────────

const VALID_UUID = "00000000-0000-0000-0000-000000000001"
const SECTION_ID = "00000000-0000-0000-0000-000000000002"
const SECTION_ID_OTHER = "00000000-0000-0000-0000-000000000099"

const fakeUser = { navIdent: "Z990001", name: "Glad Fjord", email: "glad@nav.no", groups: [], token: "" }

const fakeSection = {
	id: SECTION_ID,
	name: "Test Seksjon",
	slug: "test-seksjon",
}

const fakeQuestion = {
	id: VALID_UUID,
	sectionId: SECTION_ID,
	questionText: "Er systemet kritisk?",
	answerType: "boolean" as const,
	description: "En god beskrivelse",
	status: "approved" as const,
	archivedAt: null,
	displayOrder: 1,
}

function makeRequest(url = `http://localhost/seksjoner/test-seksjon/screening/${VALID_UUID}`) {
	return new Request(url, { method: "GET" })
}

function callLoader(params: Record<string, string | undefined> = {}) {
	return loader({
		request: makeRequest(),
		params: { seksjon: "test-seksjon", questionId: VALID_UUID, ...params },
		context: {},
	} as unknown as Parameters<typeof loader>[0])
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("seksjoner.$seksjon.screening.$questionId loader", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockGetAuthenticatedUser.mockResolvedValue(fakeUser)
		mockHasAnySectionRole.mockReturnValue(false)
		mockGetSectionBySlug.mockResolvedValue(fakeSection)
		mockGetScreeningQuestion.mockResolvedValue(fakeQuestion)
		mockGetChoicesForQuestion.mockResolvedValue([])
		mockGetChoiceEffects.mockResolvedValue([])
	})

	// ── Parameter validation ─────────────────────────────────────────────────

	describe("parameter validation", () => {
		it("throws 400 when seksjon param is missing", async () => {
			await expect(callLoader({ seksjon: undefined })).rejects.toSatisfy(
				(e: unknown) => e instanceof Response && e.status === 400,
			)
		})

		it("throws 400 when questionId is not a valid UUID", async () => {
			await expect(callLoader({ questionId: "not-a-uuid" })).rejects.toSatisfy(
				(e: unknown) => e instanceof Response && e.status === 400,
			)
		})

		it("throws 400 when questionId is an empty string", async () => {
			await expect(callLoader({ questionId: "" })).rejects.toSatisfy(
				(e: unknown) => e instanceof Response && e.status === 400,
			)
		})
	})

	// ── Section lookup ───────────────────────────────────────────────────────

	describe("section lookup", () => {
		it("throws 404 when section is not found", async () => {
			mockGetSectionBySlug.mockResolvedValue(null)

			await expect(callLoader()).rejects.toSatisfy((e: unknown) => e instanceof Response && e.status === 404)
		})

		it("calls getSectionBySlug with the seksjon param", async () => {
			mockGetChoicesForQuestion.mockResolvedValue([])
			await callLoader({ seksjon: "min-seksjon" })
			expect(mockGetSectionBySlug).toHaveBeenCalledWith("min-seksjon")
		})
	})

	// ── Question lookup ──────────────────────────────────────────────────────

	describe("question lookup", () => {
		it("throws 404 when question is not found", async () => {
			mockGetScreeningQuestion.mockResolvedValue(null)

			await expect(callLoader()).rejects.toSatisfy((e: unknown) => e instanceof Response && e.status === 404)
		})

		it("throws 403 when question belongs to a different section", async () => {
			mockGetScreeningQuestion.mockResolvedValue({
				...fakeQuestion,
				sectionId: SECTION_ID_OTHER,
			})

			await expect(callLoader()).rejects.toSatisfy((e: unknown) => e instanceof Response && e.status === 403)
		})
	})

	// ── Archived question visibility ─────────────────────────────────────────

	describe("archived question visibility", () => {
		it("throws 404 for archived question when user has no edit access", async () => {
			mockGetScreeningQuestion.mockResolvedValue({
				...fakeQuestion,
				archivedAt: new Date("2025-01-01"),
			})
			mockHasAnySectionRole.mockReturnValue(false)

			await expect(callLoader()).rejects.toSatisfy((e: unknown) => e instanceof Response && e.status === 404)
		})

		it("returns data for archived question when user has edit access", async () => {
			mockGetScreeningQuestion.mockResolvedValue({
				...fakeQuestion,
				archivedAt: new Date("2025-01-01"),
			})
			mockHasAnySectionRole.mockReturnValue(true)

			const result = await callLoader()
			const payload = "data" in result ? (result as { data: Record<string, unknown> }).data : result
			expect(payload).toHaveProperty("question")
			expect(payload).toHaveProperty("canEdit", true)
		})

		it("throws 404 for archived question when user is unauthenticated (null user)", async () => {
			mockGetAuthenticatedUser.mockResolvedValue(null)
			mockGetScreeningQuestion.mockResolvedValue({
				...fakeQuestion,
				archivedAt: new Date("2025-01-01"),
			})

			await expect(callLoader()).rejects.toSatisfy((e: unknown) => e instanceof Response && e.status === 404)
		})
	})

	// ── canEdit flag ─────────────────────────────────────────────────────────

	describe("canEdit flag", () => {
		it("is true when user has a section role", async () => {
			mockHasAnySectionRole.mockReturnValue(true)

			const result = await callLoader()
			const payload = "data" in result ? (result as { data: Record<string, unknown> }).data : result
			expect(payload).toHaveProperty("canEdit", true)
		})

		it("is false when user has no section role", async () => {
			mockHasAnySectionRole.mockReturnValue(false)

			const result = await callLoader()
			const payload = "data" in result ? (result as { data: Record<string, unknown> }).data : result
			expect(payload).toHaveProperty("canEdit", false)
		})

		it("is false when user is unauthenticated (null)", async () => {
			mockGetAuthenticatedUser.mockResolvedValue(null)

			const result = await callLoader()
			const payload = "data" in result ? (result as { data: Record<string, unknown> }).data : result
			expect(payload).toHaveProperty("canEdit", false)
		})
	})

	// ── Successful load ──────────────────────────────────────────────────────

	describe("successful load", () => {
		it("returns seksjon slug and section name", async () => {
			const result = await callLoader({ seksjon: "test-seksjon" })
			const payload = "data" in result ? (result as { data: Record<string, unknown> }).data : result
			expect(payload).toHaveProperty("seksjon", "test-seksjon")
			expect(payload).toHaveProperty("sectionName", "Test Seksjon")
		})

		it("renders description as HTML via renderMarkdown", async () => {
			const result = await callLoader()
			const payload = "data" in result ? (result as { data: Record<string, unknown> }).data : result
			const question = payload.question as { descriptionHtml: string }
			expect(question.descriptionHtml).toBe("<p>En god beskrivelse</p>")
		})

		it("calls getChoicesForQuestion with the question UUID", async () => {
			await callLoader()
			expect(mockGetChoicesForQuestion).toHaveBeenCalledWith(VALID_UUID)
		})

		it("fetches effects for each choice and attaches them", async () => {
			const fakeChoice = { id: "choice-1", label: "Ja", requiresComment: false, requiresLink: false }
			const fakeEffect = {
				id: "effect-1",
				controlTextId: "K-ST.01",
				controlName: "Sikkerhetstesting",
				effect: "select_routine",
				comment: null,
			}
			mockGetChoicesForQuestion.mockResolvedValue([fakeChoice])
			mockGetChoiceEffects.mockResolvedValue([fakeEffect])

			const result = await callLoader()
			const payload = "data" in result ? (result as { data: Record<string, unknown> }).data : result
			const choices = payload.choices as Array<{ id: string; effects: unknown[] }>

			expect(choices).toHaveLength(1)
			expect(choices[0].id).toBe("choice-1")
			expect(choices[0].effects).toHaveLength(1)
			expect(mockGetChoiceEffects).toHaveBeenCalledWith("choice-1")
		})

		it("calls getChoiceEffects once per choice", async () => {
			mockGetChoicesForQuestion.mockResolvedValue([
				{ id: "choice-a", label: "Ja", requiresComment: false, requiresLink: false },
				{ id: "choice-b", label: "Nei", requiresComment: false, requiresLink: false },
			])
			mockGetChoiceEffects.mockResolvedValue([])

			await callLoader()
			expect(mockGetChoiceEffects).toHaveBeenCalledTimes(2)
			expect(mockGetChoiceEffects).toHaveBeenCalledWith("choice-a")
			expect(mockGetChoiceEffects).toHaveBeenCalledWith("choice-b")
		})

		it("returns choices as empty array when question has no choices", async () => {
			mockGetChoicesForQuestion.mockResolvedValue([])

			const result = await callLoader()
			const payload = "data" in result ? (result as { data: Record<string, unknown> }).data : result
			expect(payload).toHaveProperty("choices")
			expect((payload.choices as unknown[]).length).toBe(0)
		})

		it("includes question id, text, answerType, and status in response", async () => {
			const result = await callLoader()
			const payload = "data" in result ? (result as { data: Record<string, unknown> }).data : result
			const question = payload.question as Record<string, unknown>
			expect(question.id).toBe(VALID_UUID)
			expect(question.questionText).toBe("Er systemet kritisk?")
			expect(question.answerType).toBe("boolean")
			expect(question.status).toBe("approved")
		})
	})
})
