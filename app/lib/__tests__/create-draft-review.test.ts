import { beforeEach, describe, expect, it, vi } from "vitest"

const mockGetRoutine = vi.fn()
const mockFindActiveReviewConflict = vi.fn()
const mockGetAppsRequiringRoutine = vi.fn()
const mockGetRoutineActivityLinks = vi.fn()
const mockCreateReview = vi.fn()
vi.mock("~/db/queries/routines.server", () => ({
	getRoutine: mockGetRoutine,
	findActiveReviewConflict: mockFindActiveReviewConflict,
	getAppsRequiringRoutine: mockGetAppsRequiringRoutine,
	getRoutineActivityLinks: mockGetRoutineActivityLinks,
	createReview: mockCreateReview,
	isReviewConflictResponse: (err: unknown): err is Response => err instanceof Response && err.status === 409,
}))

const mockGetSectionBySlug = vi.fn()
const mockIsAppEffectiveInSection = vi.fn()
vi.mock("~/db/queries/sections.server", () => ({
	getSectionBySlug: mockGetSectionBySlug,
	isAppEffectiveInSection: mockIsAppEffectiveInSection,
}))

const { createDraftReview } = await import("../create-draft-review.server")

const fakeRoutineId = "c388d8ec-aa81-415c-ad18-30e91592720a"
const fakeSection = { id: "section-1", slug: "test-seksjon" }
const fakeSectionRoutine = { id: fakeRoutineId, sectionId: "section-1", isSectionRoutine: 1 }

beforeEach(() => {
	vi.resetAllMocks()
	mockGetSectionBySlug.mockResolvedValue(fakeSection)
	mockGetRoutine.mockResolvedValue(fakeSectionRoutine)
	mockFindActiveReviewConflict.mockResolvedValue(null)
	mockGetRoutineActivityLinks.mockResolvedValue([])
	mockCreateReview.mockResolvedValue({ id: "review-1" })
})

describe("createDraftReview", () => {
	it("legger oppretteren til som deltaker", async () => {
		const result = await createDraftReview({
			routineId: fakeRoutineId,
			sectionSlug: "test-seksjon",
			applicationId: null,
			navIdent: "Z990001",
			userName: "Glad Fjord",
		})

		expect(result.ok).toBe(true)
		expect(mockCreateReview).toHaveBeenCalledWith(
			expect.objectContaining({
				participants: [{ userIdent: "Z990001", userName: "Glad Fjord" }],
			}),
		)
	})

	it("setter userName til null når det ikke er oppgitt", async () => {
		const result = await createDraftReview({
			routineId: fakeRoutineId,
			sectionSlug: "test-seksjon",
			applicationId: null,
			navIdent: "Z990001",
		})

		expect(result.ok).toBe(true)
		expect(mockCreateReview).toHaveBeenCalledWith(
			expect.objectContaining({
				participants: [{ userIdent: "Z990001", userName: null }],
			}),
		)
	})

	it("navngir den faktiske konflikterende (cross-routine) aktivitetstypen når createReview kaster typed 409, ikke første aktivitetstype på denne rutinen", async () => {
		mockGetRoutineActivityLinks.mockResolvedValue([
			{ activityType: "oracle_evidence_audit", sortOrder: 0 },
			{ activityType: "github_access_maintenance", sortOrder: 1 },
		])
		mockFindActiveReviewConflict
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({ activityType: "github_access_maintenance", reviewId: "other-review" })
		mockCreateReview.mockRejectedValue(new Response("conflict", { status: 409 }))

		const result = await createDraftReview({
			routineId: fakeRoutineId,
			sectionSlug: "test-seksjon",
			applicationId: null,
			navIdent: "Z990001",
		})

		expect(result.ok).toBe(false)
		if (result.ok) throw new Error("expected failure")
		expect(result.status).toBe(409)
		expect(result.error).toContain("GitHub-tilgangsgjennomgang")
		expect(result.error).not.toContain("Oracle Unified Audit-konfigurasjon")
	})
})
