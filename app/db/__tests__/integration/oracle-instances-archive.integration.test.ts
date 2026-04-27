import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { getTestDb, setupTestDatabase, teardownTestDatabase } from "./setup"

vi.mock("~/db/connection.server", () => ({
	get db() {
		return getTestDb()
	},
	get pool() {
		return null
	},
}))

const { configureOracleInstance, getOracleInstancesForApp, removeOracleInstance, setIncludeInReport } = await import(
	"~/db/queries/audit-evidence.server"
)
const { isInstanceLinkedToApp } = await import("~/db/queries/oracle-roles.server")

function unwrap<T>(value: T | null | undefined, label: string): T {
	if (value == null) throw new Error(`Expected ${label} to be non-null`)
	return value
}

async function createTestApp(name: string) {
	const db = getTestDb()
	const result = await db.execute(
		/* sql */ `INSERT INTO monitored_applications (name, created_by, updated_by) VALUES ('${name}', 'test', 'test') RETURNING id`,
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

describe("Oracle instances soft-delete integration tests", () => {
	beforeAll(async () => {
		await setupTestDatabase()
	}, 120_000)

	afterAll(async () => {
		await teardownTestDatabase()
	})

	beforeEach(async () => {
		const db = getTestDb()
		await db.execute(/* sql */ `
			DELETE FROM persistence_audit_confirmations;
			DELETE FROM persistence_audit_summaries;
			DELETE FROM application_persistence;
			DELETE FROM application_oracle_instances;
			DELETE FROM monitored_applications;
			DELETE FROM audit_log;
		`)
	})

	it("archives an Oracle instance instead of hard-deleting it", async () => {
		const appId = await createTestApp("App A")
		const added = unwrap(await configureOracleInstance(appId, "ORA-1", "creator"), "added")

		const archived = unwrap(await removeOracleInstance(appId, "ORA-1", "remover"), "archived")
		expect(archived.archivedAt).not.toBeNull()
		expect(archived.archivedBy).toBe("remover")

		const db = getTestDb()
		const stillThere = await db.execute(
			/* sql */ `SELECT id, archived_at FROM application_oracle_instances WHERE id = '${added.id}'`,
		)
		expect(stillThere.rows).toHaveLength(1)
		expect((stillThere.rows[0] as { archived_at: unknown }).archived_at).not.toBeNull()
	})

	it("excludes archived rows from getOracleInstancesForApp", async () => {
		const appId = await createTestApp("App B")
		await configureOracleInstance(appId, "ORA-1", "creator")
		await configureOracleInstance(appId, "ORA-2", "creator")
		await removeOracleInstance(appId, "ORA-1", "remover")

		const active = await getOracleInstancesForApp(appId)
		expect(active).toHaveLength(1)
		expect(active[0].instanceId).toBe("ORA-2")
	})

	it("isInstanceLinkedToApp returns false for archived instance", async () => {
		const appId = await createTestApp("App C")
		await configureOracleInstance(appId, "ORA-1", "creator")
		expect(await isInstanceLinkedToApp(appId, "ORA-1")).toBe(true)

		await removeOracleInstance(appId, "ORA-1", "remover")
		expect(await isInstanceLinkedToApp(appId, "ORA-1")).toBe(false)
	})

	it("allows re-configuring a previously archived instance as a new active row", async () => {
		const appId = await createTestApp("App D")
		const first = unwrap(await configureOracleInstance(appId, "ORA-1", "creator"), "first")
		await removeOracleInstance(appId, "ORA-1", "remover")

		const second = unwrap(await configureOracleInstance(appId, "ORA-1", "creator2"), "second")
		expect(second.id).not.toBe(first.id)

		const db = getTestDb()
		const all = await db.execute(
			/* sql */ `SELECT id, archived_at FROM application_oracle_instances WHERE application_id = '${appId}' ORDER BY configured_at`,
		)
		expect(all.rows).toHaveLength(2)
		const archivedRow = all.rows.find((r) => (r as { id: string }).id === first.id) as
			| { archived_at: unknown }
			| undefined
		const activeRow = all.rows.find((r) => (r as { id: string }).id === second.id) as
			| { archived_at: unknown }
			| undefined
		expect(archivedRow?.archived_at).not.toBeNull()
		expect(activeRow?.archived_at).toBeNull()

		const active = await getOracleInstancesForApp(appId)
		expect(active).toHaveLength(1)
		expect(active[0].id).toBe(second.id)
	})

	it("partial unique index prevents two active rows for same (app, instance)", async () => {
		const appId = await createTestApp("App E")
		const first = unwrap(await configureOracleInstance(appId, "ORA-X", "creator"), "first")

		// Idempotent no-op — returnerer eksisterende rad
		const dup = await configureOracleInstance(appId, "ORA-X", "creator")
		expect(dup).not.toBeNull()
		expect(dup?.id).toBe(first.id)

		const db = getTestDb()
		const rows = await db.execute(
			/* sql */ `SELECT COUNT(*)::int AS c FROM application_oracle_instances WHERE application_id = '${appId}' AND archived_at IS NULL`,
		)
		expect((rows.rows[0] as { c: number }).c).toBe(1)
	})

	it("removeOracleInstance is idempotent — calling it twice on same row only logs once", async () => {
		const appId = await createTestApp("App F")
		await configureOracleInstance(appId, "ORA-1", "creator")

		const first = await removeOracleInstance(appId, "ORA-1", "remover")
		expect(first).not.toBeNull()

		const second = await removeOracleInstance(appId, "ORA-1", "remover2")
		expect(second).toBeNull()

		const audit = await getAuditByEntity("application", appId)
		const removedEntries = audit.filter((a) => a.action === "oracle_instance_removed")
		expect(removedEntries).toHaveLength(1)
		expect(removedEntries[0].performed_by).toBe("remover")
	})

	it("writes audit log entries on configure and remove with correct payloads", async () => {
		const appId = await createTestApp("App G")
		await configureOracleInstance(appId, "ORA-42", "creator")
		await removeOracleInstance(appId, "ORA-42", "remover")

		const audit = await getAuditByEntity("application", appId)
		const oracleEntries = audit.filter(
			(a) => a.action === "oracle_instance_configured" || a.action === "oracle_instance_removed",
		)
		expect(oracleEntries).toHaveLength(2)
		expect(oracleEntries[0].action).toBe("oracle_instance_configured")
		expect(oracleEntries[0].new_value).toBe(JSON.stringify({ instanceId: "ORA-42" }))
		expect(oracleEntries[0].performed_by).toBe("creator")

		expect(oracleEntries[1].action).toBe("oracle_instance_removed")
		expect(oracleEntries[1].previous_value).toBe(JSON.stringify({ instanceId: "ORA-42" }))
		expect(oracleEntries[1].performed_by).toBe("remover")
	})

	it("does not write audit on no-op duplicate configure", async () => {
		const appId = await createTestApp("App H")
		await configureOracleInstance(appId, "ORA-1", "creator")
		await configureOracleInstance(appId, "ORA-1", "creator")

		const audit = await getAuditByEntity("application", appId)
		const configuredEntries = audit.filter((a) => a.action === "oracle_instance_configured")
		expect(configuredEntries).toHaveLength(1)
	})

	it("setIncludeInReport does not modify archived rows", async () => {
		const appId = await createTestApp("App I")
		await configureOracleInstance(appId, "ORA-1", "creator")
		await removeOracleInstance(appId, "ORA-1", "remover")

		// Forsøk på å endre includeInReport på arkivert rad — skal være no-op
		await setIncludeInReport(appId, "ORA-1", false)

		const db = getTestDb()
		const rows = await db.execute(
			/* sql */ `SELECT include_in_report, archived_at FROM application_oracle_instances WHERE application_id = '${appId}'`,
		)
		expect(rows.rows).toHaveLength(1)
		// Original verdi (true, default) skal være beholdt
		expect((rows.rows[0] as { include_in_report: boolean }).include_in_report).toBe(true)
		expect((rows.rows[0] as { archived_at: unknown }).archived_at).not.toBeNull()
	})

	it("transactional atomicity — both row update and audit log committed together", async () => {
		const appId = await createTestApp("App J")
		const added = unwrap(await configureOracleInstance(appId, "ORA-1", "creator"), "added")

		// Verifiser at både rad og audit er på plass etter configure
		const auditAfterAdd = await getAuditByEntity("application", appId)
		const configEntries = auditAfterAdd.filter((a) => a.action === "oracle_instance_configured")
		expect(configEntries).toHaveLength(1)

		// Arkiver, og verifiser at både archived_at og audit er på plass
		await removeOracleInstance(appId, "ORA-1", "remover")
		const db = getTestDb()
		const afterRemove = await db.execute(
			/* sql */ `SELECT archived_at FROM application_oracle_instances WHERE id = '${added.id}'`,
		)
		expect((afterRemove.rows[0] as { archived_at: unknown }).archived_at).not.toBeNull()

		const auditAfterRemove = await getAuditByEntity("application", appId)
		const removedEntries = auditAfterRemove.filter((a) => a.action === "oracle_instance_removed")
		expect(removedEntries).toHaveLength(1)
	})
})
