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

const { ignoreAppForSection, unignoreAppForSection, getIgnoredAppsForSection } = await import(
	"~/db/queries/nais.server"
)

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

async function createTestSection(name: string, slug: string) {
	const db = getTestDb()
	const result = await db.execute(
		/* sql */ `INSERT INTO sections (name, slug, created_by, updated_by) VALUES ('${name}', '${slug}', 'test', 'test') RETURNING id`,
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

describe("section_ignored_applications soft-delete integration tests", () => {
	beforeAll(async () => {
		await setupTestDatabase()
	}, 120_000)

	afterAll(async () => {
		await teardownTestDatabase()
	})

	beforeEach(async () => {
		const db = getTestDb()
		await db.execute(/* sql */ `
			DELETE FROM section_ignored_applications;
			DELETE FROM sections;
			DELETE FROM monitored_applications;
			DELETE FROM audit_log;
		`)
	})

	it("archives an ignored app instead of hard-deleting it", async () => {
		const sectionId = await createTestSection("Sek A", "sek-a")
		const appId = await createTestApp("App A")
		const added = unwrap(await ignoreAppForSection(sectionId, appId, "creator", "fordi"), "added")

		const archived = unwrap(await unignoreAppForSection(sectionId, appId, "remover"), "archived")
		expect(archived.archivedAt).not.toBeNull()
		expect(archived.archivedBy).toBe("remover")

		const db = getTestDb()
		const stillThere = await db.execute(
			/* sql */ `SELECT id, archived_at FROM section_ignored_applications WHERE id = '${added.id}'`,
		)
		expect(stillThere.rows).toHaveLength(1)
		expect((stillThere.rows[0] as { archived_at: unknown }).archived_at).not.toBeNull()
	})

	it("excludes archived rows from getIgnoredAppsForSection", async () => {
		const sectionId = await createTestSection("Sek B", "sek-b")
		const appId1 = await createTestApp("App B1")
		const appId2 = await createTestApp("App B2")
		await ignoreAppForSection(sectionId, appId1, "creator")
		await ignoreAppForSection(sectionId, appId2, "creator")
		await unignoreAppForSection(sectionId, appId1, "remover")

		const active = await getIgnoredAppsForSection(sectionId)
		expect(active).toHaveLength(1)
		expect(active[0].appId).toBe(appId2)
	})

	it("allows re-ignoring a previously archived app as a new active row", async () => {
		const sectionId = await createTestSection("Sek D", "sek-d")
		const appId = await createTestApp("App D")
		const first = unwrap(await ignoreAppForSection(sectionId, appId, "creator"), "first")
		await unignoreAppForSection(sectionId, appId, "remover")

		const second = unwrap(await ignoreAppForSection(sectionId, appId, "creator2"), "second")
		expect(second.id).not.toBe(first.id)

		const db = getTestDb()
		const all = await db.execute(
			/* sql */ `SELECT id, archived_at FROM section_ignored_applications WHERE section_id = '${sectionId}' AND application_id = '${appId}' ORDER BY ignored_at`,
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

		const active = await getIgnoredAppsForSection(sectionId)
		expect(active).toHaveLength(1)
		expect(active[0].id).toBe(second.id)
	})

	it("partial unique index prevents two active rows for same (section, app)", async () => {
		const sectionId = await createTestSection("Sek E", "sek-e")
		const appId = await createTestApp("App E")
		const first = unwrap(await ignoreAppForSection(sectionId, appId, "creator"), "first")

		// Idempotent no-op — returnerer eksisterende rad
		const dup = await ignoreAppForSection(sectionId, appId, "creator")
		expect(dup).not.toBeNull()
		expect(dup?.id).toBe(first.id)

		const db = getTestDb()
		const rows = await db.execute(
			/* sql */ `SELECT COUNT(*)::int AS c FROM section_ignored_applications WHERE section_id = '${sectionId}' AND application_id = '${appId}' AND archived_at IS NULL`,
		)
		expect((rows.rows[0] as { c: number }).c).toBe(1)
	})

	it("unignoreAppForSection is idempotent — calling it twice on same row only logs once", async () => {
		const sectionId = await createTestSection("Sek F", "sek-f")
		const appId = await createTestApp("App F")
		await ignoreAppForSection(sectionId, appId, "creator")

		const first = await unignoreAppForSection(sectionId, appId, "remover")
		expect(first).not.toBeNull()

		const second = await unignoreAppForSection(sectionId, appId, "remover2")
		expect(second).toBeNull()

		const audit = await getAuditByEntity("section_ignored_application", appId)
		const removedEntries = audit.filter((a) => a.action === "section_app_unignored")
		expect(removedEntries).toHaveLength(1)
		expect(removedEntries[0].performed_by).toBe("remover")
	})

	it("writes audit log entries on ignore and unignore with correct payloads", async () => {
		const sectionId = await createTestSection("Sek G", "sek-g")
		const appId = await createTestApp("App G")
		await ignoreAppForSection(sectionId, appId, "creator", "ikke relevant")
		await unignoreAppForSection(sectionId, appId, "remover")

		const audit = await getAuditByEntity("section_ignored_application", appId)
		expect(audit).toHaveLength(2)
		expect(audit[0].action).toBe("section_app_ignored")
		expect(audit[0].new_value).toBe(JSON.stringify({ sectionId, applicationId: appId, reason: "ikke relevant" }))
		expect(audit[0].performed_by).toBe("creator")

		expect(audit[1].action).toBe("section_app_unignored")
		expect(audit[1].previous_value).toBe(JSON.stringify({ sectionId, applicationId: appId }))
		expect(audit[1].performed_by).toBe("remover")
	})

	it("does not write audit on no-op duplicate ignore", async () => {
		const sectionId = await createTestSection("Sek H", "sek-h")
		const appId = await createTestApp("App H")
		await ignoreAppForSection(sectionId, appId, "creator")
		await ignoreAppForSection(sectionId, appId, "creator")

		const audit = await getAuditByEntity("section_ignored_application", appId)
		const ignoredEntries = audit.filter((a) => a.action === "section_app_ignored")
		expect(ignoredEntries).toHaveLength(1)
	})

	it("transactional atomicity — both row update and audit log committed together", async () => {
		const sectionId = await createTestSection("Sek J", "sek-j")
		const appId = await createTestApp("App J")
		const added = unwrap(await ignoreAppForSection(sectionId, appId, "creator"), "added")

		const auditAfterAdd = await getAuditByEntity("section_ignored_application", appId)
		const ignoredEntries = auditAfterAdd.filter((a) => a.action === "section_app_ignored")
		expect(ignoredEntries).toHaveLength(1)

		await unignoreAppForSection(sectionId, appId, "remover")
		const db = getTestDb()
		const afterRemove = await db.execute(
			/* sql */ `SELECT archived_at FROM section_ignored_applications WHERE id = '${added.id}'`,
		)
		expect((afterRemove.rows[0] as { archived_at: unknown }).archived_at).not.toBeNull()

		const auditAfterRemove = await getAuditByEntity("section_ignored_application", appId)
		const removedEntries = auditAfterRemove.filter((a) => a.action === "section_app_unignored")
		expect(removedEntries).toHaveLength(1)
	})
})
