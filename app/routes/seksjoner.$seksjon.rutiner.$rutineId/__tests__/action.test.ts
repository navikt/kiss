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
const mockHasAnySectionRole = vi.fn()
vi.mock("~/lib/authorization.server", () => ({
	canApproveRoutine: mockCanApproveRoutine,
	isAdmin: mockIsAdmin,
	hasAnySectionRole: mockHasAnySectionRole,
}))

const mockGetRoutine = vi.fn()
const mockApproveRoutine = vi.fn()
const mockCopyRoutine = vi.fn()
const mockArchiveRoutine = vi.fn()
const mockUpdateRoutinePriority = vi.fn()
vi.mock("~/db/queries/routines.server", () => ({
	getRoutine: mockGetRoutine,
	approveRoutine: mockApproveRoutine,
	copyRoutine: mockCopyRoutine,
	archiveRoutine: mockArchiveRoutine,
	updateRoutinePriority: mockUpdateRoutinePriority,
	calculateDeadline: vi.fn(),
	getAppsRequiringRoutine: vi.fn().mockResolvedValue([]),
	getLatestReviewForApp: vi.fn(),
	getLatestSectionReview: vi.fn().mockResolvedValue(null),
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
	sectionId: "section-1",
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

		const response = (await callAction(fd)) as Response
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
	it("copies routine when user has section role", async () => {
		mockHasAnySectionRole.mockReturnValue(true)
		mockGetRoutine.mockResolvedValue({ ...fakeRoutine, status: "approved" })
		mockCopyRoutine.mockResolvedValue({ id: "routine-copy-1" })

		const fd = new FormData()
		fd.set("intent", "copy")

		const response = (await callAction(fd)) as Response
		expect(response.status).toBe(302)
		expect(response.headers.get("location")).toContain("routine-copy-1")
		expect(mockCopyRoutine).toHaveBeenCalledWith("routine-1", "T123456")
		expect(mockHasAnySectionRole).toHaveBeenCalledWith(fakeUser, "section-1")
	})

	it("rejects copy when user lacks section role", async () => {
		mockHasAnySectionRole.mockReturnValue(false)
		mockGetRoutine.mockResolvedValue({ ...fakeRoutine, status: "approved" })

		const fd = new FormData()
		fd.set("intent", "copy")

		await expect(callAction(fd)).rejects.toMatchObject({ init: { status: 403 } })
		expect(mockCopyRoutine).not.toHaveBeenCalled()
	})

	it("rejects copy when routine is not approved", async () => {
		mockHasAnySectionRole.mockReturnValue(true)

		const fd = new FormData()
		fd.set("intent", "copy")

		await expect(callAction(fd)).rejects.toMatchObject({ init: { status: 400 } })
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

describe("archive intent", () => {
	it("archives approved routine when user is admin", async () => {
		mockIsAdmin.mockReturnValue(true)
		mockGetRoutine.mockResolvedValue({ ...fakeRoutine, status: "approved" })
		mockArchiveRoutine.mockResolvedValue(undefined)

		const fd = new FormData()
		fd.set("intent", "archive")

		const response = (await callAction(fd)) as Response
		expect(response.status).toBe(302)
		expect(mockArchiveRoutine).toHaveBeenCalledWith("routine-1", "T123456")
	})

	it("archives approved routine when user has approver role", async () => {
		mockIsAdmin.mockReturnValue(false)
		mockCanApproveRoutine.mockReturnValue(true)
		mockGetRoutine.mockResolvedValue({ ...fakeRoutine, status: "approved" })
		mockArchiveRoutine.mockResolvedValue(undefined)

		const fd = new FormData()
		fd.set("intent", "archive")

		const response = (await callAction(fd)) as Response
		expect(response.status).toBe(302)
		expect(mockArchiveRoutine).toHaveBeenCalledWith("routine-1", "T123456")
	})

	it("rejects archive when user lacks admin and approver role", async () => {
		mockIsAdmin.mockReturnValue(false)
		mockCanApproveRoutine.mockReturnValue(false)
		mockGetRoutine.mockResolvedValue({ ...fakeRoutine, status: "approved" })

		const fd = new FormData()
		fd.set("intent", "archive")

		await expect(callAction(fd)).rejects.toMatchObject({ init: { status: 403 } })
		expect(mockArchiveRoutine).not.toHaveBeenCalled()
	})

	it("rejects archive on non-approved routine", async () => {
		mockIsAdmin.mockReturnValue(true)
		mockGetRoutine.mockResolvedValue({ ...fakeRoutine, status: "ready" })

		const fd = new FormData()
		fd.set("intent", "archive")

		await expect(callAction(fd)).rejects.toMatchObject({ init: { status: 400 } })
		expect(mockArchiveRoutine).not.toHaveBeenCalled()
	})

	it("rejects archive on already archived routine", async () => {
		mockIsAdmin.mockReturnValue(true)
		mockGetRoutine.mockResolvedValue({
			...fakeRoutine,
			status: "approved",
			archivedAt: new Date(),
		})

		const fd = new FormData()
		fd.set("intent", "archive")

		await expect(callAction(fd)).rejects.toMatchObject({ init: { status: 409 } })
		expect(mockArchiveRoutine).not.toHaveBeenCalled()
	})

	it("rejects archive on archived routine via the archivedAt guard (approve/copy block)", async () => {
		mockIsAdmin.mockReturnValue(true)
		mockGetRoutine.mockResolvedValue({
			...fakeRoutine,
			status: "approved",
			archivedAt: new Date(),
		})

		const fd = new FormData()
		fd.set("intent", "approve")

		await expect(callAction(fd)).rejects.toMatchObject({ init: { status: 403 } })
	})
})

describe("update-priority intent", () => {
	it("updates priority when user has section role", async () => {
		mockHasAnySectionRole.mockReturnValue(true)
		mockUpdateRoutinePriority.mockResolvedValue(undefined)

		const fd = new FormData()
		fd.set("intent", "update-priority")
		fd.set("priority", "1")

		const result = await callAction(fd)
		expect(result).toMatchObject({ data: { success: true } })
		expect(mockUpdateRoutinePriority).toHaveBeenCalledWith("routine-1", 1, "T123456")
	})

	it("rejects when user lacks section role", async () => {
		mockHasAnySectionRole.mockReturnValue(false)

		const fd = new FormData()
		fd.set("intent", "update-priority")
		fd.set("priority", "2")

		await expect(callAction(fd)).rejects.toMatchObject({ init: { status: 403 } })
		expect(mockUpdateRoutinePriority).not.toHaveBeenCalled()
	})

	it("rejects when routine is archived", async () => {
		mockHasAnySectionRole.mockReturnValue(true)
		mockGetRoutine.mockResolvedValue({ ...fakeRoutine, archivedAt: new Date() })

		const fd = new FormData()
		fd.set("intent", "update-priority")
		fd.set("priority", "2")

		await expect(callAction(fd)).rejects.toMatchObject({ init: { status: 403 } })
		expect(mockUpdateRoutinePriority).not.toHaveBeenCalled()
	})

	it("rejects invalid priority value", async () => {
		mockHasAnySectionRole.mockReturnValue(true)

		const fd = new FormData()
		fd.set("intent", "update-priority")
		fd.set("priority", "9")

		await expect(callAction(fd)).rejects.toMatchObject({ init: { status: 400 } })
		expect(mockUpdateRoutinePriority).not.toHaveBeenCalled()
	})

	it("rejects non-numeric priority", async () => {
		mockHasAnySectionRole.mockReturnValue(true)

		const fd = new FormData()
		fd.set("intent", "update-priority")
		fd.set("priority", "feil")

		await expect(callAction(fd)).rejects.toMatchObject({ init: { status: 400 } })
		expect(mockUpdateRoutinePriority).not.toHaveBeenCalled()
	})

	it("rejects missing priority", async () => {
		mockHasAnySectionRole.mockReturnValue(true)

		const fd = new FormData()
		fd.set("intent", "update-priority")

		await expect(callAction(fd)).rejects.toMatchObject({ init: { status: 400 } })
		expect(mockUpdateRoutinePriority).not.toHaveBeenCalled()
	})
})
