import { beforeEach, describe, expect, it, vi } from "vitest"

// --- Mocks -----------------------------------------------------------

const mockGetAuthenticatedUser = vi.fn()
const mockRequireUser = vi.fn()
vi.mock("~/lib/auth.server", () => ({
	getAuthenticatedUser: mockGetAuthenticatedUser,
	requireUser: mockRequireUser,
}))

const mockCanApproveRoutine = vi.fn()
const mockIsAdmin = vi.fn()
vi.mock("~/lib/authorization.server", () => ({
	canApproveRoutine: mockCanApproveRoutine,
	isAdmin: mockIsAdmin,
}))

const mockGetRoutine = vi.fn()
const mockApproveRoutine = vi.fn()
const mockCopyRoutine = vi.fn()
vi.mock("~/db/queries/routines.server", () => ({
	getRoutine: mockGetRoutine,
	approveRoutine: mockApproveRoutine,
	copyRoutine: mockCopyRoutine,
	calculateDeadline: vi.fn(),
	getAppsRequiringRoutine: vi.fn().mockResolvedValue([]),
	getLatestReviewForApp: vi.fn(),
	getReviewsForRoutine: vi.fn().mockResolvedValue([]),
	isOverdue: vi.fn(),
}))

vi.mock("~/db/queries/screening.server", () => ({
	getScreeningQuestion: vi.fn().mockResolvedValue(null),
}))

const mockGetSectionBySlug = vi.fn()
vi.mock("~/db/queries/sections.server", () => ({
	getSectionBySlug: mockGetSectionBySlug,
}))

vi.mock("~/lib/markdown.server", () => ({
	renderMarkdown: vi.fn().mockReturnValue(""),
}))

const { action } = await import("../index")

// --- Helpers ---------------------------------------------------------

const fakeUser = {
	navIdent: "T123456",
	name: "Test",
	groups: [],
	token: "t",
	dbRoles: [],
}

const fakeSection = { id: "section-1", name: "Test", slug: "test-seksjon" }

const fakeRoutine = {
	id: "routine-1",
	name: "Test rutine",
	status: "ready",
	responsibleRole: "Teknologileder",
	controls: [],
	technologyElements: [],
	persistenceLinks: [],
	screeningQuestions: [],
	screeningQuestionId: null,
	screeningChoiceValue: null,
	sourceRoutineId: null,
	replacedByRoutineId: null,
	approvedBy: null,
	approvedAt: null,
}

function makeRequest(formData: FormData): Request {
	return new Request("http://localhost/seksjoner/test-seksjon/rutiner/routine-1", {
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
	mockGetSectionBySlug.mockResolvedValue(fakeSection)
	mockGetRoutine.mockResolvedValue(fakeRoutine)
})

describe("approve intent", () => {
	it("approves routine when user has correct role", async () => {
		mockCanApproveRoutine.mockReturnValue(true)
		mockApproveRoutine.mockResolvedValue(undefined)

		const fd = new FormData()
		fd.set("intent", "approve")

		const response = await callAction(fd)
		expect(response.status).toBe(302)
		expect(mockApproveRoutine).toHaveBeenCalledWith("routine-1", "T123456")
	})

	it("rejects approval when user lacks correct role", async () => {
		mockCanApproveRoutine.mockReturnValue(false)

		const fd = new FormData()
		fd.set("intent", "approve")

		await expect(callAction(fd)).rejects.toMatchObject({ init: { status: 403 } })
		expect(mockApproveRoutine).not.toHaveBeenCalled()
	})
})

describe("copy intent", () => {
	it("copies routine when user is admin", async () => {
		mockIsAdmin.mockReturnValue(true)
		mockCopyRoutine.mockResolvedValue({ id: "routine-copy-1" })

		const fd = new FormData()
		fd.set("intent", "copy")

		const response = await callAction(fd)
		expect(response.status).toBe(302)
		expect(response.headers.get("location")).toContain("routine-copy-1")
		expect(mockCopyRoutine).toHaveBeenCalledWith("routine-1", "T123456")
	})

	it("rejects copy when user is not admin", async () => {
		mockIsAdmin.mockReturnValue(false)

		const fd = new FormData()
		fd.set("intent", "copy")

		await expect(callAction(fd)).rejects.toMatchObject({ init: { status: 403 } })
		expect(mockCopyRoutine).not.toHaveBeenCalled()
	})
})

describe("unknown intent", () => {
	it("rejects unknown intent with 400", async () => {
		const fd = new FormData()
		fd.set("intent", "bogus")

		await expect(callAction(fd)).rejects.toMatchObject({ init: { status: 400 } })
	})
})
