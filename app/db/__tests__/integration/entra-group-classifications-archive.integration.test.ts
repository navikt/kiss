import { sql } from "drizzle-orm"
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

const { upsertGroupClassification, deleteGroupClassification } = await import("~/db/queries/nais.server")

function unwrap<T>(value: T | null | undefined, label: string): T {
	if (value == null) throw new Error(`Expected ${label} to be non-null`)
	return value
}

async function getAuditByEntity(entityType: string, entityId: string) {
	const db = getTestDb()
	const r = await db.execute(
		sql`SELECT action, previous_value, new_value, performed_by FROM audit_log WHERE entity_type = ${entityType} AND entity_id = ${entityId} ORDER BY performed_at, action`,
	)
	return r.rows as Array<{
		action: string
		previous_value: string | null
		new_value: string | null
		performed_by: string
	}>
}

describe("Entra group classifications soft-delete integration tests", () => {
	beforeAll(async () => {
		await setupTestDatabase()
	}, 120_000)

	afterAll(async () => {
		await teardownTestDatabase()
	})

	beforeEach(async () => {
		const db = getTestDb()
		await db.execute(/* sql */ `
			DELETE FROM entra_group_classifications;
			DELETE FROM audit_log;
		`)
	})

	it("archives a classification instead of hard-deleting it", async () => {
		const created = unwrap(await upsertGroupClassification("group-1", "mine_tilganger", "creator"), "created")

		const archived = unwrap(await deleteGroupClassification("group-1", "remover"), "archived")
		expect(archived.archivedAt).not.toBeNull()
		expect(archived.archivedBy).toBe("remover")
		expect(archived.id).toBe(created.id)

		const db = getTestDb()
		const stillThere = await db.execute(
			/* sql */ `SELECT id, archived_at FROM entra_group_classifications WHERE id = '${created.id}'`,
		)
		expect(stillThere.rows).toHaveLength(1)
		expect((stillThere.rows[0] as { archived_at: unknown }).archived_at).not.toBeNull()
	})

	it("excludes archived rows from active count and re-upsert creates new active row", async () => {
		await upsertGroupClassification("group-2", "identrutina", "creator")
		await deleteGroupClassification("group-2", "remover")

		const db = getTestDb()
		const active = await db.execute(
			/* sql */ `SELECT COUNT(*)::int AS c FROM entra_group_classifications WHERE group_id = 'group-2' AND archived_at IS NULL`,
		)
		expect((active.rows[0] as { c: number }).c).toBe(0)

		const reUpserted = unwrap(await upsertGroupClassification("group-2", "nais_console", "creator2"), "re-upsert")
		expect(reUpserted.archivedAt).toBeNull()
		expect(reUpserted.classification).toBe("nais_console")

		const totalsAfter = await db.execute(
			/* sql */ `SELECT COUNT(*) FILTER (WHERE archived_at IS NULL)::int AS active,
			                  COUNT(*) FILTER (WHERE archived_at IS NOT NULL)::int AS archived
			           FROM entra_group_classifications WHERE group_id = 'group-2'`,
		)
		expect(totalsAfter.rows[0]).toEqual({ active: 1, archived: 1 })
	})

	it("allows re-creating a previously archived classification as a new active row", async () => {
		const first = unwrap(await upsertGroupClassification("group-3", "mine_tilganger", "creator"), "first")
		await deleteGroupClassification("group-3", "remover")

		const second = unwrap(await upsertGroupClassification("group-3", "nais_console", "creator2"), "second")
		expect(second.id).not.toBe(first.id)
		expect(second.classification).toBe("nais_console")

		const db = getTestDb()
		const all = await db.execute(
			/* sql */ `SELECT id, archived_at FROM entra_group_classifications WHERE group_id = 'group-3' ORDER BY created_at`,
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
	})

	it("partial unique index prevents two active rows for same group_id", async () => {
		const first = unwrap(await upsertGroupClassification("group-4", "mine_tilganger", "creator"), "first")

		const dup = unwrap(await upsertGroupClassification("group-4", "mine_tilganger", "creator"), "dup")
		expect(dup.id).toBe(first.id)

		const db = getTestDb()
		const rows = await db.execute(
			/* sql */ `SELECT COUNT(*)::int AS c FROM entra_group_classifications WHERE group_id = 'group-4' AND archived_at IS NULL`,
		)
		expect((rows.rows[0] as { c: number }).c).toBe(1)
	})

	it("upsert with same classification is idempotent — no duplicate audit", async () => {
		await upsertGroupClassification("group-5", "mine_tilganger", "creator")
		await upsertGroupClassification("group-5", "mine_tilganger", "creator")

		const audit = await getAuditByEntity("entra_group", "group-5")
		const created = audit.filter((a) => a.action === "entra_group_classification_created")
		expect(created).toHaveLength(1)
	})

	it("upsert with different classification logs group_classification_updated", async () => {
		await upsertGroupClassification("group-6", "mine_tilganger", "creator")
		await upsertGroupClassification("group-6", "nais_console", "updater")

		const audit = await getAuditByEntity("entra_group", "group-6")
		const created = audit.filter((a) => a.action === "entra_group_classification_created")
		const updated = audit.filter((a) => a.action === "group_classification_updated")
		expect(created).toHaveLength(1)
		expect(updated).toHaveLength(1)
		expect(updated[0].previous_value).toBe(JSON.stringify({ classification: "mine_tilganger" }))
		expect(updated[0].new_value).toBe(JSON.stringify({ classification: "nais_console" }))
		expect(updated[0].performed_by).toBe("updater")
	})

	it("deleteGroupClassification is idempotent — second call no-op, only one audit", async () => {
		await upsertGroupClassification("group-7", "mine_tilganger", "creator")

		const first = await deleteGroupClassification("group-7", "remover")
		expect(first).not.toBeNull()

		const second = await deleteGroupClassification("group-7", "remover2")
		expect(second).toBeNull()

		const audit = await getAuditByEntity("entra_group", "group-7")
		const archivedEntries = audit.filter((a) => a.action === "entra_group_classification_archived")
		expect(archivedEntries).toHaveLength(1)
		expect(archivedEntries[0].performed_by).toBe("remover")
	})

	it("writes audit log entries on create and archive with correct payloads", async () => {
		await upsertGroupClassification("group-8", "annet", "creator")
		await deleteGroupClassification("group-8", "remover")

		const audit = await getAuditByEntity("entra_group", "group-8")
		const entries = audit.filter(
			(a) => a.action === "entra_group_classification_created" || a.action === "entra_group_classification_archived",
		)
		expect(entries).toHaveLength(2)

		const createdEntry = entries.find((e) => e.action === "entra_group_classification_created")
		expect(createdEntry?.new_value).toBe(JSON.stringify({ classification: "annet" }))
		expect(createdEntry?.performed_by).toBe("creator")

		const archivedEntry = entries.find((e) => e.action === "entra_group_classification_archived")
		expect(archivedEntry?.previous_value).toBe(JSON.stringify({ classification: "annet" }))
		expect(archivedEntry?.performed_by).toBe("remover")
	})

	it("does not write audit on no-op duplicate upsert", async () => {
		await upsertGroupClassification("group-9", "identrutina", "creator")
		await upsertGroupClassification("group-9", "identrutina", "other")
		await upsertGroupClassification("group-9", "identrutina", "third")

		const audit = await getAuditByEntity("entra_group", "group-9")
		expect(audit).toHaveLength(1)
		expect(audit[0].action).toBe("entra_group_classification_created")
	})

	it("transactional atomicity — audit and mutation are committed together on success", async () => {
		// Vi tester atomisitet ved å verifisere at audit-rad og data-rad alltid er
		// commitet sammen. Her opprett, og bekreft at begge er på plass.
		const created = unwrap(await upsertGroupClassification("group-10", "mine_tilganger", "creator"), "created")

		const db = getTestDb()
		const rowCheck = await db.execute(/* sql */ `SELECT id FROM entra_group_classifications WHERE id = '${created.id}'`)
		expect(rowCheck.rows).toHaveLength(1)

		const audit = await getAuditByEntity("entra_group", "group-10")
		expect(audit).toHaveLength(1)
		expect(audit[0].action).toBe("entra_group_classification_created")

		// Arkiver, og verifiser at både archived_at og audit er på plass
		await deleteGroupClassification("group-10", "remover")
		const afterArchive = await db.execute(
			/* sql */ `SELECT archived_at FROM entra_group_classifications WHERE id = '${created.id}'`,
		)
		expect((afterArchive.rows[0] as { archived_at: unknown }).archived_at).not.toBeNull()

		const auditAfter = await getAuditByEntity("entra_group", "group-10")
		const archivedEntries = auditAfter.filter((a) => a.action === "entra_group_classification_archived")
		expect(archivedEntries).toHaveLength(1)
	})
})
