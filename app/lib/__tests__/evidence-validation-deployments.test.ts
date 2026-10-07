import { beforeEach, describe, expect, it, vi } from "vitest"

const mockGetNdaAppParamsGroup = vi.fn()
vi.mock("~/db/queries/deployment-audit.server", () => ({
	getNdaAppParamsGroup: mockGetNdaAppParamsGroup,
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
		mockGetNdaAppParamsGroup.mockResolvedValue([
			{
				applicationId: "app1",
				team: "pensjon-saksbehandling",
				environment: "prod-gcp",
				appName: "pensjon-pen",
				sectionId: "s1",
			},
		])
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
		mockGetNdaAppParamsGroup.mockResolvedValue([])

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

	it("passes when params match a linked application in the group, not just the primary", async () => {
		mockGetNdaAppParamsGroup.mockResolvedValue([
			{
				applicationId: "app1",
				team: "pensjon-saksbehandling",
				environment: "prod-gcp",
				appName: "pensjon-pen",
				sectionId: "s1",
			},
			{
				applicationId: "app2",
				team: "pensjon-saksbehandling",
				environment: "prod-fss",
				appName: "pensjon-pen-variant",
				sectionId: "s1",
			},
		])

		await expect(
			validateProviderAccess(
				"deployments",
				{
					team: "pensjon-saksbehandling",
					environment: "prod-fss",
					appName: "pensjon-pen-variant",
					periodType: "yearly",
					periodStart: "2025-01-01",
				},
				baseContext,
			),
		).resolves.toBeUndefined()
	})

	it("throws 403 when params match a linked application's team/environment/appName but that application belongs to a different section than the review", async () => {
		// linkApplication() does not require linked apps to share a section/team, so a linked
		// sibling can belong to a section the reviewing user has no access to. Matching on
		// team/environment/appName alone must not be treated as an authorization boundary.
		mockGetNdaAppParamsGroup.mockResolvedValue([
			{
				applicationId: "app1",
				team: "pensjon-saksbehandling",
				environment: "prod-gcp",
				appName: "pensjon-pen",
				sectionId: "s1",
			},
			{
				applicationId: "app2",
				team: "annet-team",
				environment: "prod-fss",
				appName: "uavhengig-app",
				sectionId: "s2",
			},
		])

		try {
			await validateProviderAccess(
				"deployments",
				{
					team: "annet-team",
					environment: "prod-fss",
					appName: "uavhengig-app",
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
