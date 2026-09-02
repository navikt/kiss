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

const {
	addManualPersistence,
	archiveManualPersistence,
	countRemainingLegacyPersistenceDuplicates,
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

		const result = await ensureOraclePersistenceEntries(appId, ["ora-dupe"], "Z990001")
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

	it("upsertAppPersistence backfiller cluster på en legacy-rad (cluster=NULL) i stedet for å opprette en ny rad", async () => {
		const appId = await createTestApp("App O1")
		await upsertAppPersistence(appId, "cloud_sql_postgres", "legacy-db")
		const [legacyRow] = await getAppPersistence(appId)
		expect(legacyRow.cluster).toBeNull()

		const wasNew = await upsertAppPersistence(appId, "cloud_sql_postgres", "legacy-db", {
			cluster: "prod-gcp",
			tier: "premium",
		})
		expect(wasNew).toBe(false)

		const rows = await getAppPersistence(appId)
		expect(rows).toHaveLength(1)
		expect(rows[0].id).toBe(legacyRow.id)
		expect(rows[0].cluster).toBe("prod-gcp")
		expect(rows[0].tier).toBe("premium")

		const audit = await getAuditByEntity("application_persistence", legacyRow.id)
		const updated = audit.find((a) => a.action === "persistence_updated")
		expect(updated?.performed_by).toBe("nais-sync")
		const newValue = JSON.parse((updated?.new_value as string | null) ?? "{}")
		expect(newValue.cluster).toBe("prod-gcp")
		expect(newValue.tier).toBe("premium")
		const metadata = JSON.parse((updated?.metadata as string | null) ?? "{}")
		expect(metadata.reason).toBe("cluster_backfilled_by_nais_sync")
	})

	it("upsertAppPersistence selvhelbreder allerede-dupliserte apper: arkiverer legacy-rad og flytter revisjonsdata til kanonisk rad", async () => {
		const appId = await createTestApp("App O2")
		const db = getTestDb()

		const legacyResult = await db.execute(
			/* sql */ `INSERT INTO application_persistence
				(application_id, type, name, data_classification, oracle_instance_id)
				VALUES ('${appId}', 'oracle', 'dup-ora', 'critical', 'ORA123') RETURNING id`,
		)
		const legacyId = (legacyResult.rows[0] as { id: string }).id
		await db.execute(/* sql */ `INSERT INTO persistence_audit_summaries
			(persistence_id, conclusion, fetched_at, created_by, updated_by)
			VALUES ('${legacyId}', 'FULLSTENDIG', now(), 'sync', 'sync')`)

		const canonicalResult = await db.execute(
			/* sql */ `INSERT INTO application_persistence
				(application_id, type, name, cluster)
				VALUES ('${appId}', 'oracle', 'dup-ora', 'prod-gcp') RETURNING id`,
		)
		const canonicalId = (canonicalResult.rows[0] as { id: string }).id

		const wasNew = await upsertAppPersistence(appId, "oracle", "dup-ora", { cluster: "prod-gcp", tier: "premium" })
		expect(wasNew).toBe(false)

		const active = await getAppPersistence(appId)
		expect(active.map((p) => p.id)).toEqual([canonicalId])
		expect(active[0].dataClassification).toBe("critical")
		expect(active[0].oracleInstanceId).toBe("ORA123")
		expect(active[0].tier).toBe("premium")

		const all = await getAppPersistence(appId, { includeArchived: true })
		const archivedLegacy = all.find((p) => p.id === legacyId)
		expect(archivedLegacy?.archivedAt).not.toBeNull()
		expect(archivedLegacy?.archivedBy).toBe("nais-sync")

		const movedSummary = await db.execute(
			/* sql */ `SELECT persistence_id FROM persistence_audit_summaries WHERE persistence_id = '${canonicalId}'`,
		)
		expect(movedSummary.rows).toHaveLength(1)

		const audit = await getAuditByEntity("application_persistence", legacyId)
		const archived = audit.find((a) => a.action === "persistence_archived")
		expect(archived?.performed_by).toBe("nais-sync")
		const metadata = JSON.parse((archived?.metadata as string | null) ?? "{}")
		expect(metadata.reason).toBe("deduplicated_legacy_row")
	})

	it("countRemainingLegacyPersistenceDuplicates teller aktive legacy/kanonisk-par og går til 0 etter opprydding", async () => {
		const appId = await createTestApp("App O3")
		const db = getTestDb()

		const before = await countRemainingLegacyPersistenceDuplicates()

		await db.execute(
			/* sql */ `INSERT INTO application_persistence (application_id, type, name)
				VALUES ('${appId}', 'oracle', 'countable-dup')`,
		)
		await db.execute(
			/* sql */ `INSERT INTO application_persistence (application_id, type, name, cluster)
				VALUES ('${appId}', 'oracle', 'countable-dup', 'prod-gcp')`,
		)

		expect(await countRemainingLegacyPersistenceDuplicates()).toBe(before + 1)

		// upsertAppPersistence trigger self-healing-mergen — paret skal ikke lenger telles.
		await upsertAppPersistence(appId, "oracle", "countable-dup", { cluster: "prod-gcp" })

		expect(await countRemainingLegacyPersistenceDuplicates()).toBe(before)
	})
})
