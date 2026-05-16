import { beforeEach, describe, expect, it, vi } from "vitest"

const mockGetNdaAppParams = vi.fn()
vi.mock("~/db/queries/deployment-audit.server", () => ({
	getNdaAppParams: mockGetNdaAppParams,
}))

vi.mock("~/db/queries/evidence-downloads.server", () => ({
	isInstanceConfiguredForApp: vi.fn(),
}))

const { validateProviderAccess } = await import("../evidence-providers/validation.server")

function getStatus(result: unknown): number {
	if (result instanceof Response) return result.status
	if (result && typeof result === "object" && "init" in result) {
		const init = (result as { init?: { status?: number } }).init
		return init?.status ?? 200
	}
	return 200
}

const baseContext = {
	activityId: "a1",
	activityType: "deployment_evidence_report",
	activityStatus: "pending",
	reviewId: "r1",
	reviewStatus: "draft",
	routineId: "rt1",
	routineArchivedAt: null,
	sectionId: "s1",
	applicationId: "app1",
}

describe("validateProviderAccess for deployments", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockGetNdaAppParams.mockResolvedValue({
			team: "pensjon-saksbehandling",
			environment: "prod-gcp",
			appName: "pensjon-pen",
		})
	})

	it("passes when params match app and period is valid", async () => {
		await expect(
			validateProviderAccess(
				"deployments",
				{
					team: "pensjon-saksbehandling",
					environment: "prod-gcp",
					appName: "pensjon-pen",
					periodType: "yearly",
					periodStart: "2025-01-01",
				},
				baseContext,
			),
		).resolves.toBeUndefined()
	})

	it("throws 400 when app has no supported production environment", async () => {
		mockGetNdaAppParams.mockResolvedValue(null)

		try {
			await validateProviderAccess(
				"deployments",
				{
					team: "pensjon-saksbehandling",
					environment: "prod-gcp",
					appName: "pensjon-pen",
					periodType: "yearly",
					periodStart: "2025-01-01",
				},
				baseContext,
			)
			expect.fail("should throw")
		} catch (thrown) {
			expect(getStatus(thrown)).toBe(400)
		}
	})

	it("throws 403 when team does not match resolved app params", async () => {
		try {
			await validateProviderAccess(
				"deployments",
				{
					team: "annet-team",
					environment: "prod-gcp",
					appName: "pensjon-pen",
					periodType: "yearly",
					periodStart: "2025-01-01",
				},
				baseContext,
			)
			expect.fail("should throw")
		} catch (thrown) {
			expect(getStatus(thrown)).toBe(403)
		}
	})

	it("throws 400 when periodType is invalid", async () => {
		try {
			await validateProviderAccess(
				"deployments",
				{
					team: "pensjon-saksbehandling",
					environment: "prod-gcp",
					appName: "pensjon-pen",
					periodType: "weekly",
					periodStart: "2025-01-01",
				},
				baseContext,
			)
			expect.fail("should throw")
		} catch (thrown) {
			expect(getStatus(thrown)).toBe(400)
		}
	})
})
