import { beforeEach, describe, expect, it, vi } from "vitest"
import type { NavUser } from "~/lib/auth.server"

const mockCreateReview = vi.fn()
const mockFindActiveReviewConflict = vi.fn()
const mockGetAppsRequiringRoutine = vi.fn()
const mockGetReviewDetailAccessScope = vi.fn()
const mockGetRoutine = vi.fn()
const mockGetRoutineActivityLinks = vi.fn()
vi.mock("~/db/queries/routines.server", () => ({
	createReview: mockCreateReview,
	findActiveReviewConflict: mockFindActiveReviewConflict,
	getAppsRequiringRoutine: mockGetAppsRequiringRoutine,
	getReviewDetailAccessScope: mockGetReviewDetailAccessScope,
	getRoutine: mockGetRoutine,
	getRoutineActivityLinks: mockGetRoutineActivityLinks,
}))

const mockGetSectionBySlug = vi.fn()
const mockIsAppEffectiveInSection = vi.fn()
vi.mock("~/db/queries/sections.server", () => ({
	getSectionBySlug: mockGetSectionBySlug,
	isAppEffectiveInSection: mockIsAppEffectiveInSection,
}))

const mockCanViewReviewDetail = vi.fn()
vi.mock("~/lib/authorization.server", () => ({
	canViewReviewDetail: mockCanViewReviewDetail,
}))

const { createDraftReview } = await import("../create-draft-review.server")

const SECTION_ID = "section-1"
const ROUTINE_ID = "11111111-1111-1111-1111-111111111111"
const APP_ID = "22222222-2222-2222-2222-222222222222"

function fakeUser(): NavUser {
	return {
		navIdent: "Z990001",
		name: "Glad Fjord",
		token: "token",
		groups: [],
		dbRoles: [],
		roles: new Set(),
		isActualAdmin: false,
		adminSuppressed: false,
		entraTeamIds: [],
		entraSectionIds: [],
	}
}

function baseRoutine(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		id: ROUTINE_ID,
		name: "Test-rutine",
		sectionId: SECTION_ID,
		isSectionRoutine: 1,
		archivedAt: null,
		status: "approved",
		...overrides,
	}
}

describe("createDraftReview", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockGetSectionBySlug.mockResolvedValue({ id: SECTION_ID, slug: "test-seksjon" })
		mockGetRoutineActivityLinks.mockResolvedValue([])
		mockFindActiveReviewConflict.mockResolvedValue(null)
		mockCreateReview.mockResolvedValue({ id: "review-1" })
	})

	it("rejects an archived routine", async () => {
		mockGetRoutine.mockResolvedValue(baseRoutine({ archivedAt: new Date() }))

		const result = await createDraftReview({
			routineId: ROUTINE_ID,
			sectionSlug: "test-seksjon",
			applicationId: null,
			user: fakeUser(),
		})

		expect(result).toMatchObject({ ok: false, status: 403 })
		expect(mockCreateReview).not.toHaveBeenCalled()
	})

	it("rejects a routine that is not approved", async () => {
		mockGetRoutine.mockResolvedValue(baseRoutine({ status: "draft" }))

		const result = await createDraftReview({
			routineId: ROUTINE_ID,
			sectionSlug: "test-seksjon",
			applicationId: null,
			user: fakeUser(),
		})

		expect(result).toMatchObject({ ok: false, status: 400 })
		expect(mockCreateReview).not.toHaveBeenCalled()
	})

	it("creates a draft review for an approved, non-archived section routine", async () => {
		mockGetRoutine.mockResolvedValue(baseRoutine())

		const result = await createDraftReview({
			routineId: ROUTINE_ID,
			sectionSlug: "test-seksjon",
			applicationId: null,
			user: fakeUser(),
		})

		expect(result).toMatchObject({ ok: true, reviewId: "review-1" })
	})

	it("returns a generic 409 when a conflicting review exists but the caller lacks detail access", async () => {
		mockGetRoutine.mockResolvedValue(baseRoutine())
		mockFindActiveReviewConflict.mockResolvedValue({ activityType: null, reviewId: "hidden-review" })
		mockGetReviewDetailAccessScope.mockResolvedValue({
			responsibleRole: null,
			sectionId: SECTION_ID,
			status: "draft",
			createdBy: "Z990099",
		})
		mockCanViewReviewDetail.mockReturnValue(false)

		const result = await createDraftReview({
			routineId: ROUTINE_ID,
			sectionSlug: "test-seksjon",
			applicationId: null,
			user: fakeUser(),
		})

		expect(result).toMatchObject({ ok: false, status: 409 })
		if (!result.ok) {
			expect(result.error).not.toContain("aktiv gjennomgang")
		}
		expect(mockCreateReview).not.toHaveBeenCalled()
	})

	it("returns the detailed conflict message when the caller has detail access to the conflicting review", async () => {
		mockGetRoutine.mockResolvedValue(baseRoutine())
		mockFindActiveReviewConflict.mockResolvedValue({ activityType: null, reviewId: "visible-review" })
		mockGetReviewDetailAccessScope.mockResolvedValue({
			responsibleRole: null,
			sectionId: SECTION_ID,
			status: "draft",
			createdBy: "Z990001",
		})
		mockCanViewReviewDetail.mockReturnValue(true)

		const result = await createDraftReview({
			routineId: ROUTINE_ID,
			sectionSlug: "test-seksjon",
			applicationId: null,
			user: fakeUser(),
		})

		expect(result).toMatchObject({ ok: false, status: 409 })
		if (!result.ok) {
			expect(result.error).toContain("aktiv gjennomgang")
		}
	})

	it("returns a generic 409 on a race-condition unique violation when the caller lacks detail access to the newly created conflict", async () => {
		mockGetRoutine.mockResolvedValue(baseRoutine())
		mockFindActiveReviewConflict.mockResolvedValueOnce(null).mockResolvedValueOnce({
			activityType: null,
			reviewId: "hidden-review",
		})
		mockGetReviewDetailAccessScope.mockResolvedValue({
			responsibleRole: null,
			sectionId: SECTION_ID,
			status: "draft",
			createdBy: "Z990099",
		})
		mockCanViewReviewDetail.mockReturnValue(false)
		mockCreateReview.mockRejectedValue(Object.assign(new Error("unique_violation"), { code: "23505" }))

		const result = await createDraftReview({
			routineId: ROUTINE_ID,
			sectionSlug: "test-seksjon",
			applicationId: null,
			user: fakeUser(),
		})

		expect(result).toMatchObject({ ok: false, status: 409 })
		if (!result.ok) {
			expect(result.error).not.toContain("aktiv gjennomgang")
		}
	})

	it("rejects an application routine when applicationId does not require the routine", async () => {
		mockGetRoutine.mockResolvedValue(baseRoutine({ isSectionRoutine: 0 }))
		mockGetAppsRequiringRoutine.mockResolvedValue([{ id: "some-other-app" }])

		const result = await createDraftReview({
			routineId: ROUTINE_ID,
			sectionSlug: "test-seksjon",
			applicationId: APP_ID,
			user: fakeUser(),
		})

		expect(result).toMatchObject({ ok: false, status: 403 })
		expect(mockCreateReview).not.toHaveBeenCalled()
	})
})
