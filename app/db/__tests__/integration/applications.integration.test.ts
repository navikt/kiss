import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { ParsedFramework } from "~/lib/excel-parser.server"
import { getTestDb, setupTestDatabase, teardownTestDatabase } from "./setup"

vi.mock("~/db/connection.server", () => ({
	get db() {
		return getTestDb()
	},
	get pool() {
		return null
	},
}))

const { stageFrameworkImport, applyFrameworkImport } = await import("~/db/queries/framework.server")
const { getApplications, linkAppToTeam, unlinkAppFromTeam } = await import("~/db/queries/applications.server")

function makeParsedFramework(): ParsedFramework {
	return {
		sheetName: "Rammeverk",
		rows: [
			{
				domain: "Teknisk sikkerhet",
				riskId: "R-TS.01",
				riskDescription: "Uautorisert tilgang",
				controlId: "K-TS.01",
				technologyElement: "Identitetsstyring",
				requirement: "MFA",
				responsible: "IT",
				routine: "Kvartalsvis",
				frequency: "Kvartalsvis",
				documentationRequirement: "Logg",
				testProcedure: "Test",
				dependencies: null,
				references: null,
				commonPitfalls: null,
			},
		],
	}
}

/** Create a section and return its id. */
async function createTestSection(name: string, slug: string) {
	const db = getTestDb()
	const result = await db.execute(
		/* sql */ `
		INSERT INTO sections (name, slug, created_by, updated_by)
		VALUES ('${name}', '${slug}', 'test', 'test')
		RETURNING id
	`,
	)
	return (result.rows[0] as { id: string }).id
}

/** Create a dev team and return its id. */
async function createTestDevTeam(name: string, slug: string, sectionId: string) {
	const db = getTestDb()
	const result = await db.execute(
		/* sql */ `
		INSERT INTO dev_teams (name, slug, section_id, created_by, updated_by)
		VALUES ('${name}', '${slug}', '${sectionId}', 'test', 'test')
		RETURNING id
	`,
	)
	return (result.rows[0] as { id: string }).id
}

/** Create a monitored application and return its id. */
async function createTestApp(name: string) {
	const db = getTestDb()
	const result = await db.execute(
		/* sql */ `
		INSERT INTO monitored_applications (name, created_by, updated_by)
		VALUES ('${name}', 'test', 'test')
		RETURNING id
	`,
	)
	return (result.rows[0] as { id: string }).id
}

