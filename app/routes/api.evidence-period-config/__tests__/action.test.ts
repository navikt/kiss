import { beforeEach, describe, expect, it, vi } from "vitest"

const mockRequireAuthenticatedUser = vi.fn()
vi.mock("~/lib/auth.server", () => ({
	requireAuthenticatedUser: mockRequireAuthenticatedUser,
}))

const mockRequireAnySectionRole = vi.fn()
vi.mock("~/lib/authorization.server", () => ({
	requireAnySectionRole: mockRequireAnySectionRole,
}))

const mockGetActivityContext = vi.fn()
vi.mock("~/db/queries/evidence-downloads.server", () => ({
	getActivityContext: mockGetActivityContext,
}))

const mockSavePeriodConfig = vi.fn()
vi.mock("~/db/queries/routines.server", () => ({
	savePeriodConfig: mockSavePeriodConfig,
}))

const { action } = await import("../index")

function makeRequest(formData: FormData): Request {
	return new Request("http://localhost/api/evidence-period-config", {
		method: "POST",
		body: formData,
	})
}

function getStatus(result: unknown): number {
	if (result instanceof Response) return result.status
	if (result && typeof result === "object" && "init" in result) {
		const init = (result as { init?: { status?: number } }).init
		return init?.status ?? 200
	}
	return 200
}

function getData<T>(result: unknown): T | null {
	if (result && typeof result === "object" && "data" in result) {
		return (result as { data: T }).data
	}
	return null
}

async function callAction(formData: FormData) {
	return action({
		request: makeRequest(formData),
		params: {},
		context: {},
	} as Parameters<typeof action>[0])
}

describe("api.evidence-period-config action", () => {
	beforeEach(() => {
		vi.clearAllMocks()

		const user = {
			navIdent: "Z123456",
			name: "Test User",
			token: "test-token",
			groups: [],
		}
		mockRequireAuthenticatedUser.mockResolvedValue(user)
		mockRequireAnySectionRole.mockImplementation(() => {})
		mockGetActivityContext.mockResolvedValue({
			sectionId: "section-1",
			reviewStatus: "draft",
			activityStatus: "pending",
			routineArchivedAt: null,
			activityType: "deployment_evidence_report",
		})
		mockSavePeriodConfig.mockResolvedValue({ id: "activity-id" })
	})

	it("saves period config for valid deployments activity", async () => {
		const formData = new FormData()
		formData.set("activityId", "11111111-1111-4111-8111-111111111111")
		formData.set("periodType", "yearly")
		formData.set("periodStart", "2025-01-01")

		const result = await callAction(formData)

		expect(getStatus(result)).toBe(200)
		expect(getData<{ success: boolean }>(result)?.success).toBe(true)
		expect(mockSavePeriodConfig).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111", {
			periodType: "yearly",
			periodStart: "2025-01-01",
		})
	})

	it("rejects non-deployment activity types", async () => {
		mockGetActivityContext.mockResolvedValue({
			sectionId: "section-1",
			reviewStatus: "draft",
			activityStatus: "pending",
			routineArchivedAt: null,
			activityType: "oracle_evidence_audit",
		})

		const formData = new FormData()
		formData.set("activityId", "11111111-1111-4111-8111-111111111111")
		formData.set("periodType", "yearly")
		formData.set("periodStart", "2025-01-01")

		try {
			await callAction(formData)
			expect.fail("should throw for non-deployment activity type")
		} catch (thrown) {
			expect(getStatus(thrown)).toBe(400)
		}

		expect(mockSavePeriodConfig).not.toHaveBeenCalled()
	})

	it("rejects periods that are not ended", async () => {
		const nextYear = new Date().getFullYear() + 1
		const formData = new FormData()
		formData.set("activityId", "11111111-1111-4111-8111-111111111111")
		formData.set("periodType", "yearly")
		formData.set("periodStart", `${nextYear}-01-01`)

		try {
			await callAction(formData)
			expect.fail("should throw for non-ended period")
		} catch (thrown) {
			expect(getStatus(thrown)).toBe(400)
			expect(getData<{ error: string }>(thrown)?.error).toContain("ikke avsluttet")
		}

		expect(mockSavePeriodConfig).not.toHaveBeenCalled()
	})
})
