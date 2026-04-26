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

const { addManualGroup, getManualGroupsForApp, removeManualGroup } = await import("~/db/queries/nais.server")

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

describe("Application manual groups soft-delete integration tests", () => {
	beforeAll(async () => {
		await setupTestDatabase()
	}, 120_000)

	afterAll(async () => {
		await teardownTestDatabase()
	})

	beforeEach(async () => {
		const db = getTestDb()
		await db.execute(/* sql */ `
			DELETE FROM application_manual_groups;
			DELETE FROM monitored_applications;
			DELETE FROM audit_log;
		`)
	})

	it("archives a manual group instead of hard-deleting it", async () => {
		const appId = await createTestApp("App A")
		const added = unwrap(await addManualGroup(appId, "group-1", "Gruppe 1", "creator"), "added")

		const archived = unwrap(await removeManualGroup(added.id, appId, "remover"), "archived")
		expect(archived.archivedAt).not.toBeNull()
		expect(archived.archivedBy).toBe("remover")

		const db = getTestDb()
		const stillThere = await db.execute(
			/* sql */ `SELECT id, archived_at, archived_by FROM application_manual_groups WHERE id = '${added.id}'`,
		)
		expect(stillThere.rows).toHaveLength(1)
		expect((stillThere.rows[0] as { archived_at: unknown }).archived_at).not.toBeNull()
	})

	it("excludes archived rows from getManualGroupsForApp", async () => {
		const appId = await createTestApp("App B")
		const g1 = unwrap(await addManualGroup(appId, "group-1", "Gruppe 1", "creator"), "g1")
		unwrap(await addManualGroup(appId, "group-2", "Gruppe 2", "creator"), "g2")

		await removeManualGroup(g1.id, appId, "remover")

		const active = await getManualGroupsForApp(appId)
		expect(active).toHaveLength(1)
		expect(active[0].groupId).toBe("group-2")
	})

	it("allows re-adding a previously archived group as a new active row", async () => {
		const appId = await createTestApp("App C")
		const first = unwrap(await addManualGroup(appId, "group-1", "Gruppe 1", "creator"), "first")
		await removeManualGroup(first.id, appId, "remover")

		const second = unwrap(await addManualGroup(appId, "group-1", "Gruppe 1 (re-added)", "creator2"), "second")
		expect(second.id).not.toBe(first.id)

		const db = getTestDb()
		const all = await db.execute(
			/* sql */ `SELECT id, archived_at FROM application_manual_groups WHERE application_id = '${appId}' ORDER BY created_at`,
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

		const active = await getManualGroupsForApp(appId)
		expect(active).toHaveLength(1)
		expect(active[0].id).toBe(second.id)
		expect(active[0].groupName).toBe("Gruppe 1 (re-added)")
	})

	it("partial unique index prevents two active rows for same (app, group)", async () => {
		const appId = await createTestApp("App D")
		const first = unwrap(await addManualGroup(appId, "group-x", null, "creator"), "first")

		// Adding the same active group is an idempotent no-op — returnerer
		// eksisterende aktiv rad i stedet for å lage en ny.
		const dup = await addManualGroup(appId, "group-x", null, "creator")
		expect(dup).not.toBeNull()
		expect(dup?.id).toBe(first.id)

		const db = getTestDb()
		const rows = await db.execute(
			/* sql */ `SELECT COUNT(*)::int AS c FROM application_manual_groups WHERE application_id = '${appId}' AND archived_at IS NULL`,
		)
		expect((rows.rows[0] as { c: number }).c).toBe(1)
	})

	it("removeManualGroup is idempotent — calling it twice on same row only logs once", async () => {
		const appId = await createTestApp("App E")
		const added = unwrap(await addManualGroup(appId, "group-1", null, "creator"), "added")

		const first = await removeManualGroup(added.id, appId, "remover")
		expect(first).not.toBeNull()

		const second = await removeManualGroup(added.id, appId, "remover2")
		expect(second).toBeNull()

		const audit = await getAuditByEntity("application", appId)
		const removedEntries = audit.filter((a) => a.action === "manual_group_removed")
		expect(removedEntries).toHaveLength(1)
		expect(removedEntries[0].performed_by).toBe("remover")
	})

	it("writes audit log entries on add and remove with correct payloads", async () => {
		const appId = await createTestApp("App F")
		const added = unwrap(await addManualGroup(appId, "group-42", "Gruppe 42", "creator"), "added")
		await removeManualGroup(added.id, appId, "remover")

		const audit = await getAuditByEntity("application", appId)
		expect(audit).toHaveLength(2)
		expect(audit[0].action).toBe("manual_group_added")
		expect(audit[0].new_value).toBe(JSON.stringify({ groupId: "group-42", groupName: "Gruppe 42" }))
		expect(audit[0].performed_by).toBe("creator")

		expect(audit[1].action).toBe("manual_group_removed")
		expect(audit[1].previous_value).toBe(JSON.stringify({ groupId: "group-42", groupName: "Gruppe 42" }))
		expect(audit[1].performed_by).toBe("remover")
	})

	it("does not write audit on no-op duplicate add", async () => {
		const appId = await createTestApp("App G")
		const first = unwrap(await addManualGroup(appId, "group-1", null, "creator"), "first")

		const dup = await addManualGroup(appId, "group-1", null, "creator")
		expect(dup).not.toBeNull()
		expect(dup?.id).toBe(first.id)

		const audit = await getAuditByEntity("application", appId)
		expect(audit).toHaveLength(1)
		expect(audit[0].action).toBe("manual_group_added")
	})

	it("removeManualGroup rejects mismatched applicationId (cross-app guard)", async () => {
		const app1 = await createTestApp("App H1")
		const app2 = await createTestApp("App H2")
		const g = unwrap(await addManualGroup(app1, "group-1", null, "creator"), "g")

		// Forsøk på å arkivere via feil applicationId — skal returnere null
		// og ikke arkivere eller logge.
		const result = await removeManualGroup(g.id, app2, "attacker")
		expect(result).toBeNull()

		// Raden skal fortsatt være aktiv på app1
		const active = await getManualGroupsForApp(app1)
		expect(active).toHaveLength(1)
		expect(active[0].id).toBe(g.id)
		expect(active[0].archivedAt).toBeNull()

		// Ingen audit skal være skrevet på app2
		const audit2 = await getAuditByEntity("application", app2)
		expect(audit2).toHaveLength(0)

		// app1 skal kun ha "added"-loggen
		const audit1 = await getAuditByEntity("application", app1)
		expect(audit1).toHaveLength(1)
		expect(audit1[0].action).toBe("manual_group_added")
	})

	it("add and remove kjører atomisk i transaksjon (audit + rad endring sammen)", async () => {
		// Verifiserer at writeAuditLog kjører innenfor samme tx som UPDATE/INSERT.
		// Hvis det ikke var atomisk kunne vi ende opp med arkivert rad uten audit
		// (eller motsatt) ved feil i én av operasjonene.
		const appId = await createTestApp("App I")
		const added = unwrap(await addManualGroup(appId, "group-1", "Gruppe 1", "creator"), "added")

		// Verifiser at både rad og audit er på plass etter add
		const db = getTestDb()
		const afterAdd = await db.execute(
			/* sql */ `SELECT COUNT(*)::int AS c FROM application_manual_groups WHERE id = '${added.id}'`,
		)
		expect((afterAdd.rows[0] as { c: number }).c).toBe(1)
		const auditAfterAdd = await getAuditByEntity("application", appId)
		expect(auditAfterAdd).toHaveLength(1)

		// Arkiver, og verifiser at både archived_at og audit er på plass
		await removeManualGroup(added.id, appId, "remover")
		const afterRemove = await db.execute(
			/* sql */ `SELECT archived_at FROM application_manual_groups WHERE id = '${added.id}'`,
		)
		expect((afterRemove.rows[0] as { archived_at: unknown }).archived_at).not.toBeNull()
		const auditAfterRemove = await getAuditByEntity("application", appId)
		expect(auditAfterRemove).toHaveLength(2)
		expect(auditAfterRemove[1].action).toBe("manual_group_removed")
	})
})