describe("Applications integration tests", () => {
	beforeAll(async () => {
		await setupTestDatabase()
	})

	afterAll(async () => {
		await teardownTestDatabase()
	})

	beforeEach(async () => {
		const db = getTestDb()
		await db.execute(
			/* sql */ `
			DELETE FROM compliance_assessment_history;
			DELETE FROM compliance_assessments;
			DELETE FROM application_team_mappings;
			DELETE FROM application_environments;
			DELETE FROM monitored_applications;
			DELETE FROM nais_teams;
			DELETE FROM framework_field_history;
			DELETE FROM framework_risk_control_mappings;
			DELETE FROM framework_controls;
			DELETE FROM framework_risks;
			DELETE FROM framework_domains;
			DELETE FROM framework_versions;
			DELETE FROM user_roles;
			DELETE FROM dev_teams;
			DELETE FROM clusters;
			DELETE FROM sections;
			DELETE FROM audit_log;
		`,
		)
	})

	it("should create a monitored application", async () => {
		const db = getTestDb()
		const appId = await createTestApp("My Test App")

		const result = await db.execute(/* sql */ `SELECT * FROM monitored_applications WHERE id = '${appId}'`)
		expect(result.rows).toHaveLength(1)

		const row = result.rows[0] as Record<string, unknown>
		expect(row.name).toBe("My Test App")
		expect(row.created_by).toBe("test")
	})

	it("should link an application to a dev team", async () => {
		const sectionId = await createTestSection("IT", "it-section")
		const teamId = await createTestDevTeam("Backend Team", "backend", sectionId)
		const appId = await createTestApp("App One")

		const mapping = await linkAppToTeam(appId, teamId, "admin")

		expect(mapping).toBeDefined()
		expect(mapping.applicationId).toBe(appId)
		expect(mapping.devTeamId).toBe(teamId)

		// Verify audit log was written
		const db = getTestDb()
		const auditResult = await db.execute(/* sql */ `SELECT * FROM audit_log WHERE action = 'app_team_linked'`)
		expect(auditResult.rows).toHaveLength(1)
	})

	it("should unlink an application from a dev team", async () => {
		const db = getTestDb()
		const sectionId = await createTestSection("IT", "it-section")
		const teamId = await createTestDevTeam("Backend Team", "backend", sectionId)
		const appId = await createTestApp("App One")

		await linkAppToTeam(appId, teamId, "admin")
		await unlinkAppFromTeam(appId, teamId, "admin")

		const mappings = await db.execute(
			/* sql */ `SELECT * FROM application_team_mappings WHERE application_id = '${appId}'`,
		)
		expect(mappings.rows).toHaveLength(0)

		// Verify both link and unlink audit logs
		const auditResult = await db.execute(/* sql */ `SELECT * FROM audit_log ORDER BY performed_at`)
		const actions = (auditResult.rows as Array<{ action: string }>).map((r) => r.action)
		expect(actions).toContain("app_team_linked")
		expect(actions).toContain("app_team_unlinked")
	})

	it("should return applications with compliance summary from getApplications", async () => {
		const sectionId = await createTestSection("IT", "it-section")
		const teamId = await createTestDevTeam("Backend Team", "backend", sectionId)

		const appId = await createTestApp("App With Team")
		await linkAppToTeam(appId, teamId, "admin")

		// Set up a framework so compliance counts work
		const parsed = makeParsedFramework()
		const versionId = await stageFrameworkImport(parsed, "fw.xlsx", "user", "/uploads/fw.xlsx")
		await applyFrameworkImport(versionId, parsed, "admin")

		const apps = await getApplications()
		expect(apps.length).toBeGreaterThanOrEqual(1)

		const app = apps.find((a) => a.id === appId)
		expect(app).toBeDefined()
		expect(app?.name).toBe("App With Team")
		expect(app?.teams).toContain("backend")
		expect(app?.controlsTotal).toBe(1)
		expect(app?.controlsImplemented).toBe(0)
	})

	it("should return applications without teams correctly", async () => {
		await createTestApp("Lonely App")

		// Set up a framework
		const parsed = makeParsedFramework()
		const versionId = await stageFrameworkImport(parsed, "fw.xlsx", "user", "/uploads/fw.xlsx")
		await applyFrameworkImport(versionId, parsed, "admin")

		const apps = await getApplications()
		const app = apps.find((a) => a.name === "Lonely App")
		expect(app).toBeDefined()
		expect(app?.teams).toEqual([])
	})

	it("should link multiple teams to the same application", async () => {
		const sectionId = await createTestSection("IT", "it-section")
		const team1Id = await createTestDevTeam("Team Alpha", "alpha", sectionId)
		const team2Id = await createTestDevTeam("Team Beta", "beta", sectionId)
		const appId = await createTestApp("Multi-Team App")

		await linkAppToTeam(appId, team1Id, "admin")
		await linkAppToTeam(appId, team2Id, "admin")

		// Set up framework for getApplications
		const parsed = makeParsedFramework()
		const versionId = await stageFrameworkImport(parsed, "fw.xlsx", "user", "/uploads/fw.xlsx")
		await applyFrameworkImport(versionId, parsed, "admin")

		const apps = await getApplications()
		const app = apps.find((a) => a.id === appId)
		expect(app?.teams.sort()).toEqual(["alpha", "beta"])
	})
})
