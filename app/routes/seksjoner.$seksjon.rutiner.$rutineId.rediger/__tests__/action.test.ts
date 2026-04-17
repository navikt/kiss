import { beforeEach, describe, expect, it, vi } from "vitest"

// --- Mocks -----------------------------------------------------------

const mockGetAuthenticatedUser = vi.fn()
const mockRequireUser = vi.fn()
vi.mock("~/lib/auth.server", () => ({
	getAuthenticatedUser: mockGetAuthenticatedUser,
	requireUser: mockRequireUser,
}))

const mockRequireAdmin = vi.fn()
const mockCanApproveRoutine = vi.fn()
vi.mock("~/lib/authorization.server", () => ({
	requireAdmin: mockRequireAdmin,
	canApproveRoutine: mockCanApproveRoutine,
}))

const mockGetRoutine = vi.fn()
const mockUpdateRoutine = vi.fn()
const mockDeleteRoutine = vi.fn()
const mockApproveRoutine = vi.fn()
const mockReplaceRoutine = vi.fn()
vi.mock("~/db/queries/routines.server", () => ({
	getRoutine: mockGetRoutine,
	updateRoutine: mockUpdateRoutine,
	deleteRoutine: mockDeleteRoutine,
	approveRoutine: mockApproveRoutine,
	replaceRoutine: mockReplaceRoutine,
}))

vi.mock("~/db/queries/screening.server", () => ({
	getScreeningQuestions: vi.fn().mockResolvedValue([]),
	getSectionScreeningQuestions: vi.fn().mockResolvedValue([]),
	getChoicesForQuestion: vi.fn().mockResolvedValue([]),
}))

const mockGetSectionBySlug = vi.fn()
vi.mock("~/db/queries/sections.server", () => ({
	getSectionBySlug: mockGetSectionBySlug,
}))

vi.mock("~/db/queries/framework.server", () => ({
	getAllControlsForSelection: vi.fn().mockResolvedValue([]),
}))

vi.mock("~/db/queries/technology-elements.server", () => ({
	getAllTechnologyElements: vi.fn().mockResolvedValue([]),
}))

const { action } = await import("../index")

// --- Helpers ---------------------------------------------------------

const fakeUser = {
	navIdent: "T123456",
	name: "Test",
	groups: [],
	token: "t",
	dbRoles: [{ role: "admin" as const, sectionId: null, devTeamId: null }],
}

const fakeSection = { id: "section-1", name: "Test", slug: "test-seksjon" }

function makeRoutine(overrides: Record<string, unknown> = {}) {
	return {
		id: "routine-1",
		name: "Test rutine",
		status: "active",
		responsibleRole: "Teknologileder",
		controls: [{ responsible: "Teknologileder" }],
		technologyElements: [],
		persistenceLinks: [],
		screeningQuestions: [],
		screeningQuestionId: null,
		screeningChoiceValue: null,
		sourceRoutineId: null,
		replacedByRoutineId: null,
		approvedBy: null,
		approvedAt: null,
		...overrides,
	}
}

function makeRequest(formData: FormData): Request {
	return new Request("http://localhost/seksjoner/test-seksjon/rutiner/routine-1/rediger", {
		method: "POST",
		body: formData,
	})
}

function callAction(formData: FormData) {
	return action({
		request: makeRequest(formData),
		params: { seksjon: "test-seksjon", rutineId: "routine-1" },
		context: {},
	} as unknown as Parameters<typeof action>[0])
}

// --- Tests -----------------------------------------------------------

beforeEach(() => {
	vi.clearAllMocks()
	mockGetAuthenticatedUser.mockResolvedValue(fakeUser)
	mockRequireUser.mockReturnValue(fakeUser)
	mockRequireAdmin.mockReturnValue(undefined)
	mockGetSectionBySlug.mockResolvedValue(fakeSection)
})

