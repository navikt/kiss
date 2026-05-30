import { beforeEach, describe, expect, it, vi } from "vitest"

// --- Mocks -----------------------------------------------------------

const mockRequireAuthenticatedUser = vi.fn()
vi.mock("~/lib/auth.server", () => ({
	requireAuthenticatedUser: mockRequireAuthenticatedUser,
}))

const mockRequireAnySectionRole = vi.fn()
const mockIsAdmin = vi.fn().mockReturnValue(true)
const mockCanManageSection = vi.fn().mockReturnValue(true)
vi.mock("~/lib/authorization.server", () => ({
	requireAnySectionRole: mockRequireAnySectionRole,
	isAdmin: mockIsAdmin,
	canManageSection: mockCanManageSection,
}))

const mockCreateRoutine = vi.fn()
vi.mock("~/db/queries/routines.server", () => ({
	createRoutine: mockCreateRoutine,
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

const fakeSection = { id: "section-1", name: "Test", slug: "test-seksjon" }

function makeRequest(formData: FormData): Request {
	return new Request("http://localhost/seksjoner/test-seksjon/rutiner/ny", {
		method: "POST",
		body: formData,
	})
}

function callAction(formData: FormData) {
	return action({
		request: makeRequest(formData),
		params: { seksjon: "test-seksjon" },
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
	mockGetSectionBySlug.mockResolvedValue(fakeSection)
})

describe("inline validation errors", () => {
	it("returns field error when name is missing", async () => {
		const fd = new FormData()
		fd.set("frequency", "annually")

		const response = await callAction(fd)
		expect(getStatus(response)).toBe(400)
		expect(getFieldErrors(response)).toEqual({ name: "Navn er påkrevd" })
		expect(mockCreateRoutine).not.toHaveBeenCalled()
	})

	it("returns field error when both frequencies are missing", async () => {
		const fd = new FormData()
		fd.set("name", "Test rutine")

		const response = await callAction(fd)
		expect(getStatus(response)).toBe(400)
		expect(getFieldErrors(response)?.frequency).toBe(
			"Enten kronologisk frekvens eller hendelsesbasert frekvens er påkrevd",
		)
		expect(mockCreateRoutine).not.toHaveBeenCalled()
	})

	it("returns field error when section routine owner role is missing", async () => {
		const fd = new FormData()
		fd.set("name", "Test rutine")
		fd.set("frequency", "annually")
		fd.set("isSectionRoutine", "on")

		const response = await callAction(fd)
		expect(getStatus(response)).toBe(400)
		expect(getFieldErrors(response)).toEqual({
			sectionRoutineOwnerRole: "Eier/utførende rolle er påkrevd for seksjonsrutiner",
		})
		expect(mockCreateRoutine).not.toHaveBeenCalled()
	})

	it("accepts event frequency without periodic frequency", async () => {
		mockCreateRoutine.mockResolvedValue({ id: "new-routine-1" })

		const fd = new FormData()
		fd.set("name", "Test rutine")
		fd.set("eventFrequency", "Ved ny ansatt")

		const response = await callAction(fd)
		expect(getStatus(response)).toBe(302)
		expect(mockCreateRoutine).toHaveBeenCalled()
	})

	it("creates routine successfully with valid data", async () => {
		mockCreateRoutine.mockResolvedValue({ id: "new-routine-1" })

		const fd = new FormData()
		fd.set("name", "Test rutine")
		fd.set("frequency", "annually")

		const response = await callAction(fd)
		expect(getStatus(response)).toBe(302)
		expect(mockCreateRoutine).toHaveBeenCalledWith(
			expect.objectContaining({
				name: "Test rutine",
				frequency: "annually",
				sectionId: fakeSection.id,
			}),
		)
	})
})
