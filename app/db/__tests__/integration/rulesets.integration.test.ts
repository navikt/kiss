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
	createRuleset,
	updateRuleset,
	archiveRuleset,
	unarchiveRuleset,
	approveRuleset,
	linkControlToRuleset,
	unlinkControlFromRuleset,
	getRulesetsForSection,
	getRulesetDetail,
	getRulesetsForControl,
	getRulesetsLinkedToControls,
	linkRoutineToRuleset,
	unlinkRoutineFromRuleset,
	getRulesetIdsSelectedByApp,
	getRulesetsSelectedByApp,
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
			DELETE FROM screening_answers;
			DELETE FROM screening_questions;
			DELETE FROM monitored_applications;
			DELETE FROM ruleset_routines;
			DELETE FROM ruleset_attachments;
			DELETE FROM ruleset_controls;
			DELETE FROM ruleset_approvals;
			DELETE FROM rulesets;
			DELETE FROM routines;
			DELETE FROM control_technology_elements;
			DELETE FROM framework_controls;
			DELETE FROM sections;
			DELETE FROM audit_log;
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
			const archived = await archiveRuleset(id, "admin")
			expect(archived?.id).toBe(id)
			expect(archived?.archivedAt).toBeInstanceOf(Date)
			expect(archived?.archivedBy).toBe("admin")

			const detail = await getRulesetDetail(id)
			expect(detail?.status).toBe("archived")
			expect(detail?.approvalStatus).toBe("expired")

			// Skjult fra oversikten
			const list = await getRulesetsForSection(sectionId)
			expect(list.map((r) => r.id)).not.toContain(id)

			// Audit
			const db = getTestDb()
			const r = await db.execute(
				/* sql */ `SELECT action, performed_by FROM audit_log WHERE entity_id = '${id}' AND action = 'ruleset_archived'`,
			)
			expect(r.rows).toHaveLength(1)
			expect((r.rows[0] as { performed_by: string }).performed_by).toBe("admin")
		})

		it("er idempotent: re-arkivering skriver ikke nytt audit", async () => {
			const sectionId = await createSectionRow("sec3b")
			const id = await createRuleset({ sectionId, name: "Idem", frequency: "annually", createdBy: "admin" })
			await archiveRuleset(id, "admin")
			await archiveRuleset(id, "admin")

			const db = getTestDb()
			const r = await db.execute(
				/* sql */ `SELECT id FROM audit_log WHERE entity_id = '${id}' AND action = 'ruleset_archived'`,
			)
			expect(r.rows).toHaveLength(1)
		})

		it("archiveRuleset returnerer null for ukjent id", async () => {
			const r = await archiveRuleset("00000000-0000-0000-0000-000000000000", "u")
			expect(r).toBeNull()
		})

		it("reaktiverer arkivert regelsett uten godkjenning som draft", async () => {
			const sectionId = await createSectionRow("sec3c")
			const id = await createRuleset({ sectionId, name: "ReDraft", frequency: "annually", createdBy: "admin" })
			await archiveRuleset(id, "admin")
			const r = await unarchiveRuleset(id, "operator")
			expect(r?.archivedAt).toBeNull()
			expect(r?.archivedBy).toBeNull()
			expect(r?.status).toBe("draft")

			const detail = await getRulesetDetail(id)
			expect(detail?.status).toBe("draft")

			const db = getTestDb()
			const audit = await db.execute(
				/* sql */ `SELECT performed_by FROM audit_log WHERE entity_id = '${id}' AND action = 'ruleset_unarchived'`,
			)
			expect(audit.rows).toHaveLength(1)
			expect((audit.rows[0] as { performed_by: string }).performed_by).toBe("operator")
		})

		it("reaktiverer arkivert regelsett med godkjenning som active", async () => {
			const sectionId = await createSectionRow("sec3d")
			const id = await createRuleset({ sectionId, name: "ReActive", frequency: "annually", createdBy: "admin" })
			await approveRuleset({
				rulesetId: id,
				approvedBy: "a",
				approvedByName: "A",
				frequency: "annually",
			})
			await archiveRuleset(id, "admin")
			const r = await unarchiveRuleset(id, "operator")
			expect(r?.status).toBe("active")
		})

		it("er idempotent: re-aktivering skriver ikke nytt audit", async () => {
			const sectionId = await createSectionRow("sec3e")
			const id = await createRuleset({ sectionId, name: "ReIdem", frequency: "annually", createdBy: "admin" })
			await archiveRuleset(id, "admin")
			await unarchiveRuleset(id, "u")
			await unarchiveRuleset(id, "u")

			const db = getTestDb()
			const r = await db.execute(
				/* sql */ `SELECT id FROM audit_log WHERE entity_id = '${id}' AND action = 'ruleset_unarchived'`,
			)
			expect(r.rows).toHaveLength(1)
		})

		it("unarchiveRuleset returnerer null for ukjent id", async () => {
			const r = await unarchiveRuleset("00000000-0000-0000-0000-000000000000", "u")
			expect(r).toBeNull()
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

			await linkControlToRuleset(rulesetId, controlId, "test-user")

			const detail = await getRulesetDetail(rulesetId)
			expect(detail?.controls).toHaveLength(1)
			expect(detail?.controls[0].controlId).toBe("K-LR.01")

			const linkId = detail?.controls[0].linkId as string
			await unlinkControlFromRuleset(rulesetId, linkId, "test-user")

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
			await linkControlToRuleset(rulesetId, controlId, "test-user")

			const rows = await getRulesetsForControl(controlId)
			expect(rows).toHaveLength(1)
			expect(rows[0].name).toBe("RsX")
			expect(rows[0].approvalStatus).toBe("valid")
		})

		// SD6: linkControlToRuleset performs an explicit existence check under FOR UPDATE
		// lock and returns idempotently when a link already exists, so a second call must
		// not create a duplicate row even though the schema still lacks a unique constraint.
		it("is idempotent when the same control is linked twice", async () => {
			const sectionId = await createSectionRow("sec7")
			const rulesetId = await createRuleset({ sectionId, name: "RsI", frequency: "annually", createdBy: "admin" })
			const controlId = await createControl("K-I.01")

			await linkControlToRuleset(rulesetId, controlId, "test-user")
			await linkControlToRuleset(rulesetId, controlId, "test-user")

			const detail = await getRulesetDetail(rulesetId)
			expect(detail?.controls).toHaveLength(1)
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

			await unlinkRoutineFromRuleset(rulesetId, detail?.linkedRoutines[0].linkId as string, "test-user")
			const after = await getRulesetDetail(rulesetId)
			expect(after?.linkedRoutines).toHaveLength(0)
		})
	})

	describe("Archived guards on related mutations", () => {
		it("updateRuleset returns false on archived ruleset", async () => {
			const sectionId = await createSectionRow("secG1")
			const id = await createRuleset({ sectionId, name: "X", frequency: "annually", createdBy: "admin" })
			await archiveRuleset(id, "admin")
			const ok = await updateRuleset(id, { name: "Forbidden", updatedBy: "admin" })
			expect(ok).toBe(false)
			const detail = await getRulesetDetail(id)
			expect(detail?.name).toBe("X")
		})

		it("approveRuleset returns null on archived ruleset", async () => {
			const sectionId = await createSectionRow("secG2")
			const id = await createRuleset({ sectionId, name: "Y", frequency: "annually", createdBy: "admin" })
			await archiveRuleset(id, "admin")
			const approvalId = await approveRuleset({
				rulesetId: id,
				approvedBy: "admin",
				approvedByName: "Admin",
				frequency: "annually",
			})
			expect(approvalId).toBeNull()
		})

		it("linkControlToRuleset and unlinkControlFromRuleset are blocked when archived", async () => {
			const sectionId = await createSectionRow("secG3")
			const id = await createRuleset({ sectionId, name: "Z", frequency: "annually", createdBy: "admin" })
			const controlA = await createControl("K-AA.01")
			const controlB = await createControl("K-AA.02")
			expect(await linkControlToRuleset(id, controlA, "test-user")).toBe(true)
			await archiveRuleset(id, "admin")
			expect(await linkControlToRuleset(id, controlB, "test-user")).toBe(false)
			const detail = await getRulesetDetail(id)
			const link = detail?.controls.find((c) => c.id === controlA)
			expect(await unlinkControlFromRuleset(id, link?.linkId as string, "test-user")).toBe(false)
		})

		it("linkRoutineToRuleset and unlinkRoutineFromRuleset are blocked when archived", async () => {
			const sectionId = await createSectionRow("secG4")
			const id = await createRuleset({ sectionId, name: "W", frequency: "annually", createdBy: "admin" })
			const routineA = await createRoutineRow(sectionId, "Routine X")
			const routineB = await createRoutineRow(sectionId, "Routine Y")
			expect(await linkRoutineToRuleset(id, routineA, "admin")).toBe(true)
			await archiveRuleset(id, "admin")
			expect(await linkRoutineToRuleset(id, routineB, "admin")).toBe(false)
			const detail = await getRulesetDetail(id)
			const link = detail?.linkedRoutines[0]
			expect(await unlinkRoutineFromRuleset(id, link?.linkId as string, "test-user")).toBe(false)
		})

		it("linkRoutineToRuleset rejects routine from a different section", async () => {
			const sectionA = await createSectionRow("secG6a")
			const sectionB = await createSectionRow("secG6b")
			const rulesetA = await createRuleset({
				sectionId: sectionA,
				name: "RA",
				frequency: "annually",
				createdBy: "admin",
			})
			const routineInB = await createRoutineRow(sectionB, "Routine in B")

			expect(await linkRoutineToRuleset(rulesetA, routineInB, "admin")).toBe(false)
			const detail = await getRulesetDetail(rulesetA)
			expect(detail?.linkedRoutines).toHaveLength(0)
		})

		it("linkRoutineToRuleset rejects archived routine in same section", async () => {
			const sectionId = await createSectionRow("secG7")
			const ruleset = await createRuleset({
				sectionId,
				name: "R-arch-routine",
				frequency: "annually",
				createdBy: "admin",
			})
			const routineId = await createRoutineRow(sectionId, "Routine to archive")
			const db = getTestDb()
			await db.execute(
				/* sql */ `UPDATE routines SET archived_at = NOW(), archived_by = 'admin' WHERE id = '${routineId}'`,
			)

			expect(await linkRoutineToRuleset(ruleset, routineId, "admin")).toBe(false)
			const detail = await getRulesetDetail(ruleset)
			expect(detail?.linkedRoutines).toHaveLength(0)
		})

		it("unlink is idempotent and rejects cross-resource link IDs", async () => {
			const sectionId = await createSectionRow("secG5")
			const rsA = await createRuleset({ sectionId, name: "A", frequency: "annually", createdBy: "admin" })
			const rsB = await createRuleset({ sectionId, name: "B", frequency: "annually", createdBy: "admin" })
			const ctrl = await createControl("K-CR.01")
			expect(await linkControlToRuleset(rsA, ctrl, "test-user")).toBe(true)
			const detailA = await getRulesetDetail(rsA)
			const linkInA = detailA?.controls[0].linkId as string

			// Cross-resource: prøver å unlinke A's link via rsB → ingen sletting,
			// men returnerer true (idempotent — linken finnes ikke i rsB).
			expect(await unlinkControlFromRuleset(rsB, linkInA, "test-user")).toBe(true)
			const stillLinked = await getRulesetDetail(rsA)
			expect(stillLinked?.controls).toHaveLength(1)

			// Korrekt unlink
			expect(await unlinkControlFromRuleset(rsA, linkInA, "test-user")).toBe(true)
			// Idempotent — andre kall returnerer fortsatt true selv om link er borte.
			expect(await unlinkControlFromRuleset(rsA, linkInA, "test-user")).toBe(true)
		})
	})

	describe("Approval guards on related mutations", () => {
		it("blocks non-admin style update when ruleset has approvals", async () => {
			const sectionId = await createSectionRow("secA1")
			const id = await createRuleset({ sectionId, name: "A", frequency: "annually", createdBy: "admin" })
			await approveRuleset({
				rulesetId: id,
				approvedBy: "admin",
				approvedByName: "Admin",
				frequency: "annually",
			})

			expect(
				await updateRuleset(id, { name: "Skal ikke lagres", updatedBy: "section-user", requireUnapproved: true }),
			).toBe(false)
			expect(await updateRuleset(id, { name: "Admin kan lagre", updatedBy: "admin" })).toBe(true)
		})

		it("blocks control link/unlink when requireUnapproved is set and ruleset has approvals", async () => {
			const sectionId = await createSectionRow("secA2")
			const id = await createRuleset({ sectionId, name: "B", frequency: "annually", createdBy: "admin" })
			const controlA = await createControl("K-AP.01")
			const controlB = await createControl("K-AP.02")
			expect(await linkControlToRuleset(id, controlA, "admin")).toBe(true)
			await approveRuleset({
				rulesetId: id,
				approvedBy: "admin",
				approvedByName: "Admin",
				frequency: "annually",
			})

			expect(await linkControlToRuleset(id, controlB, "section-user", { requireUnapproved: true })).toBe(false)
			const detail = await getRulesetDetail(id)
			const linkId = detail?.controls.find((c) => c.id === controlA)?.linkId as string
			expect(await unlinkControlFromRuleset(id, linkId, "section-user", { requireUnapproved: true })).toBe(false)
			expect(await unlinkControlFromRuleset(id, linkId, "admin")).toBe(true)
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

	describe("SD6 audit logging on link tables", () => {
		it("writes audit on linking and unlinking a control, and is silent on no-ops", async () => {
			const { getAuditLogForEntity } = await import("~/db/queries/audit.server")
			const sectionId = await createSectionRow("audCtrl1")
			const rulesetId = await createRuleset({ sectionId, name: "Aud", frequency: "annually", createdBy: "admin" })
			const controlId = await createControl("K-AUD.01")

			expect(await linkControlToRuleset(rulesetId, controlId, "alice")).toBe(true)
			// Re-link of an existing control must not write a second audit row.
			expect(await linkControlToRuleset(rulesetId, controlId, "alice")).toBe(true)

			let log = await getAuditLogForEntity("ruleset_control", rulesetId)
			expect(log.filter((r) => r.action === "ruleset_control_added")).toHaveLength(1)
			expect(log[0].performedBy).toBe("alice")

			const detail = await getRulesetDetail(rulesetId)
			const linkId = detail?.controls[0].linkId as string
			expect(await unlinkControlFromRuleset(rulesetId, linkId, "bob")).toBe(true)
			// Unlink of an already-removed link must not emit a removed-audit.
			expect(await unlinkControlFromRuleset(rulesetId, linkId, "bob")).toBe(true)

			log = await getAuditLogForEntity("ruleset_control", rulesetId)
			expect(log.filter((r) => r.action === "ruleset_control_removed")).toHaveLength(1)
		})

		it("writes audit on linking and unlinking a routine, and is silent on no-ops", async () => {
			const { getAuditLogForEntity } = await import("~/db/queries/audit.server")
			const sectionId = await createSectionRow("audRtn1")
			const rulesetId = await createRuleset({ sectionId, name: "AudR", frequency: "annually", createdBy: "admin" })
			const routineId = await createRoutineRow(sectionId, "Audited routine")

			expect(await linkRoutineToRuleset(rulesetId, routineId, "alice")).toBe(true)
			expect(await linkRoutineToRuleset(rulesetId, routineId, "alice")).toBe(true)

			let log = await getAuditLogForEntity("ruleset_routine", rulesetId)
			expect(log.filter((r) => r.action === "ruleset_routine_added")).toHaveLength(1)

			const detail = await getRulesetDetail(rulesetId)
			const linkId = detail?.linkedRoutines[0].linkId as string
			expect(await unlinkRoutineFromRuleset(rulesetId, linkId, "bob")).toBe(true)
			expect(await unlinkRoutineFromRuleset(rulesetId, linkId, "bob")).toBe(true)

			log = await getAuditLogForEntity("ruleset_routine", rulesetId)
			expect(log.filter((r) => r.action === "ruleset_routine_removed")).toHaveLength(1)
		})
	})

	describe("getRulesetsLinkedToControls", () => {
		it("returns rulesets that share controls with given control IDs", async () => {
			const sectionId = await createSectionRow("sec1")
			const controlId1 = await createControl("K-ST.01")
			const controlId2 = await createControl("K-ST.02")

			const rulesetId = await createRuleset({
				sectionId,
				name: "Shared Ruleset",
				frequency: "quarterly",
				createdBy: "test",
			})
			await linkControlToRuleset(rulesetId, controlId1, "test")
			await linkControlToRuleset(rulesetId, controlId2, "test")

			const result = await getRulesetsLinkedToControls([controlId1], sectionId)
			expect(result).toHaveLength(1)
			expect(result[0].name).toBe("Shared Ruleset")
			expect(result[0].controls).toHaveLength(2)
			expect(result[0].controls.map((c) => c.controlId)).toContain("K-ST.01")
			expect(result[0].controls.map((c) => c.controlId)).toContain("K-ST.02")
		})

		it("returns empty array when no controlIds provided", async () => {
			const sectionId = await createSectionRow("sec1")
			const result = await getRulesetsLinkedToControls([], sectionId)
			expect(result).toEqual([])
		})

		it("excludes archived rulesets", async () => {
			const sectionId = await createSectionRow("sec1")
			const controlId = await createControl("K-ST.01")

			const rulesetId = await createRuleset({
				sectionId,
				name: "Archived RS",
				frequency: "quarterly",
				createdBy: "test",
			})
			await linkControlToRuleset(rulesetId, controlId, "test")
			await archiveRuleset(rulesetId, "test")

			const result = await getRulesetsLinkedToControls([controlId], sectionId)
			expect(result).toHaveLength(0)
		})

		it("excludes archived control links", async () => {
			const sectionId = await createSectionRow("sec1")
			const controlId = await createControl("K-ST.01")

			const rulesetId = await createRuleset({ sectionId, name: "RS", frequency: "quarterly", createdBy: "test" })
			await linkControlToRuleset(rulesetId, controlId, "test")

			const detail = await getRulesetDetail(rulesetId)
			const linkId = detail?.controls[0].linkId as string
			await unlinkControlFromRuleset(rulesetId, linkId, "test")

			const result = await getRulesetsLinkedToControls([controlId], sectionId)
			expect(result).toHaveLength(0)
		})

		it("enriches with approval status", async () => {
			const sectionId = await createSectionRow("sec1")
			const controlId = await createControl("K-ST.01")

			const rulesetId = await createRuleset({
				sectionId,
				name: "Approved RS",
				frequency: "quarterly",
				createdBy: "test",
			})
			await linkControlToRuleset(rulesetId, controlId, "test")

			await approveRuleset({
				rulesetId,
				approvedBy: "test",
				approvedByName: "Test User",
				frequency: "quarterly",
			})

			const result = await getRulesetsLinkedToControls([controlId], sectionId)
			expect(result).toHaveLength(1)
			expect(result[0].approvalStatus).toBe("valid")
			expect(result[0].lastApproval).not.toBeNull()
			expect(result[0].lastApproval?.validUntil).toBeDefined()
		})

		it("does not return rulesets from other sections", async () => {
			const sectionId1 = await createSectionRow("sec1")
			const sectionId2 = await createSectionRow("sec2")
			const controlId = await createControl("K-ST.01")

			const rulesetId = await createRuleset({
				sectionId: sectionId2,
				name: "Other Section RS",
				frequency: "quarterly",
				createdBy: "test",
			})
			await linkControlToRuleset(rulesetId, controlId, "test")

			const result = await getRulesetsLinkedToControls([controlId], sectionId1)
			expect(result).toHaveLength(0)
		})
	})

	describe("getRulesetIdsSelectedByApp", () => {
		async function createApp(name: string) {
			const db = getTestDb()
			const r = await db.execute(
				/* sql */ `INSERT INTO monitored_applications (name, created_by, updated_by) VALUES ('${name}', 'test', 'test') RETURNING id`,
			)
			return (r.rows[0] as { id: string }).id
		}

		async function createScreeningQuestion(sectionId: string, rulesetId: string | null, answerType = "boolean") {
			const db = getTestDb()
			const rulesetVal = rulesetId ? `'${rulesetId}'` : "NULL"
			const r = await db.execute(
				/* sql */ `INSERT INTO screening_questions (section_id, ruleset_id, question_text, answer_type, status, created_by, updated_by)
				VALUES ('${sectionId}', ${rulesetVal}, 'Test question', '${answerType}', 'approved', 'test', 'test') RETURNING id`,
			)
			return (r.rows[0] as { id: string }).id
		}

		async function answerQuestion(appId: string, questionId: string, answer: string) {
			const db = getTestDb()
			await db.execute(
				/* sql */ `INSERT INTO screening_answers (application_id, question_id, answer, answered_by) VALUES ('${appId}', '${questionId}', '${answer}', 'test')`,
			)
		}

		it("returns empty set when app has no screening answers", async () => {
			const appId = await createApp("TestApp")
			const result = await getRulesetIdsSelectedByApp(appId)
			expect(result.size).toBe(0)
		})

		it("includes rulesetId from answered questions linked to a ruleset", async () => {
			const sectionId = await createSectionRow("sec-screen1")
			const rulesetId = await createRuleset({ sectionId, name: "RS1", frequency: "annually", createdBy: "test" })
			const appId = await createApp("App1")
			const questionId = await createScreeningQuestion(sectionId, rulesetId)
			await answerQuestion(appId, questionId, "ja")

			const result = await getRulesetIdsSelectedByApp(appId)
			expect(result.has(rulesetId)).toBe(true)
		})

		it("includes ruleset selected via answerType=ruleset (answer IS the ruleset ID)", async () => {
			const sectionId = await createSectionRow("sec-screen2")
			const rulesetId = await createRuleset({ sectionId, name: "RS2", frequency: "annually", createdBy: "test" })
			const appId = await createApp("App2")
			const questionId = await createScreeningQuestion(sectionId, null, "ruleset")
			await answerQuestion(appId, questionId, rulesetId)

			const result = await getRulesetIdsSelectedByApp(appId)
			expect(result.has(rulesetId)).toBe(true)
		})

		it("excludes rulesets not linked to any answered question", async () => {
			const sectionId = await createSectionRow("sec-screen3")
			const rulesetA = await createRuleset({ sectionId, name: "RSA", frequency: "annually", createdBy: "test" })
			const rulesetB = await createRuleset({ sectionId, name: "RSB", frequency: "annually", createdBy: "test" })
			const appId = await createApp("App3")
			const questionId = await createScreeningQuestion(sectionId, rulesetA)
			await answerQuestion(appId, questionId, "ja")

			const result = await getRulesetIdsSelectedByApp(appId)
			expect(result.has(rulesetA)).toBe(true)
			expect(result.has(rulesetB)).toBe(false)
		})

		it("excludes archived screening questions", async () => {
			const sectionId = await createSectionRow("sec-screen4")
			const rulesetId = await createRuleset({ sectionId, name: "RS4", frequency: "annually", createdBy: "test" })
			const appId = await createApp("App4")
			const questionId = await createScreeningQuestion(sectionId, rulesetId)
			await answerQuestion(appId, questionId, "ja")

			// Archive the question
			const db = getTestDb()
			await db.execute(
				/* sql */ `UPDATE screening_questions SET archived_at = NOW(), archived_by = 'test' WHERE id = '${questionId}'`,
			)

			const result = await getRulesetIdsSelectedByApp(appId)
			expect(result.has(rulesetId)).toBe(false)
		})

		it("resolves primaryApplicationId inheritance (child reads from parent screening)", async () => {
			const sectionId = await createSectionRow("sec-screen5")
			const rulesetId = await createRuleset({ sectionId, name: "RS5", frequency: "annually", createdBy: "test" })
			const parentId = await createApp("ParentApp")
			const db = getTestDb()
			const childResult = await db.execute(
				/* sql */ `INSERT INTO monitored_applications (name, primary_application_id, created_by, updated_by) VALUES ('ChildApp', '${parentId}', 'test', 'test') RETURNING id`,
			)
			const childId = (childResult.rows[0] as { id: string }).id

			// Answer screening on parent
			const questionId = await createScreeningQuestion(sectionId, rulesetId)
			await answerQuestion(parentId, questionId, "ja")

			// Child should inherit parent's screening answers
			const result = await getRulesetIdsSelectedByApp(childId)
			expect(result.has(rulesetId)).toBe(true)
		})

		it("ignores invalid UUIDs in answerType=ruleset answers", async () => {
			const sectionId = await createSectionRow("sec-screen6")
			const appId = await createApp("App6")
			const questionId = await createScreeningQuestion(sectionId, null, "ruleset")
			// Answer with a non-UUID string (legacy/corrupt data)
			await answerQuestion(appId, questionId, "not-a-valid-uuid")

			const result = await getRulesetIdsSelectedByApp(appId)
			expect(result.size).toBe(0)
		})
	})

	describe("getRulesetsSelectedByApp", () => {
		async function createApp(name: string) {
			const db = getTestDb()
			const r = await db.execute(
				/* sql */ `INSERT INTO monitored_applications (name, created_by, updated_by) VALUES ('${name}', 'test', 'test') RETURNING id`,
			)
			return (r.rows[0] as { id: string }).id
		}

		async function createScreeningQuestion(sectionId: string, rulesetId: string | null, answerType = "boolean") {
			const db = getTestDb()
			const rulesetVal = rulesetId ? `'${rulesetId}'` : "NULL"
			const r = await db.execute(
				/* sql */ `INSERT INTO screening_questions (section_id, ruleset_id, question_text, answer_type, status, created_by, updated_by)
				VALUES ('${sectionId}', ${rulesetVal}, 'Test question', '${answerType}', 'approved', 'test', 'test') RETURNING id`,
			)
			return (r.rows[0] as { id: string }).id
		}

		async function answerQuestion(appId: string, questionId: string, answer: string) {
			const db = getTestDb()
			await db.execute(
				/* sql */ `INSERT INTO screening_answers (application_id, question_id, answer, answered_by) VALUES ('${appId}', '${questionId}', '${answer}', 'test')`,
			)
		}

		it("returns empty array when app has no screening answers", async () => {
			const appId = await createApp("DetailApp1")
			const result = await getRulesetsSelectedByApp(appId)
			expect(result).toHaveLength(0)
		})

		it("returns full ruleset details for selected rulesets", async () => {
			const sectionId = await createSectionRow("sec-detail1")
			const rulesetId = await createRuleset({
				sectionId,
				name: "Detail RS",
				description: "Test description",
				frequency: "annually",
				createdBy: "test",
			})
			const appId = await createApp("DetailApp2")
			const questionId = await createScreeningQuestion(sectionId, rulesetId)
			await answerQuestion(appId, questionId, "ja")

			const result = await getRulesetsSelectedByApp(appId)
			expect(result).toHaveLength(1)
			expect(result[0].id).toBe(rulesetId)
			expect(result[0].name).toBe("Detail RS")
			expect(result[0].description).toBe("Test description")
			expect(result[0].frequency).toBe("annually")
			expect(result[0].approvalStatus).toBe("draft")
			expect(result[0].sectionName).toBeDefined()
			expect(result[0].controls).toEqual([])
			expect(result[0].lastApproval).toBeNull()
		})

		it("excludes archived rulesets", async () => {
			const sectionId = await createSectionRow("sec-detail2")
			const rulesetId = await createRuleset({
				sectionId,
				name: "Archived RS",
				frequency: "annually",
				createdBy: "test",
			})
			const appId = await createApp("DetailApp3")
			const questionId = await createScreeningQuestion(sectionId, rulesetId)
			await answerQuestion(appId, questionId, "ja")

			await archiveRuleset(rulesetId, "test")

			const result = await getRulesetsSelectedByApp(appId)
			expect(result).toHaveLength(0)
		})

		it("includes controls linked to the ruleset", async () => {
			const sectionId = await createSectionRow("sec-detail3")
			const db = getTestDb()
			const controlResult = await db.execute(
				/* sql */ `INSERT INTO framework_controls (control_id, short_title, requirement)
				VALUES ('K-ST.99', 'Test kontroll', 'Test krav') RETURNING id`,
			)
			const controlId = (controlResult.rows[0] as { id: string }).id

			const rulesetId = await createRuleset({
				sectionId,
				name: "RS with controls",
				frequency: "quarterly",
				createdBy: "test",
			})
			await linkControlToRuleset(rulesetId, controlId, "test")

			const appId = await createApp("DetailApp4")
			const questionId = await createScreeningQuestion(sectionId, rulesetId)
			await answerQuestion(appId, questionId, "ja")

			const result = await getRulesetsSelectedByApp(appId)
			expect(result).toHaveLength(1)
			expect(result[0].controls).toHaveLength(1)
			expect(result[0].controls[0].controlId).toBe("K-ST.99")
		})

		it("includes approval status and lastApproval when approved", async () => {
			const sectionId = await createSectionRow("sec-detail4")
			const rulesetId = await createRuleset({
				sectionId,
				name: "Approved RS",
				frequency: "annually",
				createdBy: "test",
			})
			await approveRuleset({
				rulesetId,
				approvedBy: "test",
				approvedByName: "Test User",
				frequency: "annually",
			})

			const appId = await createApp("DetailApp5")
			const questionId = await createScreeningQuestion(sectionId, rulesetId)
			await answerQuestion(appId, questionId, "ja")

			const result = await getRulesetsSelectedByApp(appId)
			expect(result).toHaveLength(1)
			expect(result[0].approvalStatus).toBe("valid")
			expect(result[0].lastApproval).not.toBeNull()
		})
	})
})
