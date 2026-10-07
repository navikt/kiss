import { beforeEach, describe, expect, it, vi } from "vitest"

const mockGetNdaAppParamsGroup = vi.fn()
vi.mock("~/db/queries/deployment-audit.server", () => ({
	getNdaAppParamsGroup: mockGetNdaAppParamsGroup,
}))

const mockGetAppScopeIds = vi.fn()
vi.mock("~/db/queries/applications.server", () => ({
	getAppScopeIds: mockGetAppScopeIds,
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

// Test fixtures use a `sectionId` field per app-params-group entry to describe which
// section each app's canonical scope should resolve to (mirroring getAppScopeIds()'s
// sectionIds), rather than wiring up the full dev-team/NAIS-team join logic.
function setGroup(
	entries: Array<{ applicationId: string; team: string; environment: string; appName: string; sectionId: string }>,
) {
	mockGetNdaAppParamsGroup.mockResolvedValue(entries)
	mockGetAppScopeIds.mockImplementation(async (appId: string) => {
		const entry = entries.find((e) => e.applicationId === appId)
		return { sectionIds: entry ? [entry.sectionId] : [], devTeamIds: [] }
	})
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
		setGroup([
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
		setGroup([])

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
		setGroup([
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
		setGroup([
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

	it("passes when the matched app's naisTeams environment section differs from the review section, but its canonical dev-team scope includes the review's section", async () => {
		// Regression for the authorization-scope bug: an app can be linked to a dev team (or NAIS
		// team) in a different section than the one its deployment environment happens to resolve
		// to. The authorization boundary must be the app's canonical scope (getAppScopeIds(), which
		// also considers dev-team mappings and linked NAIS-team dev-teams), not equality against
		// the deployed environment's naisTeams.sectionId alone.
		mockGetNdaAppParamsGroup.mockResolvedValue([
			{
				applicationId: "app1",
				team: "pensjon-saksbehandling",
				environment: "prod-gcp",
				appName: "pensjon-pen",
				sectionId: "s2",
			},
		])
		mockGetAppScopeIds.mockResolvedValue({ sectionIds: ["s1", "s2"], devTeamIds: ["t1"] })

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
