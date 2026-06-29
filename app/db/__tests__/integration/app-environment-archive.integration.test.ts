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

const { archiveStaleAppEnvironments, upsertAppEnvironment, getApplicationDetail } = await import(
	"~/db/queries/nais.server"
)

async function createTestApp(name: string) {
	const db = getTestDb()
	const result = await db.execute(
		/* sql */ `INSERT INTO monitored_applications (name, created_by, updated_by) VALUES ('${name}', 'test', 'test') RETURNING id`,
	)
	return (result.rows[0] as { id: string }).id
}

async function createTestNaisTeam(slug: string) {
	const db = getTestDb()
	const result = await db.execute(
		/* sql */ `INSERT INTO nais_teams (slug, status) VALUES ('${slug}', 'monitored') RETURNING id`,
	)
	return (result.rows[0] as { id: string }).id
}

async function createTestEnvironment(appId: string, cluster: string, namespace: string, naisTeamId: string) {
	const db = getTestDb()
	const result = await db.execute(
		/* sql */ `INSERT INTO application_environments (application_id, cluster, namespace, nais_team_id) VALUES ('${appId}', '${cluster}', '${namespace}', '${naisTeamId}') RETURNING id`,
	)
	return (result.rows[0] as { id: string }).id
}

async function getEnvRow(envId: string) {
	const db = getTestDb()
	const r = await db.execute(
		/* sql */ `SELECT id, cluster, namespace, archived_at, archived_by FROM application_environments WHERE id = '${envId}'`,
	)
	return r.rows[0] as {
		id: string
		cluster: string
		namespace: string
		archived_at: unknown
		archived_by: string | null
	}
}

async function getAuditByEntity(entityType: string, entityId: string) {
	const db = getTestDb()
	const r = await db.execute(
		/* sql */ `SELECT action, previous_value, new_value, performed_by FROM audit_log WHERE entity_type = '${entityType}' AND entity_id = '${entityId}' ORDER BY performed_at, action`,
	)
	return r.rows as Array<{
		action: string
		previous_value: string | null
		new_value: string | null
		performed_by: string
	}>
}

describe("App environment archive integration tests", () => {
	beforeAll(async () => {
		await setupTestDatabase()
	}, 120_000)

	afterAll(async () => {
		await teardownTestDatabase()
	})

	beforeEach(async () => {
		const db = getTestDb()
		await db.execute(/* sql */ `
			DELETE FROM audit_log;
			DELETE FROM application_environment_access_policy_rules;
			DELETE FROM application_environments;
			DELETE FROM application_technology_elements;
			DELETE FROM application_team_mappings;
			DELETE FROM application_persistence;
			DELETE FROM monitored_applications;
			DELETE FROM nais_teams;
		`)
	})

	it("arkiverer stale miljø og skriver audit-logg", async () => {
		const teamId = await createTestNaisTeam("glad-fjord")
		const appId = await createTestApp("Glad Fjord App")
		const envId = await createTestEnvironment(appId, "dev-gcp", "glad-fjord", teamId)

		await archiveStaleAppEnvironments(appId, teamId, [], "Z990001")

		const env = await getEnvRow(envId)
		expect(env.archived_at).not.toBeNull()
		expect(env.archived_by).toBe("Z990001")

		const audit = await getAuditByEntity("application_environment", envId)
		expect(audit).toHaveLength(1)
		expect(audit[0].action).toBe("app_environment_archived")
		expect(audit[0].performed_by).toBe("Z990001")
		expect(audit[0].previous_value).not.toBeNull()
		const prev = JSON.parse(audit[0].previous_value as string)
		expect(prev.cluster).toBe("dev-gcp")
		expect(prev.namespace).toBe("glad-fjord")
	})

	it("arkiverer ikke miljø som er i seenEnvironmentIds", async () => {
		const teamId = await createTestNaisTeam("rask-elv")
		const appId = await createTestApp("Rask Elv App")
		const keepId = await createTestEnvironment(appId, "dev-gcp", "rask-elv", teamId)
		const staleId = await createTestEnvironment(appId, "prod-gcp", "rask-elv", teamId)

		await archiveStaleAppEnvironments(appId, teamId, [keepId], "nais-sync")

		const kept = await getEnvRow(keepId)
		const stale = await getEnvRow(staleId)
		expect(kept.archived_at).toBeNull()
		expect(stale.archived_at).not.toBeNull()
	})

	it("reaktiverer arkivert miljø ved ny sync og skriver audit-logg", async () => {
		const teamId = await createTestNaisTeam("sterk-skog")
		const appId = await createTestApp("Sterk Skog App")

		// Opprett og arkiver miljøet manuelt
		const envId = await createTestEnvironment(appId, "dev-gcp", "sterk-skog", teamId)
		await archiveStaleAppEnvironments(appId, teamId, [], "nais-sync")
		const archived = await getEnvRow(envId)
		expect(archived.archived_at).not.toBeNull()

		// Reaktiver via upsertAppEnvironment (simulerer at appen dukker opp igjen i sync)
		await upsertAppEnvironment(appId, "dev-gcp", "sterk-skog", teamId)

		const reactivated = await getEnvRow(envId)
		expect(reactivated.archived_at).toBeNull()
		expect(reactivated.archived_by).toBeNull()

		const audit = await getAuditByEntity("application_environment", envId)
		expect(audit.map((a) => a.action)).toContain("app_environment_reactivated")
		const reactAudit = audit.find((a) => a.action === "app_environment_reactivated")
		expect(reactAudit).toBeDefined()
		expect(reactAudit?.performed_by).toBe("nais-sync")
	})

	it("getApplicationDetail ekskluderer arkiverte miljøer", async () => {
		const teamId = await createTestNaisTeam("blid-fjell")
		const appId = await createTestApp("Blid Fjell App")
		const activeId = await createTestEnvironment(appId, "dev-gcp", "blid-fjell", teamId)
		const staleId = await createTestEnvironment(appId, "prod-gcp", "blid-fjell", teamId)

		// Arkiver prod-miljøet direkte via SQL
		const db = getTestDb()
		await db.execute(
			/* sql */ `UPDATE application_environments SET archived_at = NOW(), archived_by = 'nais-sync' WHERE id = '${staleId}'`,
		)

		const detail = await getApplicationDetail(appId)
		expect(detail).not.toBeNull()
		const envIds = detail?.environments.map((e) => e.id)
		expect(envIds).not.toContain(staleId)
		expect(envIds).toContain(activeId)
		expect(detail?.environments).toHaveLength(1)
		expect(detail?.environments[0].cluster).toBe("dev-gcp")
	})
})
