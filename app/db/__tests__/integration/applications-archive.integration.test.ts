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

const { archiveApplication, unarchiveApplication } = await import("~/db/queries/nais.server")
const { getApplications, getAvailableAppsForTeam } = await import("~/db/queries/applications.server")

async function getAuditByEntity(entityType: string, entityId: string) {
	const db = getTestDb()
	const r = await db.execute(
		/* sql */ `SELECT action, previous_value, new_value, performed_by FROM audit_log WHERE entity_type = '${entityType}' AND entity_id = '${entityId}' ORDER BY performed_at`,
	)
	return r.rows as Array<{
		action: string
		previous_value: string | null
		new_value: string | null
		performed_by: string
	}>
}

async function createTestApp(name: string, opts: { withEnvironment?: boolean; primaryAppId?: string } = {}) {
	const db = getTestDb()
	const insertCols = opts.primaryAppId
		? `(name, primary_application_id, created_by, updated_by) VALUES ('${name}', '${opts.primaryAppId}', 'test', 'test')`
		: `(name, created_by, updated_by) VALUES ('${name}', 'test', 'test')`
	const result = await db.execute(/* sql */ `INSERT INTO monitored_applications ${insertCols} RETURNING id`)
	const appId = (result.rows[0] as { id: string }).id

	if (opts.withEnvironment) {
		await db.execute(
			/* sql */ `INSERT INTO application_environments (application_id, cluster, namespace) VALUES ('${appId}', 'dev-gcp', 'team-x')`,
		)
	}
	return appId
}

