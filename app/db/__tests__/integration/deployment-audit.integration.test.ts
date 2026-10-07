import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { getTestDb, getTestPool, setupTestDatabase, teardownTestDatabase, truncateWithRetry } from "./setup"

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
	getDeploymentVerificationAggregate,
	touchSyncAttempt,
	getNdaAppParams,
	getNdaAppParamsGroup,
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
		await truncateWithRetry([
			"deployment_verification_summaries",
			"application_environments",
			"nais_teams",
			"monitored_applications",
			"sections",
		])

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

	describe("getDeploymentVerificationAggregate", () => {
		it("should return zero stats for an explicitly empty applicationIds list", async () => {
			// Insert synced data to ensure the global table is non-empty
			await upsertDeploymentVerification({
				applicationId: testAppId,
				environment: "prod-gcp",
				teamSlug: "test-team",
				appName: "test-app",
				summary: {
					app: { team: "test-team", environment: "prod-gcp", name: "test-app", isActive: true },
					period: { from: "2025-01-01T00:00:00Z", to: "2025-12-31T23:59:59Z" },
					fourEyesCoverage: { total: 100, approved: 80, unapproved: 19, pending: 1, coveragePercent: 80 },
					changeOriginCoverage: { total: 80, linked: 60, dependabot: 5, coveragePercent: 75 },
					lastDeployment: null,
				},
				status: "synced",
				performedBy: "Z990001",
			})

			const result = await getDeploymentVerificationAggregate([])

			expect(result.appsWithData).toBe(0)
			expect(result.fourEyesTotal).toBe(0)
			expect(result.fourEyesApproved).toBe(0)
			expect(result.changeOriginTotal).toBe(0)
			expect(result.changeOriginLinked).toBe(0)
			expect(result.fourEyesPercent).toBeNull()
			expect(result.changeOriginPercent).toBeNull()
		})

		it("should aggregate only the specified applicationIds", async () => {
			const db = getTestDb()
			const row = await db.execute(
				/* sql */ `INSERT INTO monitored_applications (name, description, created_by, updated_by)
				VALUES ('annen-app', 'Annen app', 'Z990001', 'Z990001')
				RETURNING id`,
			)
			const otherAppId = (row.rows[0] as { id: string }).id

			await upsertDeploymentVerification({
				applicationId: testAppId,
				environment: "prod-gcp",
				teamSlug: "test-team",
				appName: "test-app",
				summary: {
					app: { team: "test-team", environment: "prod-gcp", name: "test-app", isActive: true },
					period: { from: "2025-01-01T00:00:00Z", to: "2025-12-31T23:59:59Z" },
					fourEyesCoverage: { total: 10, approved: 8, unapproved: 1, pending: 1, coveragePercent: 80 },
					changeOriginCoverage: { total: 10, linked: 7, dependabot: 1, coveragePercent: 70 },
					lastDeployment: null,
				},
				status: "synced",
				performedBy: "Z990001",
			})

			await upsertDeploymentVerification({
				applicationId: otherAppId,
				environment: "prod-gcp",
				teamSlug: "annet-team",
				appName: "annen-app",
				summary: {
					app: { team: "annet-team", environment: "prod-gcp", name: "annen-app", isActive: true },
					period: { from: "2025-01-01T00:00:00Z", to: "2025-12-31T23:59:59Z" },
					fourEyesCoverage: { total: 50, approved: 40, unapproved: 9, pending: 1, coveragePercent: 80 },
					changeOriginCoverage: { total: 50, linked: 30, dependabot: 2, coveragePercent: 60 },
					lastDeployment: null,
				},
				status: "synced",
				performedBy: "Z990001",
			})

			const result = await getDeploymentVerificationAggregate([testAppId])

			expect(result.appsWithData).toBe(1)
			expect(result.fourEyesTotal).toBe(10)
			expect(result.fourEyesApproved).toBe(8)
			expect(result.changeOriginTotal).toBe(10)
			expect(result.changeOriginLinked).toBe(7)
		})

		it("should aggregate all apps when applicationIds is undefined", async () => {
			const db = getTestDb()
			const row = await db.execute(
				/* sql */ `INSERT INTO monitored_applications (name, description, created_by, updated_by)
				VALUES ('tredje-app', 'Tredje app', 'Z990001', 'Z990001')
				RETURNING id`,
			)
			const thirdAppId = (row.rows[0] as { id: string }).id

			for (const [appId, appName, teamSlug] of [
				[testAppId, "test-app", "test-team"],
				[thirdAppId, "tredje-app", "tredje-team"],
			]) {
				await upsertDeploymentVerification({
					applicationId: appId,
					environment: "prod-gcp",
					teamSlug,
					appName,
					summary: {
						app: { team: teamSlug, environment: "prod-gcp", name: appName, isActive: true },
						period: { from: "2025-01-01T00:00:00Z", to: "2025-12-31T23:59:59Z" },
						fourEyesCoverage: { total: 10, approved: 8, unapproved: 1, pending: 1, coveragePercent: 80 },
						changeOriginCoverage: { total: 10, linked: 7, dependabot: 1, coveragePercent: 70 },
						lastDeployment: null,
					},
					status: "synced",
					performedBy: "Z990001",
				})
			}

			const result = await getDeploymentVerificationAggregate(undefined)

			expect(result.appsWithData).toBe(2)
			expect(result.fourEyesTotal).toBe(20)
			expect(result.fourEyesApproved).toBe(16)
		})
	})

	describe("getNdaAppParams", () => {
		async function createSection(slug: string) {
			const db = getTestDb()
			const r = await db.execute(
				/* sql */ `INSERT INTO sections (name, slug, created_by, updated_by) VALUES ('${slug}', '${slug}', 'test', 'test') RETURNING id`,
			)
			return (r.rows[0] as { id: string }).id
		}

		async function createNaisTeam(sectionId: string, slug: string) {
			const db = getTestDb()
			const r = await db.execute(
				/* sql */ `INSERT INTO nais_teams (slug, section_id) VALUES ('${slug}', '${sectionId}') RETURNING id`,
			)
			return (r.rows[0] as { id: string }).id
		}

		async function createApp(name: string, primaryApplicationId: string | null = null) {
			const db = getTestDb()
			const primaryVal = primaryApplicationId ? `'${primaryApplicationId}'` : "NULL"
			const r = await db.execute(
				/* sql */ `INSERT INTO monitored_applications (name, primary_application_id, created_by, updated_by)
				VALUES ('${name}', ${primaryVal}, 'test', 'test') RETURNING id`,
			)
			return (r.rows[0] as { id: string }).id
		}

		async function createEnvironment(appId: string, naisTeamId: string, cluster: string) {
			const db = getTestDb()
			await db.execute(
				/* sql */ `INSERT INTO application_environments (application_id, cluster, namespace, nais_team_id)
				VALUES ('${appId}', '${cluster}', 'default', '${naisTeamId}')`,
			)
		}

		async function archiveApp(appId: string) {
			const db = getTestDb()
			await db.execute(/* sql */ `UPDATE monitored_applications SET archived_at = now() WHERE id = '${appId}'`)
		}

		it("resolves team/environment/appName for an application with its own production environment", async () => {
			const sectionId = await createSection("sec-nda1")
			const naisTeamId = await createNaisTeam(sectionId, "team-nda1")
			const appId = await createApp("app-nda1")
			await createEnvironment(appId, naisTeamId, "prod-gcp")

			const result = await getNdaAppParams(appId)

			expect(result).toEqual({ team: "team-nda1", environment: "prod-gcp", appName: "app-nda1", sectionId })
		})

		it("returns null when a linked application has no production environment of its own", async () => {
			const sectionId = await createSection("sec-nda2")
			const naisTeamId = await createNaisTeam(sectionId, "team-nda2")
			const primaryId = await createApp("alderspensjon-endringssoknad-frontend")
			await createEnvironment(primaryId, naisTeamId, "prod-gcp")
			const linkedId = await createApp("alderspensjon-endringssoknad-frontend-borger", primaryId)

			const result = await getNdaAppParams(linkedId)

			expect(result).toBeNull()
		})

		it("returns null when the application has no production environment and is not linked", async () => {
			const appId = await createApp("standalone-without-env")

			const result = await getNdaAppParams(appId)

			expect(result).toBeNull()
		})

		describe("getNdaAppParamsGroup", () => {
			it("returns only the primary's own params when a linked application has no environment of its own", async () => {
				const sectionId = await createSection("sec-nda-group1")
				const naisTeamId = await createNaisTeam(sectionId, "team-nda-group1")
				const primaryId = await createApp("alderspensjon-endringssoknad-frontend-group1")
				await createEnvironment(primaryId, naisTeamId, "prod-gcp")
				const linkedId = await createApp("alderspensjon-endringssoknad-frontend-borger-group1", primaryId)

				const result = await getNdaAppParamsGroup(linkedId)

				expect(result).toEqual([
					{
						applicationId: primaryId,
						team: "team-nda-group1",
						environment: "prod-gcp",
						appName: "alderspensjon-endringssoknad-frontend-group1",
						sectionId,
					},
				])
			})

			it("returns a separate entry per member when both the primary and a linked application have deployed independently", async () => {
				const sectionId = await createSection("sec-nda-group2")
				const naisTeamId = await createNaisTeam(sectionId, "team-nda-group2")
				const primaryId = await createApp("primary-with-own-deploy")
				await createEnvironment(primaryId, naisTeamId, "prod-gcp")
				const linkedId = await createApp("linked-with-own-deploy", primaryId)
				await createEnvironment(linkedId, naisTeamId, "prod-fss")

				const result = await getNdaAppParamsGroup(linkedId)

				expect(result).toEqual(
					expect.arrayContaining([
						{
							applicationId: primaryId,
							team: "team-nda-group2",
							environment: "prod-gcp",
							appName: "primary-with-own-deploy",
							sectionId,
						},
						{
							applicationId: linkedId,
							team: "team-nda-group2",
							environment: "prod-fss",
							appName: "linked-with-own-deploy",
							sectionId,
						},
					]),
				)
				expect(result).toHaveLength(2)
			})

			it("preserves each member's own sectionId, even when a linked application belongs to a different section than the primary", async () => {
				const primarySectionId = await createSection("sec-nda-group-primary")
				const primaryNaisTeamId = await createNaisTeam(primarySectionId, "team-nda-group-primary")
				const primaryId = await createApp("primary-cross-section")
				await createEnvironment(primaryId, primaryNaisTeamId, "prod-gcp")

				// Lenket app tilhører en ANNEN seksjon enn hovedapplikasjonen — linkApplication()
				// krever ikke delt seksjon/team, så dette er et gyldig (om enn uvanlig) oppsett.
				const linkedSectionId = await createSection("sec-nda-group-linked")
				const linkedNaisTeamId = await createNaisTeam(linkedSectionId, "team-nda-group-linked")
				const linkedId = await createApp("linked-cross-section", primaryId)
				await createEnvironment(linkedId, linkedNaisTeamId, "prod-fss")

				const result = await getNdaAppParamsGroup(primaryId)

				expect(result).toEqual(
					expect.arrayContaining([
						{
							applicationId: primaryId,
							team: "team-nda-group-primary",
							environment: "prod-gcp",
							appName: "primary-cross-section",
							sectionId: primarySectionId,
						},
						{
							applicationId: linkedId,
							team: "team-nda-group-linked",
							environment: "prod-fss",
							appName: "linked-cross-section",
							sectionId: linkedSectionId,
						},
					]),
				)
				expect(primarySectionId).not.toBe(linkedSectionId)
			})

			it("returns an empty array when neither the application nor its linked primary has a production environment", async () => {
				const primaryId = await createApp("primary-without-env-group")
				const linkedId = await createApp("linked-without-env-group", primaryId)

				const result = await getNdaAppParamsGroup(linkedId)

				expect(result).toEqual([])
			})

			it("returns a single entry for a standalone application with no linked apps", async () => {
				const sectionId = await createSection("sec-nda-group3")
				const naisTeamId = await createNaisTeam(sectionId, "team-nda-group3")
				const appId = await createApp("standalone-app-group3")
				await createEnvironment(appId, naisTeamId, "prod-gcp")

				const result = await getNdaAppParamsGroup(appId)

				expect(result).toEqual([
					{
						applicationId: appId,
						team: "team-nda-group3",
						environment: "prod-gcp",
						appName: "standalone-app-group3",
						sectionId,
					},
				])
			})

			it("excludes an archived linked application even if it still has a production environment", async () => {
				const sectionId = await createSection("sec-nda-group4")
				const naisTeamId = await createNaisTeam(sectionId, "team-nda-group4")
				const primaryId = await createApp("primary-with-archived-child")
				await createEnvironment(primaryId, naisTeamId, "prod-gcp")
				const archivedChildId = await createApp("archived-linked-app", primaryId)
				await createEnvironment(archivedChildId, naisTeamId, "prod-fss")
				await archiveApp(archivedChildId)

				const result = await getNdaAppParamsGroup(primaryId)

				expect(result).toEqual([
					{
						applicationId: primaryId,
						team: "team-nda-group4",
						environment: "prod-gcp",
						appName: "primary-with-archived-child",
						sectionId,
					},
				])
			})
		})
	})
})
