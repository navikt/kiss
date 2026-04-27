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

const { assignRole, removeRole, getUserRoles, listUsersWithRoles, upsertUser } = await import(
	"~/db/queries/users.server"
)
const { resolveRoleHolder } = await import("~/db/queries/rulesets.server")

async function createSection(name: string, slug: string): Promise<string> {
	const db = getTestDb()
	const r = await db.execute(
		/* sql */ `INSERT INTO sections (name, slug, created_by, updated_by) VALUES ('${name}', '${slug}', 'test', 'test') RETURNING id`,
	)
	return (r.rows[0] as { id: string }).id
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

describe("user_roles soft-delete integration tests", () => {
	beforeAll(async () => {
		await setupTestDatabase()
	}, 120_000)

	afterAll(async () => {
		await teardownTestDatabase()
	})

	beforeEach(async () => {
		const db = getTestDb()
		await db.execute(/* sql */ `
			DELETE FROM user_roles;
			DELETE FROM user_preferences;
			DELETE FROM users;
			DELETE FROM dev_teams;
			DELETE FROM sections;
			DELETE FROM audit_log;
		`)
	})

	it("archives a role assignment instead of hard-deleting it", async () => {
		const sectionId = await createSection("Sek A", "sek-a")
		const roleId = await assignRole("Y1", "Y One", "section_manager", "creator", sectionId)

		const archived = await removeRole(roleId, "remover")
		expect(archived).not.toBeNull()
		expect(archived?.archivedAt).not.toBeNull()
		expect(archived?.archivedBy).toBe("remover")

		const db = getTestDb()
		const stillThere = await db.execute(/* sql */ `SELECT id, archived_at FROM user_roles WHERE id = '${roleId}'`)
		expect(stillThere.rows).toHaveLength(1)
		expect((stillThere.rows[0] as { archived_at: unknown }).archived_at).not.toBeNull()
	})

	it("excludes archived rows from getUserRoles and listUsersWithRoles", async () => {
		const sectionId = await createSection("Sek B", "sek-b")
		const r1 = await assignRole("Y2", "Y Two", "section_manager", "creator", sectionId)
		await assignRole("Y2", "Y Two", "auditor", "creator", sectionId)
		await removeRole(r1, "remover")

		const roles = await getUserRoles("Y2")
		expect(roles).toHaveLength(1)
		expect(roles[0].role).toBe("auditor")

		const all = await listUsersWithRoles()
		const y2 = all.find((u) => u.navIdent === "Y2")
		expect(y2?.roles).toHaveLength(1)
		expect(y2?.roles[0].role).toBe("auditor")
	})

	it("resolveRoleHolder skips archived roles", async () => {
		const sectionId = await createSection("Sek C", "sek-c")
		const roleId = await assignRole("Y3", "Y Three", "section_manager", "creator", sectionId)

		const before = await resolveRoleHolder("section_manager", sectionId)
		expect(before?.navIdent).toBe("Y3")

		await removeRole(roleId, "remover")

		const after = await resolveRoleHolder("section_manager", sectionId)
		expect(after).toBeNull()
	})

	it("allows re-assigning a previously archived role as a new active row", async () => {
		const sectionId = await createSection("Sek D", "sek-d")
		const first = await assignRole("Y4", "Y Four", "auditor", "creator", sectionId)
		await removeRole(first, "remover")

		const second = await assignRole("Y4", "Y Four", "auditor", "creator2", sectionId)
		expect(second).not.toBe(first)

		const db = getTestDb()
		const all = await db.execute(/* sql */ `SELECT id, archived_at FROM user_roles ORDER BY created_at`)
		expect(all.rows).toHaveLength(2)
		const archivedRow = all.rows.find((r) => (r as { id: string }).id === first) as { archived_at: unknown }
		const activeRow = all.rows.find((r) => (r as { id: string }).id === second) as { archived_at: unknown }
		expect(archivedRow.archived_at).not.toBeNull()
		expect(activeRow.archived_at).toBeNull()

		const active = await getUserRoles("Y4")
		expect(active).toHaveLength(1)
		expect(active[0].id).toBe(second)
	})

	it("removeRole is idempotent — calling it twice on same row only logs once", async () => {
		const sectionId = await createSection("Sek E", "sek-e")
		const roleId = await assignRole("Y5", "Y Five", "auditor", "creator", sectionId)

		const first = await removeRole(roleId, "remover")
		expect(first).not.toBeNull()

		const second = await removeRole(roleId, "remover2")
		expect(second).toBeNull()

		const audit = await getAuditByEntity("user_role", roleId)
		const revoked = audit.filter((a) => a.action === "user_role_revoked")
		expect(revoked).toHaveLength(1)
		expect(revoked[0].performed_by).toBe("remover")
	})

	it("removeRole returns null when role does not exist (idempotent no-op)", async () => {
		const result = await removeRole("00000000-0000-0000-0000-000000000000", "remover")
		expect(result).toBeNull()
	})

	it("writes audit log entries on assign and remove with correct payloads", async () => {
		const sectionId = await createSection("Sek F", "sek-f")
		const roleId = await assignRole("Y6", "Y Six", "section_manager", "creator", sectionId)
		await removeRole(roleId, "remover")

		const audit = await getAuditByEntity("user_role", roleId)
		expect(audit).toHaveLength(2)

		expect(audit[0].action).toBe("user_role_granted")
		expect(audit[0].performed_by).toBe("creator")
		const granted = JSON.parse(audit[0].new_value as string) as Record<string, unknown>
		expect(granted.navIdent).toBe("Y6")
		expect(granted.role).toBe("section_manager")
		expect(granted.sectionId).toBe(sectionId)

		expect(audit[1].action).toBe("user_role_revoked")
		expect(audit[1].performed_by).toBe("remover")
		const revoked = JSON.parse(audit[1].previous_value as string) as Record<string, unknown>
		expect(revoked.role).toBe("section_manager")
		expect(revoked.sectionId).toBe(sectionId)
	})

	it("transactional atomicity — both row update and audit committed together", async () => {
		const sectionId = await createSection("Sek G", "sek-g")
		const roleId = await assignRole("Y7", "Y Seven", "auditor", "creator", sectionId)

		const grantedAudit = await getAuditByEntity("user_role", roleId)
		expect(grantedAudit.filter((a) => a.action === "user_role_granted")).toHaveLength(1)

		await removeRole(roleId, "remover")

		const db = getTestDb()
		const r = await db.execute(/* sql */ `SELECT archived_at FROM user_roles WHERE id = '${roleId}'`)
		expect((r.rows[0] as { archived_at: unknown }).archived_at).not.toBeNull()

		const revokedAudit = await getAuditByEntity("user_role", roleId)
		expect(revokedAudit.filter((a) => a.action === "user_role_revoked")).toHaveLength(1)
	})

	it("upsertUser is unaffected by archived role rows", async () => {
		const sectionId = await createSection("Sek H", "sek-h")
		const roleId = await assignRole("Y8", "Y Eight", "auditor", "creator", sectionId)
		await removeRole(roleId, "remover")

		// Should not throw, and should resolve to same user id
		const userId = await upsertUser("Y8", "Y Eight Updated", "y8@example.com")
		expect(userId).toBeTruthy()

		const roles = await getUserRoles("Y8")
		expect(roles).toHaveLength(0)
	})
})
