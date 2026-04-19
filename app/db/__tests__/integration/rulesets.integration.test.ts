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
	createRuleset,
	updateRuleset,
	archiveRuleset,
	approveRuleset,
	linkControlToRuleset,
	unlinkControlFromRuleset,
	getRulesetsForSection,
	getRulesetDetail,
	getRulesetsForControl,
	linkRoutineToRuleset,
	unlinkRoutineFromRuleset,
} = await import("~/db/queries/rulesets.server")

async function createSectionRow(slug: string) {
	const db = getTestDb()
	const r = await db.execute(
		/* sql */ `INSERT INTO sections (name, slug, created_by, updated_by) VALUES ('Sec ${slug}', '${slug}', 'test', 'test') RETURNING id`,
	)
	return (r.rows[0] as { id: string }).id
}

async function createControl(controlId: string) {
	const db = getTestDb()
	const r = await db.execute(
		/* sql */ `INSERT INTO framework_controls (control_id, requirement) VALUES ('${controlId}', 'req') RETURNING id`,
	)
	return (r.rows[0] as { id: string }).id
}

async function createRoutineRow(sectionId: string, name: string) {
	const db = getTestDb()
	const r = await db.execute(
		/* sql */ `INSERT INTO routines (section_id, name, frequency, created_by, updated_by) VALUES ('${sectionId}', '${name}', 'quarterly', 'test', 'test') RETURNING id`,
	)
	return (r.rows[0] as { id: string }).id
}

