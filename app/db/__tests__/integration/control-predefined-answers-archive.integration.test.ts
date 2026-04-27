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

const { addPredefinedAnswer, deletePredefinedAnswer, getControlDetail, updatePredefinedAnswer } = await import(
	"~/db/queries/framework.server"
)

async function createControl(controlId: string) {
	const db = getTestDb()
	const v = await db.execute(
		/* sql */ `INSERT INTO framework_versions (name, source_file_name, source_bucket_path, created_by) VALUES ('v-${controlId}', 't.xlsx', 'b/p', 'tester') RETURNING id`,
	)
	const versionId = (v.rows[0] as { id: string }).id
	const dom = await db.execute(
		/* sql */ `INSERT INTO framework_domains (code, name, last_import_id) VALUES ('D-${controlId}', 'Domain ${controlId}', '${versionId}') RETURNING id`,
	)
	const domainId = (dom.rows[0] as { id: string }).id
	const r = await db.execute(
		/* sql */ `INSERT INTO framework_risks (risk_id, description, domain_id, last_import_id) VALUES ('R-${controlId}', 'r', '${domainId}', '${versionId}') RETURNING id`,
	)
	const riskId = (r.rows[0] as { id: string }).id
	const c = await db.execute(
		/* sql */ `INSERT INTO framework_controls (control_id, requirement, last_import_id) VALUES ('${controlId}', 'req', '${versionId}') RETURNING id`,
	)
	const cId = (c.rows[0] as { id: string }).id
	await db.execute(
		/* sql */ `INSERT INTO framework_risk_control_mappings (risk_id, control_id) VALUES ('${riskId}', '${cId}')`,
	)
	return { controlId, controlUuid: cId }
}

async function getAuditFor(entityId: string) {
	const db = getTestDb()
	const r = await db.execute(
		/* sql */ `SELECT action, previous_value, new_value, performed_by FROM audit_log WHERE entity_type = 'control' AND entity_id = '${entityId}' ORDER BY performed_at, action`,
	)
	return r.rows as Array<{
		action: string
		previous_value: string | null
		new_value: string | null
		performed_by: string
	}>
}

