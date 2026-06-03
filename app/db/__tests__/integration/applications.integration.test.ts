import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { ParsedFramework } from "~/lib/excel-parser.server"
import { getTestDb, getTestPool, setupTestDatabase, teardownTestDatabase, truncateWithRetry } from "./setup"

vi.mock("~/db/connection.server", () => ({
	get db() {
		return getTestDb()
	},
	get pool() {
		return getTestPool()
	},
}))

const { stageFrameworkImport, applyFrameworkImport } = await import("~/db/queries/framework.server")
const {
	getApplications,
	getApplicationsForSection,
	getTeamMembersForApp,
	linkAppToTeam,
	searchApplications,
	unlinkAppFromTeam,
} = await import("~/db/queries/applications.server")
const { syncApplicationControls } = await import("~/db/queries/application-controls.server")
const { archiveTeam } = await import("~/db/queries/sections.server")
const { assignRole } = await import("~/db/queries/users.server")

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
async function createTestApp(name: string, addedManually = false) {
	const db = getTestDb()
	const result = await db.execute(
		/* sql */ `
		INSERT INTO monitored_applications (name, added_manually, created_by, updated_by)
		VALUES ('${name}', ${addedManually}, 'test', 'test')
		RETURNING id
	`,
	)
	return (result.rows[0] as { id: string }).id
}

/** Create a nais team and return its id. */
async function createTestNaisTeam(slug: string, sectionId: string) {
	const db = getTestDb()
	const result = await db.execute(
		/* sql */ `
		INSERT INTO nais_teams (slug, section_id)
		VALUES ('${slug}', '${sectionId}')
		RETURNING id
	`,
	)
	return (result.rows[0] as { id: string }).id
}

async function createAppEnvironment(appId: string, naisTeamId: string, cluster: string, namespace: string) {
	const db = getTestDb()
	await db.execute(
		/* sql */ `
		INSERT INTO application_environments (application_id, nais_team_id, cluster, namespace)
		VALUES ('${appId}', '${naisTeamId}', '${cluster}', '${namespace}')
	`,
	)
}

