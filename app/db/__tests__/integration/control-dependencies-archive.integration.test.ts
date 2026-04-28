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

const { addControlDependency, removeControlDependency, getControlDependencies, getControlDependents } = await import(
	"~/db/queries/framework.server"
)

async function createControl(controlId: string) {
	const db = getTestDb()
	const r = await db.execute(
		/* sql */ `INSERT INTO framework_controls (control_id, requirement) VALUES ('${controlId}', 'req') RETURNING id`,
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

describe("Control dependencies soft-delete integration tests", () => {
	beforeAll(async () => {
		await setupTestDatabase()
	}, 120_000)

	afterAll(async () => {
		await teardownTestDatabase()
	})

	beforeEach(async () => {
		const db = getTestDb()
		await db.execute(/* sql */ `
			DELETE FROM control_dependencies;
			DELETE FROM framework_controls;
			DELETE FROM audit_log;
		`)
	})

	it("archives a dependency instead of hard-deleting it", async () => {
		const a = await createControl("K-ST.01")
		const b = await createControl("K-ST.02")
		await addControlDependency(a, b, "creator")

		const archived = await removeControlDependency(a, b, "remover")
		expect(archived).not.toBeNull()
		expect(archived?.archivedAt).not.toBeNull()
		expect(archived?.archivedBy).toBe("remover")

		const db = getTestDb()
		const stillThere = await db.execute(
			/* sql */ `SELECT id, archived_at FROM control_dependencies WHERE control_id = '${a}' AND depends_on_control_id = '${b}'`,
		)
		expect(stillThere.rows).toHaveLength(1)
		expect((stillThere.rows[0] as { archived_at: unknown }).archived_at).not.toBeNull()
	})

	it("filters archived rows from getControlDependencies and getControlDependents", async () => {
		const a = await createControl("K-ST.01")
		const b = await createControl("K-ST.02")
		await addControlDependency(a, b, "creator")

		expect(await getControlDependencies(a)).toHaveLength(1)
		expect(await getControlDependents(b)).toHaveLength(1)

		await removeControlDependency(a, b, "remover")

		expect(await getControlDependencies(a)).toHaveLength(0)
		expect(await getControlDependents(b)).toHaveLength(0)
	})

	it("allows recreating a dependency after archiving (new active row)", async () => {
		const a = await createControl("K-ST.01")
		const b = await createControl("K-ST.02")
		const first = await addControlDependency(a, b, "u1")
		await removeControlDependency(a, b, "u1")
		const second = await addControlDependency(a, b, "u2")

		expect(second).not.toBeNull()
		expect(second?.id).not.toBe(first?.id)

		const db = getTestDb()
		const all = await db.execute(
			/* sql */ `SELECT id, archived_at FROM control_dependencies WHERE control_id = '${a}' AND depends_on_control_id = '${b}' ORDER BY archived_at NULLS LAST`,
		)
		expect(all.rows).toHaveLength(2)
	})

	it("partial unique index forbids two simultaneous active rows for the same pair", async () => {
		const a = await createControl("K-ST.01")
		const b = await createControl("K-ST.02")
		await addControlDependency(a, b, "u1")
		const second = await addControlDependency(a, b, "u2")

		// Idempotent: returns the existing active row, no insert
		expect(second).not.toBeNull()

		const db = getTestDb()
		const active = await db.execute(
			/* sql */ `SELECT count(*)::int AS c FROM control_dependencies WHERE control_id = '${a}' AND depends_on_control_id = '${b}' AND archived_at IS NULL`,
		)
		expect((active.rows[0] as { c: number }).c).toBe(1)
	})

	it("idempotent add: no duplicate audit entry on re-add of an active dependency", async () => {
		const a = await createControl("K-ST.01")
		const b = await createControl("K-ST.02")
		await addControlDependency(a, b, "u1")
		await addControlDependency(a, b, "u1")

		const audit = await getAuditByEntity("control_dependency", a)
		const adds = audit.filter((r) => r.action === "control_dependency_added")
		expect(adds).toHaveLength(1)
	})

	it("idempotent remove: no audit on no-op when nothing active to archive", async () => {
		const a = await createControl("K-ST.01")
		const b = await createControl("K-ST.02")
		const result = await removeControlDependency(a, b, "u1")
		expect(result).toBeNull()

		const audit = await getAuditByEntity("control_dependency", a)
		expect(audit.filter((r) => r.action === "control_dependency_removed")).toHaveLength(0)
	})

	it("writes audit payloads with correct previous/new values and performer", async () => {
		const a = await createControl("K-ST.01")
		const b = await createControl("K-ST.02")
		await addControlDependency(a, b, "alice")
		await removeControlDependency(a, b, "bob")

		const audit = await getAuditByEntity("control_dependency", a)
		const add = audit.find((r) => r.action === "control_dependency_added")
		const rem = audit.find((r) => r.action === "control_dependency_removed")

		expect(add).toBeDefined()
		expect(add?.performed_by).toBe("alice")
		expect(JSON.parse(add?.new_value ?? "{}")).toEqual({ controlId: a, dependsOnControlId: b })
		expect(add?.previous_value).toBeNull()

		expect(rem).toBeDefined()
		expect(rem?.performed_by).toBe("bob")
		expect(JSON.parse(rem?.previous_value ?? "{}")).toEqual({ controlId: a, dependsOnControlId: b })
		expect(rem?.new_value).toBeNull()
	})

	it("atomicity: archive and audit commit together (no orphan archived row without audit)", async () => {
		const a = await createControl("K-ST.01")
		const b = await createControl("K-ST.02")
		await addControlDependency(a, b, "u1")
		await removeControlDependency(a, b, "u1")

		const db = getTestDb()
		const archived = await db.execute(
			/* sql */ `SELECT count(*)::int AS c FROM control_dependencies WHERE archived_at IS NOT NULL`,
		)
		const audit = await getAuditByEntity("control_dependency", a)
		const removes = audit.filter((r) => r.action === "control_dependency_removed")
		expect((archived.rows[0] as { c: number }).c).toBe(removes.length)
	})
})