describe("approved routine edit guard", () => {
	it("rejects editing an approved routine with 403", async () => {
		mockGetRoutine.mockResolvedValue(makeRoutine({ status: "approved" }))

		const fd = new FormData()
		fd.set("intent", "update")
		fd.set("name", "New name")
		fd.set("frequency", "annually")

		await expect(callAction(fd)).rejects.toMatchObject({ status: 403 })
		expect(mockUpdateRoutine).not.toHaveBeenCalled()
	})

	it("allows editing a draft routine", async () => {
		mockGetRoutine.mockResolvedValue(makeRoutine({ status: "draft" }))
		mockUpdateRoutine.mockResolvedValue(undefined)

		const fd = new FormData()
		fd.set("intent", "update")
		fd.set("name", "Updated name")
		fd.set("frequency", "annually")

		const response = await callAction(fd)
		expect(response.status).toBe(302)
		expect(mockUpdateRoutine).toHaveBeenCalled()
	})
})

describe("approve-replace intent", () => {
	it("replaces source routine when user has approval rights", async () => {
		mockGetRoutine
			.mockResolvedValueOnce(makeRoutine({ status: "active" })) // guard check
			.mockResolvedValueOnce(makeRoutine({ status: "active", sourceRoutineId: "original-1" })) // intent check
		mockCanApproveRoutine.mockReturnValue(true)
		mockReplaceRoutine.mockResolvedValue(undefined)

		const fd = new FormData()
		fd.set("intent", "approve-replace")
		fd.set("deadlinePolicy", "continue")

		const response = await callAction(fd)
		expect(response.status).toBe(302)
		expect(mockReplaceRoutine).toHaveBeenCalledWith("routine-1", "original-1", "continue", "T123456")
	})

	it("rejects replacement without approval rights", async () => {
		mockGetRoutine
			.mockResolvedValueOnce(makeRoutine({ status: "active" }))
			.mockResolvedValueOnce(makeRoutine({ status: "active", sourceRoutineId: "original-1" }))
		mockCanApproveRoutine.mockReturnValue(false)

		const fd = new FormData()
		fd.set("intent", "approve-replace")
		fd.set("deadlinePolicy", "continue")

		await expect(callAction(fd)).rejects.toMatchObject({ status: 403 })
		expect(mockReplaceRoutine).not.toHaveBeenCalled()
	})

	it("rejects replacement when routine has no source", async () => {
		mockGetRoutine
			.mockResolvedValueOnce(makeRoutine({ status: "active" }))
			.mockResolvedValueOnce(makeRoutine({ status: "active", sourceRoutineId: null }))
		mockCanApproveRoutine.mockReturnValue(true)

		const fd = new FormData()
		fd.set("intent", "approve-replace")
		fd.set("deadlinePolicy", "reset")

		await expect(callAction(fd)).rejects.toMatchObject({ status: 400 })
	})
})

describe("approve-as-new intent", () => {
	it("approves routine as new without replacing source", async () => {
		mockGetRoutine
			.mockResolvedValueOnce(makeRoutine({ status: "active" }))
			.mockResolvedValueOnce(makeRoutine({ status: "active" }))
		mockCanApproveRoutine.mockReturnValue(true)
		mockApproveRoutine.mockResolvedValue(undefined)

		const fd = new FormData()
		fd.set("intent", "approve-as-new")

		const response = await callAction(fd)
		expect(response.status).toBe(302)
		expect(mockApproveRoutine).toHaveBeenCalledWith("routine-1", "T123456")
	})

	it("rejects approval without correct role", async () => {
		mockGetRoutine
			.mockResolvedValueOnce(makeRoutine({ status: "active" }))
			.mockResolvedValueOnce(makeRoutine({ status: "active" }))
		mockCanApproveRoutine.mockReturnValue(false)

		const fd = new FormData()
		fd.set("intent", "approve-as-new")

		await expect(callAction(fd)).rejects.toMatchObject({ status: 403 })
		expect(mockApproveRoutine).not.toHaveBeenCalled()
	})
})