describe("Applications integration tests", () => {
	beforeAll(async () => {
		await setupTestDatabase()
	})

	afterAll(async () => {
		await teardownTestDatabase()
	})

	beforeEach(async () => {
		await truncateWithRetry([
			"compliance_assessment_history",
			"compliance_assessments",
			"application_control_history",
			"application_controls",
			"dev_team_nais_team_mappings",
			"application_team_mappings",
			"application_environments",
			"section_environments",
			"section_ignored_applications",
			"monitored_applications",
			"nais_teams",
			"framework_field_history",
			"control_technology_elements",
			"framework_risk_control_mappings",
			"framework_controls",
			"framework_risks",
			"framework_domains",
			"framework_versions",
			"user_roles",
			"dev_teams",
			"clusters",
			"sections",
			"audit_log",
		])
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
			/* sql */ `SELECT * FROM application_team_mappings WHERE application_id = '${appId}' AND archived_at IS NULL`,
		)
		expect(mappings.rows).toHaveLength(0)

		// Verify both link and unlink audit logs
		const auditResult = await db.execute(/* sql */ `SELECT * FROM audit_log ORDER BY performed_at`)
		const actions = (auditResult.rows as Array<{ action: string }>).map((r) => r.action)
		expect(actions).toContain("app_team_linked")
		expect(actions).toContain("app_team_unlinked")
	})

	it("should reject linking an application to an archived dev team", async () => {
		const sectionId = await createTestSection("IT", "it-section")
		const teamId = await createTestDevTeam("Backend Team", "backend", sectionId)
		const appId = await createTestApp("App One")

		await archiveTeam(teamId, "admin")

		await expect(linkAppToTeam(appId, teamId, "admin")).rejects.toThrow(/arkivert/i)

		const db = getTestDb()
		const mappings = await db.execute(
			/* sql */ `SELECT * FROM application_team_mappings WHERE application_id = '${appId}'`,
		)
		expect(mappings.rows).toHaveLength(0)
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

		// Sync materializes expected assessment rows into application_controls
		await syncApplicationControls(appId)

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

	it("should return compliance fields from getApplicationsForSection", async () => {
		const sectionId = await createTestSection("Compliance Section", "compliance-section")
		const teamId = await createTestDevTeam("Comp Team", "comp-team", sectionId)
		const appId = await createTestApp("Section Compliance App")
		await linkAppToTeam(appId, teamId, "admin")

		// Set up framework
		const parsed = makeParsedFramework()
		const versionId = await stageFrameworkImport(parsed, "fw.xlsx", "user", "/uploads/fw.xlsx")
		await applyFrameworkImport(versionId, parsed, "admin")

		// Sync materializes application_controls rows
		await syncApplicationControls(appId)

		const apps = await getApplicationsForSection(sectionId)
		expect(apps.length).toBeGreaterThanOrEqual(1)

		const app = apps.find((a) => a.id === appId)
		expect(app).toBeDefined()
		expect(app?.name).toBe("Section Compliance App")
		expect(app?.controlsTotal).toBe(1)
		expect(app?.controlsImplemented).toBe(0)
		expect(app?.controlsNotImplemented).toBeTypeOf("number")
		expect(app?.controlsNotRelevant).toBeTypeOf("number")
		expect(app?.controlsPartial).toBeTypeOf("number")
	})

	it("searchApplications excludes apps with only excluded environments, but keeps manually added apps", async () => {
		const db = getTestDb()
		const sectionId = await createTestSection("Search Section", "search-section")
		const naisTeamId = await createTestNaisTeam("search-team", sectionId)

		const activeAppId = await createTestApp("search-active-app")
		await createAppEnvironment(activeAppId, naisTeamId, "prod-gcp", "ns-prod")

		const excludedAppId = await createTestApp("search-excluded-app")
		await createAppEnvironment(excludedAppId, naisTeamId, "dev-fss", "ns-dev")

		const manualAppId = await createTestApp("search-manual-app", true)

		await db.execute(
			/* sql */ `
			INSERT INTO section_environments (section_id, cluster, included, added_by, updated_by)
			VALUES ('${sectionId}', 'dev-fss', false, 'test', 'test')
		`,
		)

		const results = await searchApplications("search", 50)
		const ids = results.map((app) => app.id)

		expect(ids).toContain(activeAppId)
		expect(ids).toContain(manualAppId)
		expect(ids).not.toContain(excludedAppId)
	})

	describe("getTeamMembersForApp", () => {
		it("returns members from teams linked to the app", async () => {
			const sectionId = await createTestSection("Pensjon", "pensjon")
			const teamId = await createTestDevTeam("Starte pensjon", "starte-pensjon", sectionId)
			const appId = await createTestApp("pensjon-sak")
			await linkAppToTeam(appId, teamId, "test")
			await assignRole("Z990001", "Glad Fjord", "developer", "test", undefined, teamId)
			await assignRole("Z990002", "Modig Bjørk", "tech_lead", "test", undefined, teamId)

			const result = await getTeamMembersForApp(appId)

			expect(result).toHaveLength(1)
			expect(result[0].teamName).toBe("Starte pensjon")
			const idents = result[0].members.map((m) => m.navIdent)
			expect(idents).toContain("Z990001")
			expect(idents).toContain("Z990002")
		})

		it("deduplicates members that appear in multiple teams — member only counted in first team", async () => {
			const sectionId = await createTestSection("Pensjon Dedup", "pensjon-dedup")
			const team1Id = await createTestDevTeam("Team A", "team-a", sectionId)
			const team2Id = await createTestDevTeam("Team B", "team-b", sectionId)
			const appId = await createTestApp("pensjon-dedup-app")
			await linkAppToTeam(appId, team1Id, "test")
			await linkAppToTeam(appId, team2Id, "test")
			// Same user in both teams
			await assignRole("Z990010", "Rask Elv", "developer", "test", undefined, team1Id)
			await assignRole("Z990010", "Rask Elv", "developer", "test", undefined, team2Id)
			await assignRole("Z990011", "Stille Skog", "developer", "test", undefined, team2Id)

			const result = await getTeamMembersForApp(appId)

			const allMembers = result.flatMap((t) => t.members)
			const z990010Entries = allMembers.filter((m) => m.navIdent === "Z990010")
			expect(z990010Entries).toHaveLength(1)

			// Team with only Z990010 (already deduped) must not appear as empty group
			const emptyTeams = result.filter((t) => t.members.length === 0)
			expect(emptyTeams).toHaveLength(0)

			expect(allMembers).toHaveLength(2)
		})

		it("excludes members from archived teams", async () => {
			const sectionId = await createTestSection("Pensjon Arkiv", "pensjon-arkiv")
			const activeTeamId = await createTestDevTeam("Aktiv team", "aktiv-team", sectionId)
			const archivedTeamId = await createTestDevTeam("Arkivert team", "arkivert-team", sectionId)
			const appId = await createTestApp("pensjon-arkiv-app")
			await linkAppToTeam(appId, activeTeamId, "test")
			await linkAppToTeam(appId, archivedTeamId, "test")
			await assignRole("Z990020", "Varm Solstråle", "developer", "test", undefined, activeTeamId)
			await assignRole("Z990021", "Klok Ugle", "developer", "test", undefined, archivedTeamId)
			await archiveTeam(archivedTeamId, "test")

			const result = await getTeamMembersForApp(appId)

			const allIdents = result.flatMap((t) => t.members.map((m) => m.navIdent))
			expect(allIdents).toContain("Z990020")
			expect(allIdents).not.toContain("Z990021")
		})

		it("excludes members with archived roles", async () => {
			const db = getTestDb()
			const sectionId = await createTestSection("Pensjon Roller", "pensjon-roller")
			const teamId = await createTestDevTeam("Rolle team", "rolle-team", sectionId)
			const appId = await createTestApp("pensjon-roller-app")
			await linkAppToTeam(appId, teamId, "test")
			const roleId = await assignRole("Z990030", "Frisk Bekk", "developer", "test", undefined, teamId)
			await assignRole("Z990031", "Rolig Dal", "developer", "test", undefined, teamId)
			// Archive one role directly
			await db.execute(
				/* sql */ `UPDATE user_roles SET archived_at = NOW(), archived_by = 'test' WHERE id = '${roleId}'`,
			)

			const result = await getTeamMembersForApp(appId)

			const allIdents = result.flatMap((t) => t.members.map((m) => m.navIdent))
			expect(allIdents).not.toContain("Z990030")
			expect(allIdents).toContain("Z990031")
		})

		it("returns empty array when app has no team mappings", async () => {
			const appId = await createTestApp("app-uten-team")

			const result = await getTeamMembersForApp(appId)

			expect(result).toHaveLength(0)
		})
	})
})
