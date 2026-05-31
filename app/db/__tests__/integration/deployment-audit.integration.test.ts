import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { getTestDb, getTestPool, setupTestDatabase, teardownTestDatabase } from "./setup"

vi.mock("~/db/connection.server", () => ({
	get db() {
		return getTestDb()
	},
	get pool() {
		return getTestPool()
	},
}))

// Mock the deployment-audit API client to avoid real API calls
vi.mock("~/lib/deployment-audit.server", () => ({
	getVerificationSummary: vi.fn().mockResolvedValue({
		data: {
			app: { team: "test-team", environment: "prod-gcp", name: "test-app", isActive: true },
			period: { from: "2025-01-01T00:00:00Z", to: "2025-12-31T23:59:59Z" },
			fourEyesCoverage: { total: 50, approved: 40, unapproved: 9, pending: 1, coveragePercent: 80 },
			changeOriginCoverage: { total: 40, linked: 36, dependabot: 3, coveragePercent: 90 },
			lastDeployment: {
				createdAt: "2025-06-01T12:00:00Z",
				deployer: "x123456",
				commitSha: "abc123def456",
				fourEyesStatus: "approved",
				hasChangeOrigin: true,
			},
		},
		notMonitored: false,
	}),
}))

const {
	upsertDeploymentVerification,
	getDeploymentVerificationForApp,
	getDeploymentVerificationsForApps,
	touchSyncAttempt,
} = await import("~/db/queries/deployment-audit.server")

