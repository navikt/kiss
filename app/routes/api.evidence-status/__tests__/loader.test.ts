import { beforeEach, describe, expect, it, vi } from "vitest"

const mockRequireAuthenticatedUser = vi.fn()
vi.mock("~/lib/auth.server", () => ({
	requireAuthenticatedUser: mockRequireAuthenticatedUser,
}))

const mockRequireReviewReadAccess = vi.fn()
vi.mock("~/lib/authorization.server", () => ({
	requireReviewReadAccess: mockRequireReviewReadAccess,
}))

const mockGetActivityContext = vi.fn()
vi.mock("~/db/queries/evidence-downloads.server", () => ({
	getActivityContext: mockGetActivityContext,
}))

const mockValidateProviderAccess = vi.fn()
vi.mock("~/lib/evidence-providers/validation.server", async (importOriginal) => {
	const actual = await importOriginal<typeof import("~/lib/evidence-providers/validation.server")>()
	return {
		...actual,
		validateProviderAccess: mockValidateProviderAccess,
	}
})

const mockGetStatus = vi.fn()
vi.mock("~/lib/evidence-providers/index.server", async (importOriginal) => {
	const actual = await importOriginal<typeof import("~/lib/evidence-providers/index.server")>()
	return {
		...actual,
		getEvidenceProvider: () => ({ getStatus: mockGetStatus }),
	}
})

const { loader } = await import("../index")

const ACTIVITY_ID = "11111111-1111-4111-8111-111111111111"
const APPLICATION_ID = "22222222-2222-4222-8222-222222222222"
const SECTION_ID = "33333333-3333-4333-8333-333333333333"
const USER = { navIdent: "Z990001", name: "Glad Fjord", token: "token", groups: [] }

function makeArgs() {
	const rawUrl = `http://localhost/api/evidence-status?providerType=oracle&instanceId=pen&activityId=${ACTIVITY_ID}`
	return {
		request: new Request(rawUrl),
		url: new URL(rawUrl),
		params: {},
		context: {},
	} as unknown as Parameters<typeof loader>[0]
}

describe("api.evidence-status loader", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockRequireAuthenticatedUser.mockResolvedValue(USER)
		mockRequireReviewReadAccess.mockResolvedValue(undefined)
		mockGetActivityContext.mockResolvedValue({
			activityId: ACTIVITY_ID,
			activityType: "oracle_evidence_audit",
			activityStatus: "completed",
			providerConfig: { instanceId: "pen" },
			reviewId: "review-id",
			reviewStatus: "completed",
			routineId: "routine-id",
			routineArchivedAt: null,
			sectionId: SECTION_ID,
			applicationId: APPLICATION_ID,
		})
		mockValidateProviderAccess.mockResolvedValue(undefined)
		mockGetStatus.mockResolvedValue({ items: [] })
	})

	it("checks review read access for the activity's application and section", async () => {
		await loader(makeArgs())

		expect(mockRequireReviewReadAccess).toHaveBeenCalledWith(USER, {
			applicationId: APPLICATION_ID,
			sectionId: SECTION_ID,
		})
	})

	it("propagates 403 when the user cannot read the review", async () => {
		mockRequireReviewReadAccess.mockRejectedValue(new Response("Ikke autorisert", { status: 403 }))

		await expect(loader(makeArgs())).rejects.toMatchObject({ status: 403 })
		expect(mockValidateProviderAccess).not.toHaveBeenCalled()
		expect(mockGetStatus).not.toHaveBeenCalled()
	})
})
