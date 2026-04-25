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

const {
	addManualPersistence,
	archiveManualPersistence,
	deleteManualPersistence,
	getAppPersistence,
	getAppsPersistence,
	linkPersistenceToOracleInstance,
	unarchiveManualPersistence,
	updatePersistenceClassification,
	upsertAppPersistence,
} = await import("~/db/queries/nais.server")
const { ensureOraclePersistenceEntries } = await import("~/db/queries/audit-logging.server")

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
		/* sql */ `SELECT action, previous_value, new_value, performed_by, metadata FROM audit_log WHERE entity_type = '${entityType}' AND entity_id = '${entityId}' ORDER BY performed_at, action`,
	)
	return r.rows as Array<{
		action: string
		previous_value: string | null
		new_value: string | null
		performed_by: string
		metadata: unknown
	}>
}

describe("Application persistence archive (soft-delete) integration tests", () => {
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
			DELETE FROM monitored_applications;
			DELETE FROM audit_log;
		`)
	})

	it("archives a manually added persistence row instead of deleting it", async () => {
		const appId = await createTestApp("App A")
		const row = await addManualPersistence(appId, "cloud_sql_postgres", "kunde-db", "critical", "creator")

		const archived = await archiveManualPersistence(row.id, "archiver")
		expect(archived.archivedAt).not.toBeNull()
		expect(archived.archivedBy).toBe("archiver")

		const db = getTestDb()
		const stillThere = await db.execute(
			/* sql */ `SELECT id, archived_at FROM application_persistence WHERE id = '${row.id}'`,
		)
		expect(stillThere.rows).toHaveLength(1)
		expect(stillThere.rows[0].archived_at).not.toBeNull()

		const audit = await getAuditByEntity("application_persistence", row.id)
		expect(audit.find((a) => a.action === "persistence_archived")?.performed_by).toBe("archiver")
	})

	it("excludes archived rows from getAppPersistence by default and includes them with includeArchived", async () => {
		const appId = await createTestApp("App B")
		const a = await addManualPersistence(appId, "cloud_sql_postgres", "active", null, "u")
		const b = await addManualPersistence(appId, "cloud_sql_postgres", "old", null, "u")
		await archiveManualPersistence(b.id, "u")

		const active = await getAppPersistence(appId)
		expect(active.map((p) => p.id)).toEqual([a.id])

		const all = await getAppPersistence(appId, { includeArchived: true })
		expect(all.map((p) => p.id).sort()).toEqual([a.id, b.id].sort())
	})

	it("excludes archived rows from getAppsPersistence (batch) by default", async () => {
		const app1 = await createTestApp("App C1")
		const app2 = await createTestApp("App C2")
		const r1 = await addManualPersistence(app1, "bucket", "topic-active", null, "u")
		const r2 = await addManualPersistence(app2, "bucket", "topic-archived", null, "u")
		await archiveManualPersistence(r2.id, "u")

		const map = await getAppsPersistence([app1, app2])
		expect(map.get(app1)?.map((p) => p.id)).toEqual([r1.id])
		expect(map.get(app2) ?? []).toEqual([])

		const allMap = await getAppsPersistence([app1, app2], { includeArchived: true })
		expect(allMap.get(app2)?.map((p) => p.id)).toEqual([r2.id])
	})

	it("rejects archive of non-manual (Nais-discovered) persistence rows", async () => {
		const appId = await createTestApp("App D")
		await upsertAppPersistence(appId, "cloud_sql_postgres", "auto-discovered")
		const [row] = await getAppPersistence(appId)

		await expect(archiveManualPersistence(row.id, "admin")).rejects.toThrow(/manuelt/)

		const audit = await getAuditByEntity("application_persistence", row.id)
		expect(audit.find((a) => a.action === "persistence_archived")).toBeUndefined()
	})

	it("addManualPersistence rejects when an active row with same (appId, type, name) already exists", async () => {
		const appId = await createTestApp("App P")
		await addManualPersistence(appId, "bucket", "konflikt", null, "u")
		await expect(addManualPersistence(appId, "bucket", "konflikt", null, "u")).rejects.toThrow(/finnes allerede/i)
	})

	it("addManualPersistence rejects when an auto-detektert (Nais) aktiv rad finnes med samme (appId, type, name)", async () => {
		const appId = await createTestApp("App Q")
		await upsertAppPersistence(appId, "oracle", "auto-konflikt")
		await expect(addManualPersistence(appId, "oracle", "auto-konflikt", null, "u")).rejects.toThrow(/finnes allerede/i)
	})

	it("addManualPersistence reaktiverer en arkivert non-manual (Nais) rad og setter manuallyAdded=true", async () => {
		const appId = await createTestApp("App R")
		await upsertAppPersistence(appId, "oracle", "auto-arkiv")
		const [auto] = await getAppPersistence(appId)
		expect(auto.manuallyAdded).toBe(false)

		const db = getTestDb()
		await db.execute(/* sql */ `UPDATE application_persistence SET archived_at = now() WHERE id = '${auto.id}'`)

		const readded = await addManualPersistence(appId, "oracle", "auto-arkiv", "critical", "manual-user")
		expect(readded.id).toBe(auto.id)
		expect(readded.manuallyAdded).toBe(true)
		expect(readded.archivedAt).toBeNull()
		expect(readded.dataClassification).toBe("critical")

		const audit = await getAuditByEntity("application_persistence", auto.id)
		const unarchive = audit.find((a) => a.action === "persistence_unarchived")
		expect(unarchive?.performed_by).toBe("manual-user")
		const metadata = JSON.parse((unarchive?.metadata as string | null) ?? "{}")
		expect(metadata.reason).toBe("manual_re_add")
	})

	it("reactivates an archived manual persistence row", async () => {
		const appId = await createTestApp("App E")
		const row = await addManualPersistence(appId, "bucket", "events", null, "u")
		await archiveManualPersistence(row.id, "admin")

		const restored = await unarchiveManualPersistence(row.id, "reactivator")
		expect(restored.archivedAt).toBeNull()
		expect(restored.archivedBy).toBeNull()

		const audit = await getAuditByEntity("application_persistence", row.id)
		expect(audit.find((a) => a.action === "persistence_unarchived")?.performed_by).toBe("reactivator")
	})

	it("archive is idempotent: second call returns existing row without writing extra audit", async () => {
		const appId = await createTestApp("App F")
		const row = await addManualPersistence(appId, "bucket", "idem", null, "u")
		await archiveManualPersistence(row.id, "first")
		await archiveManualPersistence(row.id, "second")

		const audit = await getAuditByEntity("application_persistence", row.id)
		const entries = audit.filter((a) => a.action === "persistence_archived")
		expect(entries).toHaveLength(1)
		expect(entries[0].performed_by).toBe("first")
	})

	it("unarchive is idempotent", async () => {
		const appId = await createTestApp("App G")
		const row = await addManualPersistence(appId, "bucket", "idem-un", null, "u")
		await archiveManualPersistence(row.id, "u")
		await unarchiveManualPersistence(row.id, "first")
		await unarchiveManualPersistence(row.id, "second")

		const audit = await getAuditByEntity("application_persistence", row.id)
		const entries = audit.filter((a) => a.action === "persistence_unarchived")
		expect(entries).toHaveLength(1)
		expect(entries[0].performed_by).toBe("first")
	})

	it("rejects updatePersistenceClassification on archived rows", async () => {
		const appId = await createTestApp("App H")
		const row = await addManualPersistence(appId, "bucket", "frozen", null, "u")
		await archiveManualPersistence(row.id, "u")

		await expect(updatePersistenceClassification(row.id, "critical", "u")).rejects.toThrow(/arkivert/)
	})

	it("rejects linkPersistenceToOracleInstance on archived rows", async () => {
		const appId = await createTestApp("App I")
		await upsertAppPersistence(appId, "oracle", "instance-1")
		const [row] = await getAppPersistence(appId)
		// Direkte arkivering via SQL (non-manual rader kan ikke arkiveres via API, men databasen tillater det)
		const db = getTestDb()
		await db.execute(/* sql */ `UPDATE application_persistence SET archived_at = now() WHERE id = '${row.id}'`)

		await expect(linkPersistenceToOracleInstance(row.id, "instance-2")).rejects.toMatchObject({
			status: 403,
		})
	})

	it("upsertAppPersistence auto-unarchives an archived row when Nais re-discovers it", async () => {
		const appId = await createTestApp("App J")
		await upsertAppPersistence(appId, "cloud_sql_postgres", "resync-db")
		const [row] = await getAppPersistence(appId)

		const db = getTestDb()
		await db.execute(
			/* sql */ `UPDATE application_persistence SET archived_at = now(), archived_by = 'admin' WHERE id = '${row.id}'`,
		)

		const wasNew = await upsertAppPersistence(appId, "cloud_sql_postgres", "resync-db", { tier: "premium" })
		expect(wasNew).toBe(false)

		const after = await getAppPersistence(appId)
		expect(after).toHaveLength(1)
		expect(after[0].id).toBe(row.id)
		expect(after[0].archivedAt).toBeNull()
		expect(after[0].tier).toBe("premium")

		const audit = await getAuditByEntity("application_persistence", row.id)
		const unarchive = audit.find((a) => a.action === "persistence_unarchived")
		expect(unarchive?.performed_by).toBe("nais-sync")
	})

	it("addManualPersistence reactivates an archived manual row instead of creating a duplicate", async () => {
		const appId = await createTestApp("App K")
		const original = await addManualPersistence(appId, "bucket", "manual-readd", "critical", "u")
		await archiveManualPersistence(original.id, "u")

		const readded = await addManualPersistence(appId, "bucket", "manual-readd", "not_critical", "creator")
		expect(readded.id).toBe(original.id)
		expect(readded.archivedAt).toBeNull()
		expect(readded.dataClassification).toBe("not_critical")

		const all = await getAppPersistence(appId, { includeArchived: true })
		expect(all).toHaveLength(1)

		const audit = await getAuditByEntity("application_persistence", original.id)
		const unarchives = audit.filter((a) => a.action === "persistence_unarchived")
		expect(unarchives).toHaveLength(1)
		expect(unarchives[0].performed_by).toBe("creator")
	})

	it("ensureOraclePersistenceEntries reactivates an archived oracle row instead of creating a duplicate", async () => {
		const appId = await createTestApp("App L")
		await upsertAppPersistence(appId, "oracle", "ora-1")
		const [row] = await getAppPersistence(appId)
		const db = getTestDb()
		await db.execute(/* sql */ `UPDATE application_persistence SET archived_at = now() WHERE id = '${row.id}'`)

		const result = await ensureOraclePersistenceEntries(appId, ["ora-1"], "ensure-caller")
		expect(result).toHaveLength(1)
		expect(result[0].id).toBe(row.id)
		expect(result[0].archivedAt).toBeNull()

		const all = await getAppPersistence(appId, { includeArchived: true })
		expect(all).toHaveLength(1)

		const audit = await getAuditByEntity("application_persistence", row.id)
		const unarchive = audit.find((a) => a.action === "persistence_unarchived")
		expect(unarchive?.performed_by).toBe("ensure-caller")
		const metadata = JSON.parse((unarchive?.metadata as string | null) ?? "{}")
		expect(metadata.reason).toBe("oracle_instance_ensure")
	})

	it("ensureOraclePersistenceEntries prefers an existing active row over an archived duplicate", async () => {
		const appId = await createTestApp("App L2")
		const db = getTestDb()
		// Lag eldre arkivert duplikat først, deretter en nyere aktiv rad
		const archivedRow = await db.execute(
			/* sql */ `INSERT INTO application_persistence (application_id, type, name, archived_at)
				VALUES ('${appId}', 'oracle', 'ora-dupe', now() - interval '1 day') RETURNING id`,
		)
		const archivedId = (archivedRow.rows[0] as { id: string }).id
		const activeRow = await db.execute(
			/* sql */ `INSERT INTO application_persistence (application_id, type, name)
				VALUES ('${appId}', 'oracle', 'ora-dupe') RETURNING id`,
		)
		const activeId = (activeRow.rows[0] as { id: string }).id

		const result = await ensureOraclePersistenceEntries(appId, ["ora-dupe"], "tester")
		// Skal ikke endre noe (en aktiv rad finnes allerede)
		expect(result).toEqual([])

		const stillArchived = await db.execute(
			/* sql */ `SELECT archived_at FROM application_persistence WHERE id = '${archivedId}'`,
		)
		expect(stillArchived.rows[0].archived_at).not.toBeNull()

		const stillActive = await db.execute(
			/* sql */ `SELECT archived_at FROM application_persistence WHERE id = '${activeId}'`,
		)
		expect(stillActive.rows[0].archived_at).toBeNull()

		// Ingen audit skal skrives når ingen rad endres
		const audit = await getAuditByEntity("application_persistence", archivedId)
		expect(audit.find((a) => a.action === "persistence_unarchived")).toBeUndefined()
	})

	it("partial unique index blocks two active rows with same (appId, type, name) but allows archive+reinsert", async () => {
		const appId = await createTestApp("App O")
		const db = getTestDb()
		await db.execute(
			/* sql */ `INSERT INTO application_persistence (application_id, type, name) VALUES ('${appId}', 'oracle', 'ora-uniq')`,
		)

		await expect(
			db.execute(
				/* sql */ `INSERT INTO application_persistence (application_id, type, name) VALUES ('${appId}', 'oracle', 'ora-uniq')`,
			),
		).rejects.toThrow()

		// Etter arkivering skal ny aktiv rad være lov.
		await db.execute(
			/* sql */ `UPDATE application_persistence SET archived_at = now() WHERE application_id = '${appId}' AND archived_at IS NULL`,
		)
		await expect(
			db.execute(
				/* sql */ `INSERT INTO application_persistence (application_id, type, name) VALUES ('${appId}', 'oracle', 'ora-uniq')`,
			),
		).resolves.toBeDefined()
	})

	it("deleteManualPersistence is a deprecated alias for archive (does not hard-delete)", async () => {
		const appId = await createTestApp("App M")
		const row = await addManualPersistence(appId, "bucket", "legacy", null, "u")

		await deleteManualPersistence(row.id, "legacy-caller")

		const db = getTestDb()
		const stillThere = await db.execute(
			/* sql */ `SELECT id, archived_at FROM application_persistence WHERE id = '${row.id}'`,
		)
		expect(stillThere.rows).toHaveLength(1)
		expect(stillThere.rows[0].archived_at).not.toBeNull()

		const audit = await getAuditByEntity("application_persistence", row.id)
		expect(audit.find((a) => a.action === "persistence_archived")?.performed_by).toBe("legacy-caller")
	})

	it("preserves persistence_audit_summaries FK when archiving (would block hard DELETE)", async () => {
		const appId = await createTestApp("App N")
		const row = await addManualPersistence(appId, "oracle", "ora-with-audit", null, "u")
		const db = getTestDb()
		await db.execute(/* sql */ `INSERT INTO persistence_audit_summaries
			(persistence_id, conclusion, fetched_at, created_by, updated_by)
			VALUES ('${row.id}', 'FULLSTENDIG', now(), 'sync', 'sync')`)

		const archived = await archiveManualPersistence(row.id, "admin")
		expect(archived.archivedAt).not.toBeNull()

		const summaryRow = await db.execute(
			/* sql */ `SELECT persistence_id FROM persistence_audit_summaries WHERE persistence_id = '${row.id}'`,
		)
		expect(summaryRow.rows).toHaveLength(1)
	})
})
