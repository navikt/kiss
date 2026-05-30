import { beforeEach, describe, expect, it, vi } from "vitest"

// --- Mocks -----------------------------------------------------------

const mockRequireAuthenticatedUser = vi.fn()
vi.mock("~/lib/auth.server", () => ({
	requireAuthenticatedUser: mockRequireAuthenticatedUser,
}))

const mockCanApproveRoutine = vi.fn()
const mockIsAdmin = vi.fn()
const mockRequireAdmin = vi.fn()
const mockRequireAnySectionRole = vi.fn()
vi.mock("~/lib/authorization.server", () => ({
	canApproveRoutine: mockCanApproveRoutine,
	isAdmin: mockIsAdmin,
	requireAdmin: mockRequireAdmin,
	requireAnySectionRole: mockRequireAnySectionRole,
}))

const mockGetRoutine = vi.fn()
const mockUpdateRoutine = vi.fn()
const mockDeleteDraftRoutine = vi.fn()
const mockUnarchiveRoutine = vi.fn()
const mockApproveRoutine = vi.fn()
const mockReplaceRoutine = vi.fn()
vi.mock("~/db/queries/routines.server", () => ({
	getRoutine: mockGetRoutine,
	updateRoutine: mockUpdateRoutine,
	deleteDraftRoutine: mockDeleteDraftRoutine,
	unarchiveRoutine: mockUnarchiveRoutine,
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
	dbRoles: [{ role: "admin" as const, sectionId: null, devTeamId: null, devTeamSectionId: null }],
}

const fakeNonAdminUser = {
	navIdent: "T654321",
	name: "Ikke-Admin",
	groups: [],
	token: "t",
	dbRoles: [],
}

const fakeSection = { id: "section-1", name: "Test", slug: "test-seksjon" }

function makeRoutine(overrides: Record<string, unknown> = {}) {
	return {
		id: "routine-1",
		sectionId: fakeSection.id,
		name: "Test rutine",
		status: "ready",
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

/** Extract HTTP status from action result (Response or DataWithResponseInit) */
function getStatus(result: unknown): number {
	if (result instanceof Response) return result.status
	if (result && typeof result === "object" && "init" in result) {
		const init = (result as { init?: { status?: number } }).init
		return init?.status ?? 200
	}
	return 200
}

/** Extract fieldErrors from DataWithResponseInit result */
function getFieldErrors(result: unknown): Record<string, string> | undefined {
	if (result && typeof result === "object" && "data" in result) {
		const d = (result as { data?: { fieldErrors?: Record<string, string> } }).data
		return d?.fieldErrors
	}
	return undefined
}

// --- Tests -----------------------------------------------------------

beforeEach(() => {
	vi.resetAllMocks()
	mockRequireAuthenticatedUser.mockResolvedValue(fakeUser)
	mockRequireAdmin.mockImplementation(() => undefined)
	mockIsAdmin.mockReturnValue(true)
	mockGetSectionBySlug.mockResolvedValue(fakeSection)
})

describe("routine edit guards", () => {
	it("calls requireAnySectionRole with the resolved section ID", async () => {
		mockGetRoutine.mockResolvedValue(makeRoutine())

		const fd = new FormData()
		fd.set("intent", "update")
		fd.set("name", "Test")
		fd.set("frequency", "annually")

		await callAction(fd).catch(() => {})
		expect(mockRequireAnySectionRole).toHaveBeenCalledWith(fakeUser, fakeSection.id)
	})

	it("rejects users without a section role with 403", async () => {
		mockRequireAuthenticatedUser.mockResolvedValue(fakeNonAdminUser)
		mockRequireAnySectionRole.mockImplementation(() => {
			throw new Response("Ikke autorisert", { status: 403 })
		})

		const fd = new FormData()
		fd.set("intent", "update")
		fd.set("name", "Test")
		fd.set("frequency", "annually")

		await expect(callAction(fd)).rejects.toMatchObject({ status: 403 })
		expect(mockGetRoutine).not.toHaveBeenCalled()
	})

	it("rejects editing an approved routine with 403", async () => {
		mockGetRoutine.mockResolvedValue(makeRoutine({ status: "approved" }))

		const fd = new FormData()
		fd.set("intent", "update")
		fd.set("name", "New name")
		fd.set("frequency", "annually")

		await expect(callAction(fd)).rejects.toMatchObject({ status: 403 })
		expect(mockUpdateRoutine).not.toHaveBeenCalled()
	})

	it("rejects editing an archived routine with 403", async () => {
		mockGetRoutine.mockResolvedValue(makeRoutine({ status: "archived" }))

		const fd = new FormData()
		fd.set("intent", "update")
		fd.set("name", "New name")
		fd.set("frequency", "annually")

		await expect(callAction(fd)).rejects.toMatchObject({ status: 403 })
		expect(mockUpdateRoutine).not.toHaveBeenCalled()
	})

	it("rejects editing a deleted routine with 403", async () => {
		mockGetRoutine.mockResolvedValue(makeRoutine({ status: "deleted" }))

		const fd = new FormData()
		fd.set("intent", "update")
		fd.set("name", "New name")
		fd.set("frequency", "annually")

		await expect(callAction(fd)).rejects.toMatchObject({ status: 403 })
		expect(mockUpdateRoutine).not.toHaveBeenCalled()
	})

	it("rejects editing a routine with unknown status with 403", async () => {
		mockGetRoutine.mockResolvedValue(makeRoutine({ status: "bogus" }))

		const fd = new FormData()
		fd.set("intent", "update")
		fd.set("name", "New name")
		fd.set("frequency", "annually")

		await expect(callAction(fd)).rejects.toMatchObject({ status: 403 })
		expect(mockUpdateRoutine).not.toHaveBeenCalled()
	})

	it("rejects when routine belongs to a different section (IDOR)", async () => {
		mockGetRoutine.mockResolvedValue(makeRoutine({ sectionId: "other-section-id" }))

		const fd = new FormData()
		fd.set("intent", "update")
		fd.set("name", "IDOR attempt")
		fd.set("frequency", "annually")

		await expect(callAction(fd)).rejects.toMatchObject({ status: 404 })
		expect(mockUpdateRoutine).not.toHaveBeenCalled()
		expect(mockDeleteDraftRoutine).not.toHaveBeenCalled()
	})

	it("allows editing a draft routine", async () => {
		mockGetRoutine.mockResolvedValue(makeRoutine({ status: "draft" }))
		mockUpdateRoutine.mockResolvedValue(undefined)

		const fd = new FormData()
		fd.set("intent", "update")
		fd.set("name", "Updated name")
		fd.set("frequency", "annually")

		const response = await callAction(fd)
		expect(getStatus(response)).toBe(302)
		expect(mockUpdateRoutine).toHaveBeenCalled()
	})

	it("allows editing a ready routine", async () => {
		mockGetRoutine.mockResolvedValue(makeRoutine({ status: "ready" }))
		mockUpdateRoutine.mockResolvedValue(undefined)

		const fd = new FormData()
		fd.set("intent", "update")
		fd.set("name", "Updated name")
		fd.set("frequency", "annually")

		const response = await callAction(fd)
		expect(getStatus(response)).toBe(302)
		expect(mockUpdateRoutine).toHaveBeenCalled()
	})

	it("returns inline field error when name is missing", async () => {
		mockGetRoutine.mockResolvedValue(makeRoutine({ status: "draft" }))

		const fd = new FormData()
		fd.set("intent", "update")
		fd.set("frequency", "annually")

		const response = await callAction(fd)
		expect(getStatus(response)).toBe(400)
		expect(getFieldErrors(response)).toEqual({ name: "Navn er påkrevd" })
		expect(mockUpdateRoutine).not.toHaveBeenCalled()
	})

	it("returns inline field error when frequency is missing", async () => {
		mockGetRoutine.mockResolvedValue(makeRoutine({ status: "draft" }))

		const fd = new FormData()
		fd.set("intent", "update")
		fd.set("name", "Test")

		const response = await callAction(fd)
		expect(getStatus(response)).toBe(400)
		expect(getFieldErrors(response)?.frequency).toBe(
			"Enten kronologisk frekvens eller hendelsesbasert frekvens er påkrevd",
		)
		expect(mockUpdateRoutine).not.toHaveBeenCalled()
	})

	it("returns inline field error when section routine owner role is missing", async () => {
		mockGetRoutine.mockResolvedValue(makeRoutine({ status: "draft" }))

		const fd = new FormData()
		fd.set("intent", "update")
		fd.set("name", "Test")
		fd.set("frequency", "annually")
		fd.set("isSectionRoutine", "on")

		const response = await callAction(fd)
		expect(getStatus(response)).toBe(400)
		expect(getFieldErrors(response)).toEqual({
			sectionRoutineOwnerRole: "Eier/utførende rolle er påkrevd for seksjonsrutiner",
		})
		expect(mockUpdateRoutine).not.toHaveBeenCalled()
	})
})

describe("approve-replace intent", () => {
	it("replaces source routine when user has approval rights", async () => {
		mockGetRoutine.mockResolvedValue(makeRoutine({ status: "ready", sourceRoutineId: "original-1" }))
		mockCanApproveRoutine.mockReturnValue(true)
		mockReplaceRoutine.mockResolvedValue(undefined)

		const fd = new FormData()
		fd.set("intent", "approve-replace")
		fd.set("deadlinePolicy", "continue")

		const response = await callAction(fd)
		expect(getStatus(response)).toBe(302)
		expect(mockReplaceRoutine).toHaveBeenCalledWith("routine-1", "original-1", "continue", "T123456")
	})

	it("rejects replacement without approval rights", async () => {
		mockGetRoutine.mockResolvedValue(makeRoutine({ status: "ready", sourceRoutineId: "original-1" }))
		mockCanApproveRoutine.mockReturnValue(false)

		const fd = new FormData()
		fd.set("intent", "approve-replace")
		fd.set("deadlinePolicy", "continue")

		await expect(callAction(fd)).rejects.toMatchObject({ status: 403 })
		expect(mockReplaceRoutine).not.toHaveBeenCalled()
	})

	it("rejects replacement when routine has no source", async () => {
		mockGetRoutine.mockResolvedValue(makeRoutine({ status: "ready", sourceRoutineId: null }))
		mockCanApproveRoutine.mockReturnValue(true)

		const fd = new FormData()
		fd.set("intent", "approve-replace")
		fd.set("deadlinePolicy", "reset")

		await expect(callAction(fd)).rejects.toMatchObject({ status: 400 })
	})
})

describe("approve-as-new intent", () => {
	it("approves routine as new without replacing source", async () => {
		mockGetRoutine.mockResolvedValue(makeRoutine({ status: "ready" }))
		mockCanApproveRoutine.mockReturnValue(true)
		mockApproveRoutine.mockResolvedValue(undefined)

		const fd = new FormData()
		fd.set("intent", "approve-as-new")

		const response = await callAction(fd)
		expect(getStatus(response)).toBe(302)
		expect(mockApproveRoutine).toHaveBeenCalledWith("routine-1", "T123456")
	})

	it("rejects approval without correct role", async () => {
		mockGetRoutine.mockResolvedValue(makeRoutine({ status: "ready" }))
		mockCanApproveRoutine.mockReturnValue(false)

		const fd = new FormData()
		fd.set("intent", "approve-as-new")

		await expect(callAction(fd)).rejects.toMatchObject({ status: 403 })
		expect(mockApproveRoutine).not.toHaveBeenCalled()
	})
})

describe("non-admin user access", () => {
	beforeEach(() => {
		mockRequireAuthenticatedUser.mockResolvedValue(fakeNonAdminUser)
		mockRequireAdmin.mockImplementation(() => {
			throw new Response("Forbidden", { status: 403 })
		})
	})

	it("allows non-admin user to update a draft routine", async () => {
		mockGetRoutine.mockResolvedValue(makeRoutine({ status: "draft" }))
		mockUpdateRoutine.mockResolvedValue(undefined)

		const fd = new FormData()
		fd.set("intent", "update")
		fd.set("name", "Oppdatert av ikke-admin")
		fd.set("frequency", "annually")

		const response = await callAction(fd)
		expect(getStatus(response)).toBe(302)
		expect(mockUpdateRoutine).toHaveBeenCalled()
		expect(mockRequireAdmin).not.toHaveBeenCalled()
	})

	it("allows non-admin user to update an active routine", async () => {
		mockGetRoutine.mockResolvedValue(makeRoutine({ status: "ready" }))
		mockUpdateRoutine.mockResolvedValue(undefined)

		const fd = new FormData()
		fd.set("intent", "update")
		fd.set("name", "Oppdatert aktiv rutine av ikke-admin")
		fd.set("frequency", "annually")

		const response = await callAction(fd)
		expect(getStatus(response)).toBe(302)
		expect(mockUpdateRoutine).toHaveBeenCalled()
		expect(mockRequireAdmin).not.toHaveBeenCalled()
	})

	it("ignores approved status in update intent for non-admin", async () => {
		mockGetRoutine.mockResolvedValue(makeRoutine({ status: "draft" }))
		mockUpdateRoutine.mockResolvedValue(undefined)

		const fd = new FormData()
		fd.set("intent", "update")
		fd.set("name", "Forsøk på godkjenning via update")
		fd.set("frequency", "annually")
		fd.set("status", "approved")

		const response = await callAction(fd)
		expect(getStatus(response)).toBe(302)
		// "approved" should be silently ignored, not passed to updateRoutine
		const updateCall = mockUpdateRoutine.mock.calls[0][0]
		expect(updateCall.status).toBeUndefined()
	})

	it("rejects non-admin user from deleting a routine", async () => {
		mockGetRoutine.mockResolvedValue(makeRoutine({ status: "draft" }))

		const fd = new FormData()
		fd.set("intent", "delete")

		await expect(callAction(fd)).rejects.toMatchObject({ status: 403 })
		expect(mockDeleteDraftRoutine).not.toHaveBeenCalled()
	})
})

describe("delete intent restrictions", () => {
	it("allows admin to delete a draft routine", async () => {
		mockGetRoutine.mockResolvedValue(makeRoutine({ status: "draft" }))
		mockDeleteDraftRoutine.mockResolvedValue(undefined)

		const fd = new FormData()
		fd.set("intent", "delete")

		const response = await callAction(fd)
		expect(getStatus(response)).toBe(302)
		expect(mockDeleteDraftRoutine).toHaveBeenCalledWith("routine-1", "T123456")
	})

	it("rejects deletion of active routine", async () => {
		mockGetRoutine.mockResolvedValue(makeRoutine({ status: "ready" }))

		const fd = new FormData()
		fd.set("intent", "delete")

		await expect(callAction(fd)).rejects.toMatchObject({ status: 403 })
		expect(mockDeleteDraftRoutine).not.toHaveBeenCalled()
	})
})

describe("archive/unarchive intent", () => {
	it("admin can unarchive a routine with archivedAt set", async () => {
		mockGetRoutine.mockResolvedValue(
			makeRoutine({ status: "draft", archivedAt: new Date("2026-01-01"), archivedBy: "old-admin" }),
		)
		mockUnarchiveRoutine.mockResolvedValue(undefined)

		const fd = new FormData()
		fd.set("intent", "unarchive")

		const response = await callAction(fd)
		expect(getStatus(response)).toBe(302)
		expect(mockUnarchiveRoutine).toHaveBeenCalledWith("routine-1", "T123456")
	})

	it("admin can unarchive a legacy soft-deleted routine (status='deleted' + archivedAt)", async () => {
		mockGetRoutine.mockResolvedValue(
			makeRoutine({ status: "deleted", archivedAt: new Date("2025-06-01"), archivedBy: "legacy-admin" }),
		)
		mockUnarchiveRoutine.mockResolvedValue(undefined)

		const fd = new FormData()
		fd.set("intent", "unarchive")

		// Må fungere selv om status='deleted' (utenfor EDITABLE_STATUSES) — unarchive
		// håndteres før status-guarden.
		const response = await callAction(fd)
		expect(getStatus(response)).toBe(302)
		expect(mockUnarchiveRoutine).toHaveBeenCalledWith("routine-1", "T123456")
	})

	it("non-admin approver can unarchive a routine", async () => {
		mockRequireAuthenticatedUser.mockResolvedValue(fakeNonAdminUser)
		mockIsAdmin.mockReturnValue(false)
		mockCanApproveRoutine.mockReturnValue(true)
		mockGetRoutine.mockResolvedValue(makeRoutine({ status: "draft", archivedAt: new Date() }))
		mockUnarchiveRoutine.mockResolvedValue(undefined)

		const fd = new FormData()
		fd.set("intent", "unarchive")

		const response = await callAction(fd)
		expect(getStatus(response)).toBe(302)
		expect(mockUnarchiveRoutine).toHaveBeenCalledWith("routine-1", fakeNonAdminUser.navIdent)
	})

	it("rejects unarchive on a routine that is not archived with 409", async () => {
		mockGetRoutine.mockResolvedValue(makeRoutine({ status: "ready", archivedAt: null }))

		const fd = new FormData()
		fd.set("intent", "unarchive")

		await expect(callAction(fd)).rejects.toMatchObject({ status: 409 })
		expect(mockUnarchiveRoutine).not.toHaveBeenCalled()
	})

	it("rejects non-admin non-approver from unarchiving", async () => {
		mockRequireAuthenticatedUser.mockResolvedValue(fakeNonAdminUser)
		mockIsAdmin.mockReturnValue(false)
		mockCanApproveRoutine.mockReturnValue(false)
		mockGetRoutine.mockResolvedValue(makeRoutine({ status: "draft", archivedAt: new Date() }))

		const fd = new FormData()
		fd.set("intent", "unarchive")

		await expect(callAction(fd)).rejects.toMatchObject({ status: 403 })
		expect(mockUnarchiveRoutine).not.toHaveBeenCalled()
	})

	it("rejects update intent on an archived routine with 403 (archivedAt guard)", async () => {
		mockGetRoutine.mockResolvedValue(makeRoutine({ status: "draft", archivedAt: new Date() }))

		const fd = new FormData()
		fd.set("intent", "update")
		fd.set("name", "Try edit")
		fd.set("frequency", "annually")

		await expect(callAction(fd)).rejects.toMatchObject({ status: 403 })
		expect(mockUpdateRoutine).not.toHaveBeenCalled()
	})

	it("rejects delete intent on an archived routine with 403 (archivedAt guard)", async () => {
		mockGetRoutine.mockResolvedValue(makeRoutine({ status: "draft", archivedAt: new Date() }))

		const fd = new FormData()
		fd.set("intent", "delete")

		await expect(callAction(fd)).rejects.toMatchObject({ status: 403 })
		expect(mockDeleteDraftRoutine).not.toHaveBeenCalled()
	})

	it("rejects approve-replace intent on an archived routine with 403 (archivedAt guard)", async () => {
		mockGetRoutine.mockResolvedValue(
			makeRoutine({ status: "draft", archivedAt: new Date(), sourceRoutineId: "old-routine" }),
		)
		mockCanApproveRoutine.mockReturnValue(true)

		const fd = new FormData()
		fd.set("intent", "approve-replace")

		await expect(callAction(fd)).rejects.toMatchObject({ status: 403 })
		expect(mockApproveRoutine).not.toHaveBeenCalled()
		expect(mockReplaceRoutine).not.toHaveBeenCalled()
	})
})