describe("Deployment audit queries integration tests", () => {
	let testAppId: string

	beforeAll(async () => {
		await setupTestDatabase()
	})

	afterAll(async () => {
		await teardownTestDatabase()
	})

	beforeEach(async () => {
		const db = getTestDb()
		await db.execute(/* sql */ `DELETE FROM deployment_verification_summaries`)
		await db.execute(/* sql */ `DELETE FROM monitored_applications`)

		// Create a test application
		const result = await db.execute(
			/* sql */ `INSERT INTO monitored_applications (name, description, created_by, updated_by)
			VALUES ('test-app', 'Test app', 'Z990001', 'Z990001')
			RETURNING id`,
		)
		testAppId = (result.rows[0] as { id: string }).id
	})

	it("should upsert a deployment verification summary", async () => {
		const mockSummary = {
			app: { team: "team", environment: "prod-gcp", name: "app", isActive: true },
			period: { from: "2025-01-01T00:00:00Z", to: "2025-12-31T23:59:59Z" },
			fourEyesCoverage: { total: 50, approved: 40, unapproved: 9, pending: 1, coveragePercent: 80 },
			changeOriginCoverage: { total: 40, linked: 36, dependabot: 3, coveragePercent: 90 },
			lastDeployment: {
				createdAt: "2025-06-01T12:00:00Z",
				deployer: "x123456",
				commitSha: "abc123",
				fourEyesStatus: "approved",
				hasChangeOrigin: true,
			},
		}

		const result = await upsertDeploymentVerification({
			applicationId: testAppId,
			environment: "prod-gcp",
			teamSlug: "test-team",
			appName: "test-app",
			summary: mockSummary,
			status: "synced",
			performedBy: "Z990001",
		})

		expect(result).toBeDefined()
		expect(result.applicationId).toBe(testAppId)
		expect(result.environment).toBe("prod-gcp")
		expect(result.fourEyesCoveragePercent).toBe(80)
		expect(result.changeOriginCoveragePercent).toBe(90)
		expect(result.fourEyesTotal).toBe(50)
		expect(result.fourEyesApproved).toBe(40)
		expect(result.changeOriginTotal).toBe(40)
		expect(result.changeOriginLinked).toBe(36)
		expect(result.status).toBe("synced")
	})

	it("should upsert (update) on conflict", async () => {
		const summary1 = {
			app: { team: "team", environment: "prod-gcp", name: "app", isActive: true },
			period: { from: "2025-01-01T00:00:00Z", to: "2025-06-30T23:59:59Z" },
			fourEyesCoverage: { total: 50, approved: 30, unapproved: 19, pending: 1, coveragePercent: 60 },
			changeOriginCoverage: { total: 40, linked: 20, dependabot: 3, coveragePercent: 50 },
			lastDeployment: null,
		}

		await upsertDeploymentVerification({
			applicationId: testAppId,
			environment: "prod-gcp",
			teamSlug: "test-team",
			appName: "test-app",
			summary: summary1,
			status: "synced",
			performedBy: "first-sync",
		})

		const summary2 = {
			...summary1,
			fourEyesCoverage: { total: 60, approved: 54, unapproved: 5, pending: 1, coveragePercent: 90 },
		}

		const result = await upsertDeploymentVerification({
			applicationId: testAppId,
			environment: "prod-gcp",
			teamSlug: "test-team",
			appName: "test-app",
			summary: summary2,
			status: "synced",
			performedBy: "second-sync",
		})

		expect(result.fourEyesCoveragePercent).toBe(90)
		expect(result.fourEyesTotal).toBe(60)
		expect(result.updatedBy).toBe("second-sync")

		// Should only have one row
		const all = await getDeploymentVerificationForApp(testAppId)
		expect(all).toHaveLength(1)
	})

	it("should upsert not_monitored status with null summary", async () => {
		const result = await upsertDeploymentVerification({
			applicationId: testAppId,
			environment: "prod-gcp",
			teamSlug: "test-team",
			appName: "test-app",
			summary: null,
			status: "not_monitored",
			performedBy: "sync",
		})

		expect(result.status).toBe("not_monitored")
		expect(result.fourEyesCoveragePercent).toBeNull()
		expect(result.changeOriginCoveragePercent).toBeNull()
		expect(result.lastDeploymentAt).toBeNull()
	})

	it("should get deployment verifications for an app", async () => {
		await upsertDeploymentVerification({
			applicationId: testAppId,
			environment: "prod-gcp",
			teamSlug: "test-team",
			appName: "test-app",
			summary: {
				app: { team: "team", environment: "prod-gcp", name: "app", isActive: true },
				period: { from: "2025-01-01T00:00:00Z", to: "2025-12-31T23:59:59Z" },
				fourEyesCoverage: { total: 10, approved: 8, unapproved: 1, pending: 1, coveragePercent: 80 },
				changeOriginCoverage: { total: 10, linked: 9, dependabot: 1, coveragePercent: 90 },
				lastDeployment: null,
			},
			status: "synced",
			performedBy: "test",
		})

		const results = await getDeploymentVerificationForApp(testAppId)
		expect(results).toHaveLength(1)
		expect(results[0].applicationId).toBe(testAppId)
		expect(results[0].environment).toBe("prod-gcp")
	})

	it("should return empty array for app with no verifications", async () => {
		const results = await getDeploymentVerificationForApp(testAppId)
		expect(results).toHaveLength(0)
	})

	it("should get verifications for multiple apps", async () => {
		const db = getTestDb()
		const row = await db.execute(
			/* sql */ `INSERT INTO monitored_applications (name, description, created_by, updated_by)
			VALUES ('test-app-2', 'Test app 2', 'Z990001', 'Z990001')
			RETURNING id`,
		)
		const testAppId2 = (row.rows[0] as { id: string }).id

		await upsertDeploymentVerification({
			applicationId: testAppId,
			environment: "prod-gcp",
			teamSlug: "team1",
			appName: "app1",
			summary: null,
			status: "not_monitored",
			performedBy: "test",
		})

		await upsertDeploymentVerification({
			applicationId: testAppId2,
			environment: "prod-gcp",
			teamSlug: "team2",
			appName: "app2",
			summary: null,
			status: "not_monitored",
			performedBy: "test",
		})

		const results = await getDeploymentVerificationsForApps([testAppId, testAppId2])
		expect(results).toHaveLength(2)
	})

	it("should update lastSyncAttemptedAt with touchSyncAttempt", async () => {
		await upsertDeploymentVerification({
			applicationId: testAppId,
			environment: "prod-gcp",
			teamSlug: "test-team",
			appName: "test-app",
			summary: null,
			status: "not_monitored",
			performedBy: "test",
		})

		const before = await getDeploymentVerificationForApp(testAppId)
		const beforeTime = before[0].lastSyncAttemptedAt

		// Small delay to ensure timestamps differ
		await new Promise((r) => setTimeout(r, 50))

		await touchSyncAttempt(testAppId, "prod-gcp", "retry-sync")

		const after = await getDeploymentVerificationForApp(testAppId)
		expect(after[0].lastSyncAttemptedAt).not.toEqual(beforeTime)
		expect(after[0].updatedBy).toBe("retry-sync")
	})
})