describe("Application archive (soft-delete) integration tests", () => {
	beforeAll(async () => {
		await setupTestDatabase()
	}, 120_000)

	afterAll(async () => {
		await teardownTestDatabase()
	})

	beforeEach(async () => {
		const db = getTestDb()
		await db.execute(/* sql */ `
			DELETE FROM application_controls;
			DELETE FROM application_technology_elements;
			DELETE FROM screening_routine_selections;
			DELETE FROM screening_answers;
			DELETE FROM compliance_assessment_history;
			DELETE FROM compliance_assessments;
			DELETE FROM application_team_mappings;
			DELETE FROM application_environments;
			DELETE FROM application_persistence;
			DELETE FROM monitored_applications;
			DELETE FROM dev_team_nais_team_mappings;
			DELETE FROM nais_teams;
			DELETE FROM section_environments;
			DELETE FROM dev_teams;
			DELETE FROM sections;
			DELETE FROM audit_log;
		`)
	})

	it("archives an application instead of deleting it (soft-delete)", async () => {
		const appId = await createTestApp("Phantom App")
		const archived = await archiveApplication(appId, "archiver")

		expect(archived.archivedAt).not.toBeNull()
		expect(archived.archivedBy).toBe("archiver")

		const db = getTestDb()
		const row = await db.execute(
			/* sql */ `SELECT id, archived_at, archived_by FROM monitored_applications WHERE id = '${appId}'`,
		)
		expect(row.rows).toHaveLength(1)
		expect(row.rows[0].archived_at).not.toBeNull()

		const audit = await getAuditByEntity("monitored_application", appId)
		expect(audit.find((a) => a.action === "application_archived")?.performed_by).toBe("archiver")
	})

	it("excludes archived applications from getApplications() by default", async () => {
		const active = await createTestApp("Active App")
		const toArchive = await createTestApp("Archived App")
		await archiveApplication(toArchive, "admin")

		const apps = await getApplications()
		const ids = apps.map((a) => a.id)
		expect(ids).toContain(active)
		expect(ids).not.toContain(toArchive)
	})

	it("excludes archived applications from getAvailableAppsForTeam()", async () => {
		const db = getTestDb()
		const sectionRow = await db.execute(
			/* sql */ `INSERT INTO sections (name, slug, created_by, updated_by) VALUES ('Sec', 'sec', 'test', 'test') RETURNING id`,
		)
		const sectionId = (sectionRow.rows[0] as { id: string }).id
		const teamRow = await db.execute(
			/* sql */ `INSERT INTO dev_teams (name, slug, section_id, created_by, updated_by) VALUES ('Team', 'team', '${sectionId}', 'test', 'test') RETURNING id`,
		)
		const teamId = (teamRow.rows[0] as { id: string }).id

		// Set up nais team linked to section with an active cluster
		const naisTeamRow = await db.execute(
			/* sql */ `INSERT INTO nais_teams (slug, section_id) VALUES ('test-nais-team', '${sectionId}') RETURNING id`,
		)
		const naisTeamId = (naisTeamRow.rows[0] as { id: string }).id
		await db.execute(
			/* sql */ `INSERT INTO section_environments (section_id, cluster, included, added_by, updated_by) VALUES ('${sectionId}', 'prod-gcp', true, 'test', 'test')`,
		)

		// Active app with an environment in the section's nais team and active cluster
		const active = await createTestApp("Available App")
		await db.execute(
			/* sql */ `INSERT INTO application_environments (application_id, cluster, namespace, nais_team_id) VALUES ('${active}', 'prod-gcp', 'test-nais-team', '${naisTeamId}')`,
		)

		// Archived app (no environments, so archiveApplication succeeds)
		const archived = await createTestApp("Archived App")
		await archiveApplication(archived, "admin")

		const apps = await getAvailableAppsForTeam(teamId, sectionId)
		const ids = apps.map((a) => a.id)
		expect(ids).toContain(active)
		expect(ids).not.toContain(archived)
	})

	it("excludes apps whose only environment is in a non-included cluster from getAvailableAppsForTeam()", async () => {
		const db = getTestDb()
		const sectionRow = await db.execute(
			/* sql */ `INSERT INTO sections (name, slug, created_by, updated_by) VALUES ('Sec2', 'sec2', 'test', 'test') RETURNING id`,
		)
		const sectionId = (sectionRow.rows[0] as { id: string }).id
		const teamRow = await db.execute(
			/* sql */ `INSERT INTO dev_teams (name, slug, section_id, created_by, updated_by) VALUES ('Team2', 'team2', '${sectionId}', 'test', 'test') RETURNING id`,
		)
		const teamId = (teamRow.rows[0] as { id: string }).id

		const naisTeamRow = await db.execute(
			/* sql */ `INSERT INTO nais_teams (slug, section_id) VALUES ('nais-team-2', '${sectionId}') RETURNING id`,
		)
		const naisTeamId = (naisTeamRow.rows[0] as { id: string }).id

		// prod-gcp is active, dev-gcp is NOT included — ensures the filter is tested against
		// the actual cluster match, not an empty section_environments table (which would be a false positive)
		await db.execute(/* sql */ `
			INSERT INTO section_environments (section_id, cluster, included, added_by, updated_by) VALUES
				('${sectionId}', 'prod-gcp', true, 'test', 'test'),
				('${sectionId}', 'dev-gcp', false, 'test', 'test')
		`)

		// App only in the non-included cluster (dev-gcp) — should be excluded
		const excludedEnvApp = await createTestApp("Excluded Cluster App")
		await db.execute(
			/* sql */ `INSERT INTO application_environments (application_id, cluster, namespace, nais_team_id) VALUES ('${excludedEnvApp}', 'dev-gcp', 'nais-team-2', '${naisTeamId}')`,
		)

		// App in the active cluster (prod-gcp) — should appear to confirm the filter works selectively
		const activeEnvApp = await createTestApp("Active Cluster App")
		await db.execute(
			/* sql */ `INSERT INTO application_environments (application_id, cluster, namespace, nais_team_id) VALUES ('${activeEnvApp}', 'prod-gcp', 'nais-team-2', '${naisTeamId}')`,
		)

		const apps = await getAvailableAppsForTeam(teamId, sectionId)
		const ids = apps.map((a) => a.id)
		expect(ids).toContain(activeEnvApp)
		expect(ids).not.toContain(excludedEnvApp)
	})

	it("excludes apps belonging to a nais team in a different section from getAvailableAppsForTeam()", async () => {
		const db = getTestDb()

		// Section A — the section we're querying for
		const secARow = await db.execute(
			/* sql */ `INSERT INTO sections (name, slug, created_by, updated_by) VALUES ('SecA', 'sec-a', 'test', 'test') RETURNING id`,
		)
		const sectionAId = (secARow.rows[0] as { id: string }).id
		const teamRow = await db.execute(
			/* sql */ `INSERT INTO dev_teams (name, slug, section_id, created_by, updated_by) VALUES ('TeamA', 'team-a', '${sectionAId}', 'test', 'test') RETURNING id`,
		)
		const teamId = (teamRow.rows[0] as { id: string }).id
		const naisTeamARow = await db.execute(
			/* sql */ `INSERT INTO nais_teams (slug, section_id) VALUES ('nais-team-a', '${sectionAId}') RETURNING id`,
		)
		const naisTeamAId = (naisTeamARow.rows[0] as { id: string }).id
		await db.execute(
			/* sql */ `INSERT INTO section_environments (section_id, cluster, included, added_by, updated_by) VALUES ('${sectionAId}', 'prod-gcp', true, 'test', 'test')`,
		)

		// Section B — a separate section with its own nais team
		const secBRow = await db.execute(
			/* sql */ `INSERT INTO sections (name, slug, created_by, updated_by) VALUES ('SecB', 'sec-b', 'test', 'test') RETURNING id`,
		)
		const sectionBId = (secBRow.rows[0] as { id: string }).id
		const naisTeamBRow = await db.execute(
			/* sql */ `INSERT INTO nais_teams (slug, section_id) VALUES ('nais-team-b', '${sectionBId}') RETURNING id`,
		)
		const naisTeamBId = (naisTeamBRow.rows[0] as { id: string }).id
		await db.execute(
			/* sql */ `INSERT INTO section_environments (section_id, cluster, included, added_by, updated_by) VALUES ('${sectionBId}', 'prod-gcp', true, 'test', 'test')`,
		)

		// App in section A's nais team → should appear
		const appInSectionA = await createTestApp("App in Section A")
		await db.execute(
			/* sql */ `INSERT INTO application_environments (application_id, cluster, namespace, nais_team_id) VALUES ('${appInSectionA}', 'prod-gcp', 'nais-team-a', '${naisTeamAId}')`,
		)

		// App only in section B's nais team → should NOT appear when querying for section A
		const appInSectionB = await createTestApp("App in Section B")
		await db.execute(
			/* sql */ `INSERT INTO application_environments (application_id, cluster, namespace, nais_team_id) VALUES ('${appInSectionB}', 'prod-gcp', 'nais-team-b', '${naisTeamBId}')`,
		)

		const apps = await getAvailableAppsForTeam(teamId, sectionAId)
		const ids = apps.map((a) => a.id)
		expect(ids).toContain(appInSectionA)
		expect(ids).not.toContain(appInSectionB)
	})

	it("reactivates an archived application", async () => {
		const appId = await createTestApp("Returning App")
		await archiveApplication(appId, "admin")
		const reactivated = await unarchiveApplication(appId, "reactivator")

		expect(reactivated.archivedAt).toBeNull()
		expect(reactivated.archivedBy).toBeNull()

		const audit = await getAuditByEntity("monitored_application", appId)
		expect(audit.find((a) => a.action === "application_unarchived")?.performed_by).toBe("reactivator")
	})

	it("rejects archive when application has Nais environments", async () => {
		const appId = await createTestApp("Live App", { withEnvironment: true })
		await expect(archiveApplication(appId, "admin")).rejects.toThrow(/Nais/)

		const db = getTestDb()
		const row = await db.execute(/* sql */ `SELECT archived_at FROM monitored_applications WHERE id = '${appId}'`)
		expect(row.rows[0].archived_at).toBeNull()
	})

	it("allows archive when all environments are in excluded clusters", async () => {
		const db = getTestDb()
		// Create section with excluded cluster
		const sectionRow = await db.execute(
			/* sql */ `INSERT INTO sections (name, slug, created_by, updated_by) VALUES ('ExclSec', 'excl-sec', 'test', 'test') RETURNING id`,
		)
		const sectionId = (sectionRow.rows[0] as { id: string }).id
		await db.execute(
			/* sql */ `INSERT INTO section_environments (section_id, cluster, included, added_by, updated_by) VALUES ('${sectionId}', 'dev-gcp', false, 'test', 'test')`,
		)
		// Create nais team in that section
		const teamRow = await db.execute(
			/* sql */ `INSERT INTO nais_teams (slug, section_id) VALUES ('excluded-team', '${sectionId}') RETURNING id`,
		)
		const naisTeamId = (teamRow.rows[0] as { id: string }).id
		// Create app with environment in the excluded cluster
		const appId = await createTestApp("Excluded Env App")
		await db.execute(
			/* sql */ `INSERT INTO application_environments (application_id, cluster, namespace, nais_team_id) VALUES ('${appId}', 'dev-gcp', 'excluded-team', '${naisTeamId}')`,
		)

		const archived = await archiveApplication(appId, "admin")
		expect(archived.archivedAt).not.toBeNull()
	})

	it("rejects archive when application has linked (child) apps", async () => {
		const primary = await createTestApp("Primary")
		await createTestApp("Child", { primaryAppId: primary })

		await expect(archiveApplication(primary, "admin")).rejects.toThrow(/lenkede/)

		const db = getTestDb()
		const row = await db.execute(/* sql */ `SELECT archived_at FROM monitored_applications WHERE id = '${primary}'`)
		expect(row.rows[0].archived_at).toBeNull()
	})

	it("archive is idempotent: second call returns existing row without writing extra audit", async () => {
		const appId = await createTestApp("Idempotent App")
		await archiveApplication(appId, "first")
		await archiveApplication(appId, "second")

		const audit = await getAuditByEntity("monitored_application", appId)
		const archiveEntries = audit.filter((a) => a.action === "application_archived")
		expect(archiveEntries).toHaveLength(1)
		expect(archiveEntries[0].performed_by).toBe("first")
	})

	it("unarchive is idempotent: second call returns existing row without writing extra audit", async () => {
		const appId = await createTestApp("Idempotent Unarchive")
		await archiveApplication(appId, "admin")
		await unarchiveApplication(appId, "first")
		await unarchiveApplication(appId, "second")

		const audit = await getAuditByEntity("monitored_application", appId)
		const unarchiveEntries = audit.filter((a) => a.action === "application_unarchived")
		expect(unarchiveEntries).toHaveLength(1)
		expect(unarchiveEntries[0].performed_by).toBe("first")
	})

	it("throws when archiving a non-existent application", async () => {
		await expect(archiveApplication("00000000-0000-0000-0000-000000000000", "admin")).rejects.toThrow(/ikke funnet/)
	})

	it("throws when unarchiving a non-existent application", async () => {
		await expect(unarchiveApplication("00000000-0000-0000-0000-000000000000", "admin")).rejects.toThrow(/ikke funnet/)
	})

	describe("FK RESTRICT enforcement", () => {
		it("rejects raw DELETE of application referenced by application_environments", async () => {
			const appId = await createTestApp("Live", { withEnvironment: true })
			const db = getTestDb()
			await expect(db.execute(/* sql */ `DELETE FROM monitored_applications WHERE id = '${appId}'`)).rejects.toThrow()
		})

		it("rejects raw DELETE of application referenced by application_persistence", async () => {
			const db = getTestDb()
			const appId = await createTestApp("With Persistence")
			await db.execute(
				/* sql */ `INSERT INTO application_persistence (application_id, type, name)
					VALUES ('${appId}', 'cloud_sql_postgres', 'mydb')`,
			)

			await expect(db.execute(/* sql */ `DELETE FROM monitored_applications WHERE id = '${appId}'`)).rejects.toThrow()

			const stillThere = await db.execute(/* sql */ `SELECT id FROM monitored_applications WHERE id = '${appId}'`)
			expect(stillThere.rows).toHaveLength(1)
		})

		it("rejects raw DELETE of application referenced by application_team_mappings", async () => {
			const db = getTestDb()
			const appId = await createTestApp("With Team")
			const sectionRow = await db.execute(
				/* sql */ `INSERT INTO sections (name, slug, created_by, updated_by) VALUES ('Sec', 'sec-fk', 'test', 'test') RETURNING id`,
			)
			const sectionId = (sectionRow.rows[0] as { id: string }).id
			const teamRow = await db.execute(
				/* sql */ `INSERT INTO dev_teams (name, slug, section_id, created_by, updated_by) VALUES ('Team', 'team-fk', '${sectionId}', 'test', 'test') RETURNING id`,
			)
			const teamId = (teamRow.rows[0] as { id: string }).id
			await db.execute(
				/* sql */ `INSERT INTO application_team_mappings (application_id, dev_team_id, created_by) VALUES ('${appId}', '${teamId}', 'test')`,
			)

			await expect(db.execute(/* sql */ `DELETE FROM monitored_applications WHERE id = '${appId}'`)).rejects.toThrow()
		})

		it("rejects raw DELETE of primary application referenced by linked child app (self-FK RESTRICT)", async () => {
			const db = getTestDb()
			const primaryId = await createTestApp("Primary self-fk")
			await createTestApp("Child self-fk", { primaryAppId: primaryId })

			await expect(
				db.execute(/* sql */ `DELETE FROM monitored_applications WHERE id = '${primaryId}'`),
			).rejects.toThrow()

			const stillThere = await db.execute(/* sql */ `SELECT id FROM monitored_applications WHERE id = '${primaryId}'`)
			expect(stillThere.rows).toHaveLength(1)
		})
	})

	describe("Audit log captures pre-update state on unarchive", () => {
		it("records the actual archivedAt timestamp in previousValue", async () => {
			const appId = await createTestApp("Unarchive audit app")
			await archiveApplication(appId, "user-a")
			await unarchiveApplication(appId, "user-b")

			const audit = await getAuditByEntity("monitored_application", appId)
			const unarchiveEntry = audit.find((e) => e.action === "application_unarchived")
			expect(unarchiveEntry).toBeDefined()
			const prev = JSON.parse(unarchiveEntry?.previous_value ?? "{}")
			// previousValue must contain the actual archivedAt timestamp, not null
			expect(prev.archivedAt).toBeTruthy()
			expect(prev.archivedAt).not.toBeNull()
			const newVal = JSON.parse(unarchiveEntry?.new_value ?? "{}")
			expect(newVal.archivedAt).toBeUndefined()
			expect(unarchiveEntry?.performed_by).toBe("user-b")
		})
	})
})
