import { beforeEach, describe, expect, it, vi } from "vitest"

const mockRequireAuthenticatedUser = vi.fn()
vi.mock("~/lib/auth.server", () => ({
	requireAuthenticatedUser: mockRequireAuthenticatedUser,
}))

const mockHasReviewReadAccess = vi.fn()
const mockIsAdmin = vi.fn()
const mockIsAuditor = vi.fn()
vi.mock("~/lib/authorization.server", () => ({
	hasReviewReadAccess: mockHasReviewReadAccess,
	isAdmin: mockIsAdmin,
	isAuditor: mockIsAuditor,
}))

const mockGetAppScopeIdsForApps = vi.fn()
vi.mock("~/db/queries/applications.server", () => ({
	getAppScopeIdsForApps: mockGetAppScopeIdsForApps,
}))

const mockGetFollowUpReviewsForSection = vi.fn()
vi.mock("~/db/queries/routines.server", () => ({
	getFollowUpReviewsForSection: mockGetFollowUpReviewsForSection,
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
		mockGetAppScopeIdsForApps.mockResolvedValue(new Map())
		mockIsAdmin.mockReturnValue(false)
		mockIsAuditor.mockReturnValue(false)
		mockGetFollowUpReviewsForSection.mockResolvedValue([
			{ id: APP_REVIEW_WITH_ACCESS_ID, applicationId: "app-1", openFollowUpPoints: [] },
			{ id: APP_REVIEW_WITHOUT_ACCESS_ID, applicationId: "app-2", openFollowUpPoints: [] },
			{ id: SECTION_REVIEW_ID, applicationId: null, openFollowUpPoints: [] },
		])
	})

	it("keeps only reviews the user has read access to", async () => {
		mockHasReviewReadAccess.mockImplementation(
			async (_user: unknown, scope: { applicationId: string | null }) => scope.applicationId !== "app-2",
		)

		const result = await loader(makeRequest())
		const body = getData<{ reviews: Array<{ id: string }> }>(result)

		expect(body.reviews.map((r) => r.id)).toEqual([APP_REVIEW_WITH_ACCESS_ID, SECTION_REVIEW_ID])
	})

	it("checks app-scoped reviews with the review's applicationId and section-scoped reviews with the section id", async () => {
		mockGetAppScopeIdsForApps.mockResolvedValue(
			new Map([
				["app-1", { devTeamIds: ["team-1"], sectionIds: [] }],
				["app-2", { devTeamIds: ["team-2"], sectionIds: [] }],
			]),
		)
		mockHasReviewReadAccess.mockResolvedValue(true)

		await loader(makeRequest())

		expect(mockHasReviewReadAccess).toHaveBeenCalledWith(
			fakeUser(),
			{ applicationId: "app-1", sectionId: SECTION_ID },
			["team-1"],
		)
		expect(mockHasReviewReadAccess).toHaveBeenCalledWith(
			fakeUser(),
			{ applicationId: "app-2", sectionId: SECTION_ID },
			["team-2"],
		)
		expect(mockHasReviewReadAccess).toHaveBeenCalledWith(
			fakeUser(),
			{ applicationId: null, sectionId: SECTION_ID },
			undefined,
		)
	})

	it("resolves the dev-team scope for all distinct applications in a single batched call", async () => {
		mockGetFollowUpReviewsForSection.mockResolvedValue([
			{ id: "app-1-review-a", applicationId: "app-1", openFollowUpPoints: [] },
			{ id: "app-1-review-b", applicationId: "app-1", openFollowUpPoints: [] },
			{ id: "app-2-review", applicationId: "app-2", openFollowUpPoints: [] },
		])
		mockHasReviewReadAccess.mockResolvedValue(true)

		await loader(makeRequest())

		expect(mockGetAppScopeIdsForApps).toHaveBeenCalledTimes(1)
		expect(mockGetAppScopeIdsForApps).toHaveBeenCalledWith(["app-1", "app-2"])
	})

	it("propagates the authentication failure and never loads reviews", async () => {
		const authError = new Response("Ikke innlogget", { status: 401 })
		mockRequireAuthenticatedUser.mockRejectedValue(authError)

		await expect(loader(makeRequest())).rejects.toBe(authError)

		expect(mockGetFollowUpReviewsForSection).not.toHaveBeenCalled()
		expect(mockHasReviewReadAccess).not.toHaveBeenCalled()
	})

	it("caches the access check per scope so hasReviewReadAccess is called only once per application or section", async () => {
		mockGetFollowUpReviewsForSection.mockResolvedValue([
			{ id: "app-1-review-a", applicationId: "app-1", openFollowUpPoints: [] },
			{ id: "app-1-review-b", applicationId: "app-1", openFollowUpPoints: [] },
			{ id: "section-review-a", applicationId: null, openFollowUpPoints: [] },
			{ id: "section-review-b", applicationId: null, openFollowUpPoints: [] },
		])
		mockHasReviewReadAccess.mockResolvedValue(true)

		await loader(makeRequest())

		expect(mockHasReviewReadAccess).toHaveBeenCalledTimes(2)
	})

	it("skips the batched scope lookup for admin users, who already bypass the app-scope check", async () => {
		mockIsAdmin.mockReturnValue(true)
		mockHasReviewReadAccess.mockResolvedValue(true)

		await loader(makeRequest())

		expect(mockGetAppScopeIdsForApps).toHaveBeenCalledWith([])
	})

	it("skips the batched scope lookup for auditor users, who already bypass the app-scope check", async () => {
		mockIsAuditor.mockReturnValue(true)
		mockHasReviewReadAccess.mockResolvedValue(true)

		await loader(makeRequest())

		expect(mockGetAppScopeIdsForApps).toHaveBeenCalledWith([])
	})
})
