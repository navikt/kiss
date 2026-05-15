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

const { upsertAccessPolicyRulesForEnvironment, getAccessPolicyRules } = await import("~/db/queries/nais.server")

async function createTestApp(name: string) {
	const db = getTestDb()
	const result = await db.execute(
		/* sql */ `INSERT INTO monitored_applications (name, created_by, updated_by) VALUES ('${name}', 'test', 'test') RETURNING id`,
	)
	return (result.rows[0] as { id: string }).id
}

async function createTestEnvironment(appId: string, cluster: string, namespace: string) {
	const db = getTestDb()
	const result = await db.execute(
		/* sql */ `INSERT INTO application_environments (application_id, cluster, namespace) VALUES ('${appId}', '${cluster}', '${namespace}') RETURNING id`,
	)
	return (result.rows[0] as { id: string }).id
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

async function getAllEnvRules(appEnvId: string) {
	const db = getTestDb()
	const r = await db.execute(
		/* sql */ `SELECT id, direction, rule_application, rule_namespace, rule_cluster, archived_at, archived_by FROM application_environment_access_policy_rules WHERE application_environment_id = '${appEnvId}' ORDER BY discovered_at, id`,
	)
	return r.rows as Array<{
		id: string
		direction: string
		rule_application: string
		rule_namespace: string | null
		rule_cluster: string | null
		archived_at: unknown
		archived_by: string | null
	}>
}

describe("Access policy rules soft-delete integration tests (environment-based)", () => {
	beforeAll(async () => {
		await setupTestDatabase()
	}, 120_000)

	afterAll(async () => {
		await teardownTestDatabase()
	})

	beforeEach(async () => {
		const db = getTestDb()
		await db.execute(/* sql */ `
			DELETE FROM application_environment_access_policy_rules;
			DELETE FROM application_environments;
			DELETE FROM application_access_policy_fallback_cutovers;
			DELETE FROM monitored_applications;
			DELETE FROM audit_log;
		`)
	})

	it("inserts new rules and writes added-audit on first sync (environment-based)", async () => {
		const appId = await createTestApp("App A")
		const envId = await createTestEnvironment(appId, "prod-gcp", "team-a")
		await upsertAccessPolicyRulesForEnvironment(
			appId,
			envId,
			"inbound",
			[{ application: "frontend", namespace: "team-a", cluster: "prod-gcp" }, { application: "backend" }],
			"alice",
		)

		const active = await getAccessPolicyRules(appId)
		expect(active).toHaveLength(2)

		const audit = await getAuditByEntity("application", appId)
		const added = audit.filter((a) => a.action === "access_policy_rule_added")
		expect(added).toHaveLength(2)
		expect(added.every((a) => a.performed_by === "alice")).toBe(true)
		const removed = audit.filter((a) => a.action === "access_policy_rule_removed")
		expect(removed).toHaveLength(0)
	})

	it("archives rules that are no longer reported instead of hard-deleting them (environment-based)", async () => {
		const appId = await createTestApp("App B")
		const envId = await createTestEnvironment(appId, "prod-gcp", "team-a")
		await upsertAccessPolicyRulesForEnvironment(
			appId,
			envId,
			"inbound",
			[{ application: "frontend", namespace: "team-a", cluster: "prod-gcp" }, { application: "backend" }],
			"alice",
		)

		// Andre sync: backend forsvinner
		await upsertAccessPolicyRulesForEnvironment(
			appId,
			envId,
			"inbound",
			[{ application: "frontend", namespace: "team-a", cluster: "prod-gcp" }],
			"bob",
		)

		const active = await getAccessPolicyRules(appId)
		expect(active).toHaveLength(1)
		expect(active[0].ruleApplication).toBe("frontend")

		const all = await getAllEnvRules(envId)
		expect(all).toHaveLength(2)
		const archivedRow = all.find((r) => r.rule_application === "backend")
		expect(archivedRow?.archived_at).not.toBeNull()
		expect(archivedRow?.archived_by).toBe("bob")

		const audit = await getAuditByEntity("application", appId)
		const removed = audit.filter((a) => a.action === "access_policy_rule_removed")
		expect(removed).toHaveLength(1)
		expect(removed[0].performed_by).toBe("bob")
		expect(JSON.parse(removed[0].previous_value as string)).toMatchObject({
			direction: "inbound",
			ruleApplication: "backend",
		})
	})

	it("filters archived rows from getAccessPolicyRules (environment-based)", async () => {
		const appId = await createTestApp("App C")
		const envId = await createTestEnvironment(appId, "prod-gcp", "team-a")
		await upsertAccessPolicyRulesForEnvironment(appId, envId, "inbound", [{ application: "frontend" }], "alice")
		await upsertAccessPolicyRulesForEnvironment(appId, envId, "inbound", [], "alice")
		const active = await getAccessPolicyRules(appId)
		expect(active).toHaveLength(0)

		const all = await getAllEnvRules(envId)
		expect(all).toHaveLength(1)
		expect(all[0].archived_at).not.toBeNull()
	})

	it("re-adds a previously archived rule as a new active row (history preserved) (environment-based)", async () => {
		const appId = await createTestApp("App D")
		const envId = await createTestEnvironment(appId, "prod-gcp", "team-a")
		await upsertAccessPolicyRulesForEnvironment(appId, envId, "inbound", [{ application: "frontend" }], "alice")
		await upsertAccessPolicyRulesForEnvironment(appId, envId, "inbound", [], "alice")
		await upsertAccessPolicyRulesForEnvironment(appId, envId, "inbound", [{ application: "frontend" }], "alice")

		const active = await getAccessPolicyRules(appId)
		expect(active).toHaveLength(1)

		const all = await getAllEnvRules(envId)
		expect(all).toHaveLength(2)
		const archivedRow = all.find((r) => r.archived_at !== null)
		const activeRow = all.find((r) => r.archived_at === null)
		expect(archivedRow).toBeDefined()
		expect(activeRow).toBeDefined()
		expect(archivedRow?.id).not.toBe(activeRow?.id)
	})

	it("is idempotent on identical sync — no audit and no row changes (environment-based)", async () => {
		const appId = await createTestApp("App E")
		const envId = await createTestEnvironment(appId, "prod-gcp", "team-a")
		await upsertAccessPolicyRulesForEnvironment(
			appId,
			envId,
			"inbound",
			[{ application: "frontend", namespace: "team-a", cluster: "prod-gcp" }, { application: "backend" }],
			"alice",
		)
		const auditBefore = await getAuditByEntity("application", appId)
		const allBefore = await getAllEnvRules(envId)

		await upsertAccessPolicyRulesForEnvironment(
			appId,
			envId,
			"inbound",
			[{ application: "frontend", namespace: "team-a", cluster: "prod-gcp" }, { application: "backend" }],
			"alice",
		)
		const auditAfter = await getAuditByEntity("application", appId)
		const allAfter = await getAllEnvRules(envId)

		expect(auditAfter.length).toBe(auditBefore.length)
		expect(allAfter.length).toBe(allBefore.length)
		expect(allAfter.map((r) => r.id).sort()).toEqual(allBefore.map((r) => r.id).sort())
	})

	it("dedupes input rules so the same (app, namespace, cluster) is only inserted once (environment-based)", async () => {
		const appId = await createTestApp("App F")
		const envId = await createTestEnvironment(appId, "prod-gcp", "team-a")
		await upsertAccessPolicyRulesForEnvironment(
			appId,
			envId,
			"inbound",
			[
				{ application: "frontend", namespace: "team-a", cluster: "prod-gcp" },
				{ application: "frontend", namespace: "team-a", cluster: "prod-gcp" },
			],
			"alice",
		)
		const active = await getAccessPolicyRules(appId)
		expect(active).toHaveLength(1)

		const audit = await getAuditByEntity("application", appId)
		const added = audit.filter((a) => a.action === "access_policy_rule_added")
		expect(added).toHaveLength(1)
	})

	it("scopes diff to a single direction — outbound rules are unaffected by inbound sync (environment-based)", async () => {
		const appId = await createTestApp("App G")
		const envId = await createTestEnvironment(appId, "prod-gcp", "team-a")
		await upsertAccessPolicyRulesForEnvironment(appId, envId, "inbound", [{ application: "in-1" }], "alice")
		await upsertAccessPolicyRulesForEnvironment(appId, envId, "outbound", [{ application: "out-1" }], "alice")

		// Synkroniser inbound på nytt med tom liste — outbound skal ikke berøres
		await upsertAccessPolicyRulesForEnvironment(appId, envId, "inbound", [], "alice")

		const all = await getAllEnvRules(envId)
		const activeOutbound = all.filter((r) => r.direction === "outbound" && r.archived_at === null)
		expect(activeOutbound).toHaveLength(1)
		expect(activeOutbound[0].rule_application).toBe("out-1")

		const archivedInbound = all.filter((r) => r.direction === "inbound" && r.archived_at !== null)
		expect(archivedInbound).toHaveLength(1)
	})

	it("writes audit payloads with full rule context (environment-based)", async () => {
		const appId = await createTestApp("App H")
		const envId = await createTestEnvironment(appId, "prod-gcp", "team-a")
		await upsertAccessPolicyRulesForEnvironment(
			appId,
			envId,
			"outbound",
			[{ application: "downstream", namespace: "team-x", cluster: "prod-gcp" }],
			"alice",
		)

		const audit = await getAuditByEntity("application", appId)
		const added = audit.filter((a) => a.action === "access_policy_rule_added")
		expect(added).toHaveLength(1)
		const payload = JSON.parse(added[0].new_value as string)
		expect(payload).toEqual({
			direction: "outbound",
			ruleApplication: "downstream",
			ruleNamespace: "team-x",
			ruleCluster: "prod-gcp",
		})
	})

	it("transactional consistency — both diff and audit are committed together (environment-based)", async () => {
		const appId = await createTestApp("App I")
		const envId = await createTestEnvironment(appId, "prod-gcp", "team-a")
		await upsertAccessPolicyRulesForEnvironment(appId, envId, "inbound", [{ application: "frontend" }], "alice")
		await upsertAccessPolicyRulesForEnvironment(appId, envId, "inbound", [{ application: "backend" }], "bob")

		const all = await getAllEnvRules(envId)
		expect(all).toHaveLength(2)

		const audit = await getAuditByEntity("application", appId)
		const added = audit.filter((a) => a.action === "access_policy_rule_added")
		const removed = audit.filter((a) => a.action === "access_policy_rule_removed")
		expect(added).toHaveLength(2)
		expect(removed).toHaveLength(1)
	})
})
