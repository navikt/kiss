import { beforeEach, describe, expect, it, vi } from "vitest"

const mockRequireAuthenticatedUser = vi.fn()
vi.mock("~/lib/auth.server", () => ({
	requireAuthenticatedUser: mockRequireAuthenticatedUser,
}))

const mockCanViewReviewDetail = vi.fn()
vi.mock("~/lib/authorization.server", () => ({
	canViewReviewDetail: mockCanViewReviewDetail,
}))

const mockGetFollowUpReviewsForSection = vi.fn()
const mockGetReviewDetailAccessScopes = vi.fn()
vi.mock("~/db/queries/routines.server", () => ({
	getFollowUpReviewsForSection: mockGetFollowUpReviewsForSection,
	getReviewDetailAccessScopes: mockGetReviewDetailAccessScopes,
}))

const mockGetSectionBySlug = vi.fn()
vi.mock("~/db/queries/sections.server", () => ({
	getSectionBySlug: mockGetSectionBySlug,
}))

const { loader } = await import("../index")

const SECTION_ID = "11111111-1111-1111-1111-111111111111"
const APP_REVIEW_WITH_ACCESS_ID = "app-review-with-access"
const APP_REVIEW_WITHOUT_ACCESS_ID = "app-review-without-access"
const SECTION_REVIEW_ID = "section-review"

function fakeUser() {
	return { navIdent: "Z990001", name: "Glad Fjord", token: "token", groups: [] }
}

function fakeScope(overrides: Partial<Record<string, unknown>> = {}) {
	return { responsibleRole: null, sectionId: SECTION_ID, status: "completed", createdBy: "Z990002", ...overrides }
}

function makeRequest(seksjon = "test-seksjon") {
	return {
		request: new Request(`http://localhost/seksjoner/${seksjon}/rutiner/oppfolging`),
		params: { seksjon },
		context: {},
	} as unknown as Parameters<typeof loader>[0]
}

function getData<T>(result: unknown): T {
	return (result as { data: T }).data
}

describe("seksjoner.$seksjon.rutiner.oppfolging loader", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockRequireAuthenticatedUser.mockResolvedValue(fakeUser())
		mockGetSectionBySlug.mockResolvedValue({ id: SECTION_ID, name: "Test-seksjon" })
		mockGetFollowUpReviewsForSection.mockResolvedValue([
			{ id: APP_REVIEW_WITH_ACCESS_ID, applicationId: "app-1", openFollowUpPoints: [] },
			{ id: APP_REVIEW_WITHOUT_ACCESS_ID, applicationId: "app-2", openFollowUpPoints: [] },
			{ id: SECTION_REVIEW_ID, applicationId: null, openFollowUpPoints: [] },
		])
		mockGetReviewDetailAccessScopes.mockResolvedValue(
			new Map([
				[APP_REVIEW_WITH_ACCESS_ID, fakeScope()],
				[APP_REVIEW_WITHOUT_ACCESS_ID, fakeScope()],
				[SECTION_REVIEW_ID, fakeScope()],
			]),
		)
	})

	it("keeps only reviews the user has detail access to", async () => {
		mockCanViewReviewDetail.mockImplementation(
			(_user: unknown, scope: { createdBy: string }) => scope.createdBy !== "Z990099",
		)
		mockGetReviewDetailAccessScopes.mockResolvedValue(
			new Map([
				[APP_REVIEW_WITH_ACCESS_ID, fakeScope()],
				[APP_REVIEW_WITHOUT_ACCESS_ID, fakeScope({ createdBy: "Z990099" })],
				[SECTION_REVIEW_ID, fakeScope()],
			]),
		)

		const result = await loader(makeRequest())
		const body = getData<{ reviews: Array<{ id: string }> }>(result)

		expect(body.reviews.map((r) => r.id)).toEqual([APP_REVIEW_WITH_ACCESS_ID, SECTION_REVIEW_ID])
	})

	it("looks up detail-access scopes for every review returned for the section", async () => {
		mockCanViewReviewDetail.mockReturnValue(true)

		await loader(makeRequest())

		expect(mockGetReviewDetailAccessScopes).toHaveBeenCalledWith([
			APP_REVIEW_WITH_ACCESS_ID,
			APP_REVIEW_WITHOUT_ACCESS_ID,
			SECTION_REVIEW_ID,
		])
	})

	it("excludes a review when its detail-access scope cannot be resolved", async () => {
		mockCanViewReviewDetail.mockReturnValue(true)
		mockGetReviewDetailAccessScopes.mockResolvedValue(
			new Map([
				[APP_REVIEW_WITH_ACCESS_ID, fakeScope()],
				[SECTION_REVIEW_ID, fakeScope()],
			]),
		)

		const result = await loader(makeRequest())
		const body = getData<{ reviews: Array<{ id: string }> }>(result)

		expect(body.reviews.map((r) => r.id)).toEqual([APP_REVIEW_WITH_ACCESS_ID, SECTION_REVIEW_ID])
	})

	it("propagates the authentication failure and never loads reviews", async () => {
		const authError = new Response("Ikke innlogget", { status: 401 })
		mockRequireAuthenticatedUser.mockRejectedValue(authError)

		await expect(loader(makeRequest())).rejects.toBe(authError)

		expect(mockGetFollowUpReviewsForSection).not.toHaveBeenCalled()
		expect(mockGetReviewDetailAccessScopes).not.toHaveBeenCalled()
	})
})