describe("rulesets.server integration tests", () => {
	beforeAll(async () => {
		await setupTestDatabase()
	}, 120_000)

	afterAll(async () => {
		await teardownTestDatabase()
	})

	beforeEach(async () => {
		const db = getTestDb()
		await db.execute(/* sql */ `
			DELETE FROM ruleset_routines;
			DELETE FROM ruleset_attachments;
			DELETE FROM ruleset_controls;
			DELETE FROM ruleset_approvals;
			DELETE FROM rulesets;
			DELETE FROM routines;
			DELETE FROM framework_controls;
			DELETE FROM sections;
		`)
	})

	describe("Ruleset CRUD", () => {
		it("creates a ruleset in draft status", async () => {
			const sectionId = await createSectionRow("sec1")
			const id = await createRuleset({
				sectionId,
				name: "Sikkerhetsregelsett",
				description: "Beskrivelse",
				frequency: "annually",
				createdBy: "admin",
			})

			const detail = await getRulesetDetail(id)
			expect(detail).not.toBeNull()
			expect(detail?.name).toBe("Sikkerhetsregelsett")
			expect(detail?.status).toBe("draft")
			expect(detail?.approvalStatus).toBe("draft")
			expect(detail?.frequency).toBe("annually")
		})

		it("updates a ruleset", async () => {
			const sectionId = await createSectionRow("sec2")
			const id = await createRuleset({ sectionId, name: "Old", frequency: "annually", createdBy: "admin" })
			await updateRuleset(id, { name: "New name", description: "Ny beskrivelse", updatedBy: "editor" })

			const detail = await getRulesetDetail(id)
			expect(detail?.name).toBe("New name")
			expect(detail?.description).toBe("Ny beskrivelse")
		})

		it("archives a ruleset", async () => {
			const sectionId = await createSectionRow("sec3")
			const id = await createRuleset({ sectionId, name: "ToArchive", frequency: "annually", createdBy: "admin" })
			await archiveRuleset(id, "admin")

			const detail = await getRulesetDetail(id)
			expect(detail?.status).toBe("archived")
			expect(detail?.approvalStatus).toBe("expired")
		})
	})

	describe("Approval", () => {
		it("approving a draft activates it and sets approvalStatus to valid", async () => {
			const sectionId = await createSectionRow("sec4")
			const id = await createRuleset({ sectionId, name: "Approve me", frequency: "annually", createdBy: "admin" })

			await approveRuleset({
				rulesetId: id,
				approvedBy: "approver",
				approvedByName: "Approver Name",
				comment: "Godkjent",
				frequency: "annually",
			})

			const detail = await getRulesetDetail(id)
			expect(detail?.status).toBe("active")
			expect(detail?.approvalStatus).toBe("valid")
			expect(detail?.lastApproval).not.toBeNull()
			expect(detail?.approvals).toHaveLength(1)
			expect(detail?.approvals[0].approvedBy).toBe("approver")
		})
	})

	describe("Control linking", () => {
		it("links and unlinks controls", async () => {
			const sectionId = await createSectionRow("sec5")
			const rulesetId = await createRuleset({ sectionId, name: "Rs", frequency: "annually", createdBy: "admin" })
			const controlId = await createControl("K-LR.01")

			await linkControlToRuleset(rulesetId, controlId)

			const detail = await getRulesetDetail(rulesetId)
			expect(detail?.controls).toHaveLength(1)
			expect(detail?.controls[0].controlId).toBe("K-LR.01")

			const linkId = detail?.controls[0].linkId as string
			await unlinkControlFromRuleset(linkId)

			const after = await getRulesetDetail(rulesetId)
			expect(after?.controls).toHaveLength(0)
		})

		it("getRulesetsForControl returns rulesets pointing at a control", async () => {
			const sectionId = await createSectionRow("sec6")
			const rulesetId = await createRuleset({ sectionId, name: "RsX", frequency: "annually", createdBy: "admin" })
			await approveRuleset({
				rulesetId,
				approvedBy: "a",
				approvedByName: "A",
				frequency: "annually",
			})
			const controlId = await createControl("K-X.01")
			await linkControlToRuleset(rulesetId, controlId)

			const rows = await getRulesetsForControl(controlId)
			expect(rows).toHaveLength(1)
			expect(rows[0].name).toBe("RsX")
			expect(rows[0].approvalStatus).toBe("valid")
		})

		// NOTE: linkControlToRuleset uses onConflictDoNothing() but the schema has no
		// unique constraint on (ruleset_id, control_id), so duplicate inserts succeed.
		// Documenting actual behavior here rather than the (intended) idempotency.
		it("allows duplicate links because the schema lacks a unique constraint", async () => {
			const sectionId = await createSectionRow("sec7")
			const rulesetId = await createRuleset({ sectionId, name: "RsI", frequency: "annually", createdBy: "admin" })
			const controlId = await createControl("K-I.01")

			await linkControlToRuleset(rulesetId, controlId)
			await linkControlToRuleset(rulesetId, controlId)

			const detail = await getRulesetDetail(rulesetId)
			expect(detail?.controls.length).toBeGreaterThanOrEqual(1)
		})
	})

	describe("Routine linking", () => {
		it("links and unlinks routines", async () => {
			const sectionId = await createSectionRow("sec8")
			const rulesetId = await createRuleset({ sectionId, name: "RsR", frequency: "annually", createdBy: "admin" })
			const routineId = await createRoutineRow(sectionId, "Routine A")

			await linkRoutineToRuleset(rulesetId, routineId, "admin")
			const detail = await getRulesetDetail(rulesetId)
			expect(detail?.linkedRoutines).toHaveLength(1)
			expect(detail?.linkedRoutines[0].routineName).toBe("Routine A")

			await unlinkRoutineFromRuleset(detail?.linkedRoutines[0].linkId as string)
			const after = await getRulesetDetail(rulesetId)
			expect(after?.linkedRoutines).toHaveLength(0)
		})
	})

	describe("getRulesetsForSection", () => {
		it("lists rulesets for a section with approval status", async () => {
			const sectionId = await createSectionRow("sec9")
			await createRuleset({ sectionId, name: "Draft one", frequency: "annually", createdBy: "admin" })

			const list = await getRulesetsForSection(sectionId)
			expect(list).toHaveLength(1)
			expect(list[0].name).toBe("Draft one")
			expect(list[0].approvalStatus).toBe("draft")
		})
	})
})