describe("control_predefined_answers soft-delete integration tests", () => {
	beforeAll(async () => {
		await setupTestDatabase()
	}, 120_000)

	afterAll(async () => {
		await teardownTestDatabase()
	})

	beforeEach(async () => {
		const db = getTestDb()
		await db.execute(/* sql */ `
			DELETE FROM control_predefined_answers;
			DELETE FROM framework_risk_control_mappings;
			DELETE FROM framework_controls;
			DELETE FROM framework_risks;
			DELETE FROM framework_domains;
			DELETE FROM framework_versions;
			DELETE FROM audit_log;
		`)
	})

	it("archives an answer instead of hard-deleting it (row remains, archived_at set)", async () => {
		const { controlId, controlUuid } = await createControl("K-CP.01")
		const added = await addPredefinedAnswer(controlId, "Svar A", "implemented", "kommentar", "creator")

		const archived = await deletePredefinedAnswer(added.id, "remover")
		expect(archived).not.toBeNull()
		expect(archived?.archivedAt).not.toBeNull()
		expect(archived?.archivedBy).toBe("remover")

		const db = getTestDb()
		const rows = await db.execute(
			/* sql */ `SELECT id, archived_at FROM control_predefined_answers WHERE control_id = '${controlUuid}'`,
		)
		expect(rows.rows).toHaveLength(1)
		expect((rows.rows[0] as { archived_at: unknown }).archived_at).not.toBeNull()
	})

	it("excludes archived rows from getControlDetail", async () => {
		const { controlId } = await createControl("K-CP.02")
		const a1 = await addPredefinedAnswer(controlId, "Svar A", "implemented", null, "creator")
		await addPredefinedAnswer(controlId, "Svar B", "not_implemented", null, "creator")

		await deletePredefinedAnswer(a1.id, "remover")

		const detail = await getControlDetail(controlId)
		expect(detail).not.toBeNull()
		const labels = (detail as { predefinedAnswers: Array<{ label: string }> }).predefinedAnswers.map((p) => p.label)
		expect(labels).toEqual(["Svar B"])
	})

	it("idempotent re-add: adding a label that was previously archived creates a new active row alongside the archived one", async () => {
		const { controlId, controlUuid } = await createControl("K-CP.03")
		const first = await addPredefinedAnswer(controlId, "Svar A", "implemented", null, "creator")
		await deletePredefinedAnswer(first.id, "remover")

		const second = await addPredefinedAnswer(controlId, "Svar A", "implemented", null, "creator2")
		expect(second.id).not.toBe(first.id)

		const db = getTestDb()
		const rows = await db.execute(
			/* sql */ `SELECT id, archived_at FROM control_predefined_answers WHERE control_id = '${controlUuid}' ORDER BY created_at`,
		)
		expect(rows.rows).toHaveLength(2)
		const archivedRow = rows.rows.find((r) => (r as { id: string }).id === first.id) as
			| { archived_at: unknown }
			| undefined
		const activeRow = rows.rows.find((r) => (r as { id: string }).id === second.id) as
			| { archived_at: unknown }
			| undefined
		expect(archivedRow?.archived_at).not.toBeNull()
		expect(activeRow?.archived_at).toBeNull()

		const detail = await getControlDetail(controlId)
		const labels = (detail as { predefinedAnswers: Array<{ id: string }> }).predefinedAnswers.map((p) => p.id)
		expect(labels).toEqual([second.id])
	})

	it("displayOrder counts only active rows on re-add", async () => {
		const { controlId } = await createControl("K-CP.04")
		const a = await addPredefinedAnswer(controlId, "A", "implemented", null, "creator")
		const b = await addPredefinedAnswer(controlId, "B", "implemented", null, "creator")
		await deletePredefinedAnswer(a.id, "remover")
		await deletePredefinedAnswer(b.id, "remover")

		const c = await addPredefinedAnswer(controlId, "C", "implemented", null, "creator")
		expect(c.displayOrder).toBe(0)
	})

	it("updatePredefinedAnswer ignores archived rows", async () => {
		const { controlId } = await createControl("K-CP.05")
		const a = await addPredefinedAnswer(controlId, "A", "implemented", null, "creator")
		await deletePredefinedAnswer(a.id, "remover")

		await expect(updatePredefinedAnswer(a.id, { label: "Endret" }, "editor")).rejects.toThrow(/ikke funnet/)
	})

	it("deletePredefinedAnswer is idempotent — second call returns null and only one archive audit", async () => {
		const { controlId, controlUuid } = await createControl("K-CP.06")
		const a = await addPredefinedAnswer(controlId, "A", "implemented", null, "creator")

		const first = await deletePredefinedAnswer(a.id, "remover")
		expect(first).not.toBeNull()

		const second = await deletePredefinedAnswer(a.id, "remover2")
		expect(second).toBeNull()

		const audit = await getAuditFor(controlUuid)
		const archivedEntries = audit.filter((e) => e.action === "predefined_answer_archived")
		expect(archivedEntries).toHaveLength(1)
		expect(archivedEntries[0].performed_by).toBe("remover")
	})

	it("writes audit log on add and archive with correct payloads", async () => {
		const { controlId, controlUuid } = await createControl("K-CP.07")
		const a = await addPredefinedAnswer(controlId, "Svar X", "implemented", "kommentar", "creator")
		await deletePredefinedAnswer(a.id, "remover")

		const audit = await getAuditFor(controlUuid)
		const created = audit.find((e) => e.action === "predefined_answer_created")
		const archived = audit.find((e) => e.action === "predefined_answer_archived")

		expect(created).toBeDefined()
		expect(created?.performed_by).toBe("creator")
		expect(JSON.parse(created?.new_value ?? "{}")).toMatchObject({
			label: "Svar X",
			status: "implemented",
			comment: "kommentar",
		})

		expect(archived).toBeDefined()
		expect(archived?.performed_by).toBe("remover")
		expect(JSON.parse(archived?.previous_value ?? "{}")).toMatchObject({
			id: a.id,
			label: "Svar X",
			status: "implemented",
			comment: "kommentar",
		})
	})

	it("transactional atomicity — both archived_at and audit committed together", async () => {
		const { controlId, controlUuid } = await createControl("K-CP.08")
		const a = await addPredefinedAnswer(controlId, "A", "implemented", null, "creator")
		await deletePredefinedAnswer(a.id, "remover")

		const db = getTestDb()
		const row = await db.execute(/* sql */ `SELECT archived_at FROM control_predefined_answers WHERE id = '${a.id}'`)
		expect((row.rows[0] as { archived_at: unknown }).archived_at).not.toBeNull()

		const audit = await getAuditFor(controlUuid)
		const archivedEntries = audit.filter((e) => e.action === "predefined_answer_archived")
		expect(archivedEntries).toHaveLength(1)
	})
})
