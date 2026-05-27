import { beforeEach, describe, expect, it, vi } from "vitest"

const mockGetAuthenticatedUser = vi.fn()
const mockRequireUser = vi.fn()
vi.mock("~/lib/auth.server", () => ({
	getAuthenticatedUser: mockGetAuthenticatedUser,
	requireUser: mockRequireUser,
}))

const mockGetSectionBySlug = vi.fn()
vi.mock("~/db/queries/sections.server", () => ({
	getSectionBySlug: mockGetSectionBySlug,
}))

const mockCreateReview = vi.fn()
const mockAutoCreateActivitiesForReview = vi.fn()
const mockGetRoutine = vi.fn()
const mockGetRoutineActivityLinks = vi.fn()
const mockFindActiveReviewConflict = vi.fn().mockResolvedValue(null)
vi.mock("~/db/queries/routines.server", () => ({
	createReview: mockCreateReview,
	autoCreateActivitiesForReview: mockAutoCreateActivitiesForReview,
	getRoutine: mockGetRoutine,
	getRoutineActivityLinks: mockGetRoutineActivityLinks,
	getAppsRequiringRoutine: vi.fn().mockResolvedValue([]),
	findActiveReviewConflict: mockFindActiveReviewConflict,
}))

const mockGetOracleInstancesForApp = vi.fn()
vi.mock("~/db/queries/audit-evidence.server", () => ({
	getOracleInstancesForApp: mockGetOracleInstancesForApp,
}))

const { action } = await import("../index")

const fakeUser = {
	navIdent: "T123456",
	name: "Test",
	groups: [],
	token: "token",
	dbRoles: [{ role: "admin" as const, sectionId: null, devTeamId: null, devTeamSectionId: null }],
}

const fakeSection = { id: "section-1", slug: "test-seksjon" }

function makeRequest(formData: FormData): Request {
	return new Request("http://localhost/seksjoner/test-seksjon/rutiner/r1/gjennomgang/ny", {
		method: "POST",
		body: formData,
	})
}

function callAction(formData: FormData) {
	return action({
		request: makeRequest(formData),
		params: { seksjon: "test-seksjon", rutineId: "r1" },
		context: {},
	} as unknown as Parameters<typeof action>[0]).catch((err) => err)
}

function getStatus(result: unknown): number {
	if (result instanceof Response) return result.status
	if (result && typeof result === "object" && "init" in result) {
		const init = (result as { init?: { status?: number } }).init
		return init?.status ?? 200
	}
	return 200
}

beforeEach(() => {
	vi.resetAllMocks()
	mockGetAuthenticatedUser.mockResolvedValue(fakeUser)
	mockRequireUser.mockReturnValue(fakeUser)
	mockGetSectionBySlug.mockResolvedValue(fakeSection)
	mockCreateReview.mockResolvedValue({ id: "review-1" })
	mockAutoCreateActivitiesForReview.mockResolvedValue(undefined)
	mockGetRoutineActivityLinks.mockResolvedValue([])
})

describe("gjennomgang.ny action - oracle provider config", () => {
	it("returns 400 when oracle activity has no selected application", async () => {
		mockGetRoutine.mockResolvedValue({
			id: "r1",
			sectionId: "section-1",
			isSectionRoutine: 0,
		})
		mockGetRoutineActivityLinks.mockResolvedValue([{ activityType: "oracle_evidence_audit", sortOrder: 0 }])

		const fd = new FormData()
		fd.set("title", "Ny gjennomgang")

		const response = await callAction(fd)
		expect(getStatus(response)).toBe(400)
		expect(mockCreateReview).not.toHaveBeenCalled()
	})

	it("returns 400 when selected oracle instance is not configured for app", async () => {
		mockGetRoutine.mockResolvedValue({
			id: "r1",
			sectionId: "section-1",
			isSectionRoutine: 0,
		})
		mockGetRoutineActivityLinks.mockResolvedValue([{ activityType: "oracle_evidence_audit", sortOrder: 0 }])
		mockGetOracleInstancesForApp.mockResolvedValue([{ instanceId: "PENSJON_PROD" }])

		const fd = new FormData()
		fd.set("title", "Ny gjennomgang")
		fd.set("applicationId", "app-1")
		fd.set("oracleInstanceId", "ANNEN")

		const response = await callAction(fd)
		expect(getStatus(response)).toBe(400)
		expect(mockCreateReview).not.toHaveBeenCalled()
	})

	it("persists providerConfig with auto-selected single oracle instance", async () => {
		mockGetRoutine.mockResolvedValue({
			id: "r1",
			sectionId: "section-1",
			isSectionRoutine: 0,
		})
		mockGetRoutineActivityLinks.mockResolvedValue([{ activityType: "oracle_evidence_audit", sortOrder: 0 }])
		mockGetOracleInstancesForApp.mockResolvedValue([{ instanceId: "PENSJON_PROD" }])

		const fd = new FormData()
		fd.set("title", "Ny gjennomgang")
		fd.set("applicationId", "app-1")

		const response = await callAction(fd)
		expect(getStatus(response)).toBe(302)
		expect(mockAutoCreateActivitiesForReview).toHaveBeenCalledWith("review-1", "r1", "app-1", "T123456", {
			oracle_evidence_audit: { instanceId: "PENSJON_PROD" },
		})
	})
})

describe("gjennomgang.ny action - aktiv gjennomgang-guard", () => {
	const baseRoutine = {
		id: "r1",
		sectionId: "section-1",
		isSectionRoutine: 0,
		archivedAt: null,
		status: "approved",
	}

	it("returns 409 with conflictError when preflight detects existing active review", async () => {
		mockGetRoutine.mockResolvedValue(baseRoutine)
		mockFindActiveReviewConflict.mockResolvedValue({ activityType: null, reviewId: "existing-review" })

		const fd = new FormData()
		fd.set("title", "Ny gjennomgang")
		fd.set("applicationId", "app-1")

		const response = await callAction(fd)
		expect(getStatus(response)).toBe(409)
		expect(response).toMatchObject({ data: { conflictError: expect.any(String) } })
		expect(mockCreateReview).not.toHaveBeenCalled()
	})

	it("returns 409 with conflictError when createReview throws Postgres 23505 (race condition)", async () => {
		mockGetRoutine.mockResolvedValue(baseRoutine)
		mockFindActiveReviewConflict.mockResolvedValue(null)
		const pgError = Object.assign(new Error("unique_violation"), { code: "23505" })
		mockCreateReview.mockRejectedValue(pgError)

		const fd = new FormData()
		fd.set("title", "Ny gjennomgang")
		fd.set("applicationId", "app-1")

		const response = await callAction(fd)
		expect(getStatus(response)).toBe(409)
		expect(response).toMatchObject({ data: { conflictError: expect.any(String) } })
	})

	it("re-throws non-23505 errors from createReview", async () => {
		mockGetRoutine.mockResolvedValue(baseRoutine)
		mockFindActiveReviewConflict.mockResolvedValue(null)
		mockCreateReview.mockRejectedValue(new Error("database connection lost"))

		const fd = new FormData()
		fd.set("title", "Ny gjennomgang")
		fd.set("applicationId", "app-1")

		const result = await callAction(fd)
		expect(result).toBeInstanceOf(Error)
		expect((result as Error).message).toBe("database connection lost")
	})
})
