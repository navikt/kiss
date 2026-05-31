/**
 * Integration tests for routine replacement link propagation and review inheritance.
 *
 * Verifies that replaceRoutine() correctly:
 * - Updates screening_choice_effects.preset_routine_id A→B
 * - Updates screening_routine_selections.routine_id A→B
 * - Updates application_controls.matching_routine_ids A→B
 * - Copies latest review from A to B when deadlinePolicy="continue" (inherited review)
 * - Does NOT copy reviews when deadlinePolicy="reset"
 *
 * Also verifies migrateExistingReplacementChains():
 * - Fixes stale links for pre-existing chains
 * - Handles transitive chains (A→B→C)
 * - Is idempotent (safe to call multiple times)
 */
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

// Import AFTER mocking
const {
	createRoutine,
	copyRoutine,
	replaceRoutine,
	migrateExistingReplacementChains,
	getLatestReviewForApp,
	getLatestSectionReview,
} = await import("~/db/queries/routines.server")
const { createSection } = await import("~/db/queries/sections.server")

// ─── Helpers ────────────────────────────────────────────────────────────────

async function copyRoutineOrThrow(routineId: string, performedBy = "Z990001") {
	const result = await copyRoutine(routineId, performedBy)
	if (!result) throw new Error(`copyRoutine returned null for routineId=${routineId}`)
	return result
}

async function createTestApp(name: string) {
	const db = getTestDb()
	const r = await db.execute(
		/* sql */ `INSERT INTO monitored_applications (name, created_by, updated_by) VALUES ('${name}', 'Z990001', 'Z990001') RETURNING id`,
	)
	return (r.rows[0] as { id: string }).id
}

async function createFrameworkControl() {
	const db = getTestDb()
	const r = await db.execute(
		/* sql */ `INSERT INTO framework_controls (control_id) VALUES ('K-TEST.${Date.now()}') RETURNING id`,
	)
	return (r.rows[0] as { id: string }).id
}

async function makeRoutineReady(routineId: string) {
	const db = getTestDb()
	await db.execute(/* sql */ `UPDATE routines SET status = 'ready', updated_by = 'Z990001' WHERE id = '${routineId}'`)
}

async function insertCompletedReview(routineId: string, applicationId: string | null, reviewedAt: Date) {
	const db = getTestDb()
	const appVal = applicationId ? `'${applicationId}'` : "NULL"
	const r = await db.execute(
		/* sql */ `INSERT INTO routine_reviews (routine_id, application_id, title, reviewed_at, status, created_by)
		VALUES ('${routineId}', ${appVal}, 'Test Review', '${reviewedAt.toISOString()}', 'completed', 'Z990001')
		RETURNING id`,
	)
	return (r.rows[0] as { id: string }).id
}

async function insertNeedsFollowUpReview(routineId: string, applicationId: string | null, reviewedAt: Date) {
	const db = getTestDb()
	const appVal = applicationId ? `'${applicationId}'` : "NULL"
	const r = await db.execute(
		/* sql */ `INSERT INTO routine_reviews (routine_id, application_id, title, reviewed_at, status, created_by)
		VALUES ('${routineId}', ${appVal}, 'Follow Up Review', '${reviewedAt.toISOString()}', 'needs_follow_up', 'Z990001')
		RETURNING id`,
	)
	return (r.rows[0] as { id: string }).id
}

async function insertPresetRoutineEffect(controlId: string, routineId: string) {
	const db = getTestDb()
	// Create a minimal screening question + choice + effect
	const qR = await db.execute(
		/* sql */ `INSERT INTO screening_questions (section_id, question_text, answer_type, created_by, updated_by) 
		VALUES ((SELECT id FROM sections LIMIT 1), 'Test Question', 'boolean', 'Z990001', 'Z990001') RETURNING id`,
	)
	const qId = (qR.rows[0] as { id: string }).id
	const cR = await db.execute(
		/* sql */ `INSERT INTO screening_question_choices (question_id, label) VALUES ('${qId}', 'Yes') RETURNING id`,
	)
	const choiceId = (cR.rows[0] as { id: string }).id
	const eR = await db.execute(
		/* sql */ `INSERT INTO screening_choice_effects (choice_id, control_id, effect, preset_routine_id)
		VALUES ('${choiceId}', '${controlId}', 'preset_routine', '${routineId}') RETURNING id`,
	)
	return (eR.rows[0] as { id: string }).id
}

async function insertScreeningRoutineSelection(appId: string, choiceEffectId: string, routineId: string) {
	const db = getTestDb()
	const r = await db.execute(
		/* sql */ `INSERT INTO screening_routine_selections (application_id, choice_effect_id, routine_id, selected_by)
		VALUES ('${appId}', '${choiceEffectId}', '${routineId}', 'Z990001') RETURNING id`,
	)
	return (r.rows[0] as { id: string }).id
}

async function insertApplicationControlsWithRoutine(appId: string, controlId: string, routineId: string) {
	const db = getTestDb()
	const r = await db.execute(
		/* sql */ `INSERT INTO application_controls (application_id, control_id, status, establishment, routine_compliance, routines_established, routines_completed, routines_overdue, match_sources, matching_routine_ids, is_screening_derived, created_by, updated_by)
		VALUES ('${appId}', '${controlId}', NULL, 'not_established', 'not_applicable', 0, 0, 0, '{}', ARRAY['${routineId}']::uuid[], false, 'Z990001', 'Z990001') RETURNING id`,
	)
	return (r.rows[0] as { id: string }).id
}

async function getPresetRoutineId(effectId: string): Promise<string | null> {
	const db = getTestDb()
	const r = await db.execute(
		/* sql */ `SELECT preset_routine_id FROM screening_choice_effects WHERE id = '${effectId}'`,
	)
	return (r.rows[0] as { preset_routine_id: string | null })?.preset_routine_id ?? null
}

async function getSelectionRoutineId(selectionId: string): Promise<string | null> {
	const db = getTestDb()
	const r = await db.execute(
		/* sql */ `SELECT routine_id FROM screening_routine_selections WHERE id = '${selectionId}'`,
	)
	return (r.rows[0] as { routine_id: string | null })?.routine_id ?? null
}

async function getMatchingRoutineIds(acId: string): Promise<string[]> {
	const db = getTestDb()
	const r = await db.execute(/* sql */ `SELECT matching_routine_ids FROM application_controls WHERE id = '${acId}'`)
	return (r.rows[0] as { matching_routine_ids: string[] })?.matching_routine_ids ?? []
}

async function getInheritedReviewCount(routineId: string): Promise<number> {
	const db = getTestDb()
	const r = await db.execute(
		/* sql */ `SELECT COUNT(*) as cnt FROM routine_reviews WHERE routine_id = '${routineId}' AND inherited_from_review_id IS NOT NULL`,
	)
	return Number((r.rows[0] as { cnt: string }).cnt)
}

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe("routine replacement link propagation", () => {
	let sectionId: string
	let appId: string
	let controlId: string

	beforeAll(async () => {
		await setupTestDatabase()
	}, 120_000)

	afterAll(async () => {
		await teardownTestDatabase()
	})

	beforeEach(async () => {
		const db = getTestDb()
		await db.execute(/* sql */ `
			DELETE FROM routine_review_participants;
			DELETE FROM routine_review_activities;
			DELETE FROM routine_review_links;
			DELETE FROM routine_review_attachments;
			DELETE FROM routine_reviews;
			DELETE FROM screening_routine_selections;
			DELETE FROM screening_choice_effects;
			DELETE FROM screening_question_choices;
			DELETE FROM screening_question_effects;
			DELETE FROM screening_questions;
			DELETE FROM application_controls;
			DELETE FROM routine_controls;
			DELETE FROM routine_screening_questions;
			DELETE FROM routine_persistence_links;
			DELETE FROM routine_technology_elements;
			DELETE FROM routine_group_classification_links;
			DELETE FROM routine_oracle_role_criticality_links;
			DELETE FROM ruleset_routines;
			DELETE FROM rulesets;
			DELETE FROM routines;
			DELETE FROM framework_risk_control_mappings;
			DELETE FROM framework_controls;
			DELETE FROM framework_risks;
			DELETE FROM framework_domains;
			DELETE FROM application_team_mappings;
			DELETE FROM monitored_applications;
			DELETE FROM dev_teams;
			DELETE FROM sections;
			DELETE FROM audit_log;
		`)
		sectionId = (await createSection("Test Section", null, "Z990001")).id
		appId = await createTestApp("Test App")
		controlId = await createFrameworkControl()
	})

	// ─── replaceRoutine: deadlinePolicy="reset" ────────────────────────────

	describe('replaceRoutine with deadlinePolicy="reset"', () => {
		it("updates preset_routine_id that existed before replacement", async () => {
			// Create A as approved
			const routineA = await createRoutine({
				sectionId,
				name: "Routine A",
				description: "Original",
				frequency: "quarterly",
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: "tech_manager",
				isSectionRoutine: false,
				sectionRoutineOwnerRole: null,
				persistenceLinks: [],
				technologyElementIds: [],
				controlIds: [],
				groupClassifications: [],
				oracleRoleCriticalities: [],
				createdBy: "Z990001",
			})
			const db = getTestDb()
			await db.execute(
				/* sql */ `UPDATE routines SET status = 'approved', updated_by = 'Z990001' WHERE id = '${routineA.id}'`,
			)

			const effectId = await insertPresetRoutineEffect(controlId, routineA.id)
			expect(await getPresetRoutineId(effectId)).toBe(routineA.id)

			// Now copy + replace
			const routineB = await copyRoutineOrThrow(routineA.id, "Z990001")
			await makeRoutineReady(routineB.id)
			await replaceRoutine(routineB.id, routineA.id, "reset", "Z990001")

			expect(await getPresetRoutineId(effectId)).toBe(routineB.id)
		})

		it("updates active screening_routine_selection from A to B", async () => {
			const routineA = await createRoutine({
				sectionId,
				name: "Routine A",
				description: "Original",
				frequency: "quarterly",
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: "tech_manager",
				isSectionRoutine: false,
				sectionRoutineOwnerRole: null,
				persistenceLinks: [],
				technologyElementIds: [],
				controlIds: [],
				groupClassifications: [],
				oracleRoleCriticalities: [],
				createdBy: "Z990001",
			})
			const db = getTestDb()
			await db.execute(
				/* sql */ `UPDATE routines SET status = 'approved', updated_by = 'Z990001' WHERE id = '${routineA.id}'`,
			)

			const effectId = await insertPresetRoutineEffect(controlId, routineA.id)
			const selectionId = await insertScreeningRoutineSelection(appId, effectId, routineA.id)
			expect(await getSelectionRoutineId(selectionId)).toBe(routineA.id)

			const routineB = await copyRoutineOrThrow(routineA.id, "Z990001")
			await makeRoutineReady(routineB.id)
			await replaceRoutine(routineB.id, routineA.id, "reset", "Z990001")

			expect(await getSelectionRoutineId(selectionId)).toBe(routineB.id)
		})

		it("updates matching_routine_ids in application_controls from A to B", async () => {
			const routineA = await createRoutine({
				sectionId,
				name: "Routine A",
				description: "Original",
				frequency: "quarterly",
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: "tech_manager",
				isSectionRoutine: false,
				sectionRoutineOwnerRole: null,
				persistenceLinks: [],
				technologyElementIds: [],
				controlIds: [],
				groupClassifications: [],
				oracleRoleCriticalities: [],
				createdBy: "Z990001",
			})
			const db = getTestDb()
			await db.execute(
				/* sql */ `UPDATE routines SET status = 'approved', updated_by = 'Z990001' WHERE id = '${routineA.id}'`,
			)

			const acId = await insertApplicationControlsWithRoutine(appId, controlId, routineA.id)
			expect(await getMatchingRoutineIds(acId)).toContain(routineA.id)

			const routineB = await copyRoutineOrThrow(routineA.id, "Z990001")
			await makeRoutineReady(routineB.id)
			await replaceRoutine(routineB.id, routineA.id, "reset", "Z990001")

			const ids = await getMatchingRoutineIds(acId)
			expect(ids).toContain(routineB.id)
			expect(ids).not.toContain(routineA.id)
		})

		it("does NOT copy reviews from A to B", async () => {
			const routineA = await createRoutine({
				sectionId,
				name: "Routine A",
				description: "Original",
				frequency: "quarterly",
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: "tech_manager",
				isSectionRoutine: false,
				sectionRoutineOwnerRole: null,
				persistenceLinks: [],
				technologyElementIds: [],
				controlIds: [],
				groupClassifications: [],
				oracleRoleCriticalities: [],
				createdBy: "Z990001",
			})
			const db = getTestDb()
			await db.execute(
				/* sql */ `UPDATE routines SET status = 'approved', updated_by = 'Z990001' WHERE id = '${routineA.id}'`,
			)
			await insertCompletedReview(routineA.id, appId, new Date("2025-01-01"))

			const routineB = await copyRoutineOrThrow(routineA.id, "Z990001")
			await makeRoutineReady(routineB.id)
			await replaceRoutine(routineB.id, routineA.id, "reset", "Z990001")

			const reviewB = await getLatestReviewForApp(routineB.id, appId)
			expect(reviewB).toBeNull()
		})
	})

	// ─── replaceRoutine: deadlinePolicy="continue" ─────────────────────────

	describe('replaceRoutine with deadlinePolicy="continue"', () => {
		it("copies latest completed review from A to B with inherited marker", async () => {
			const routineA = await createRoutine({
				sectionId,
				name: "Routine A",
				description: "Original",
				frequency: "quarterly",
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: "tech_manager",
				isSectionRoutine: false,
				sectionRoutineOwnerRole: null,
				persistenceLinks: [],
				technologyElementIds: [],
				controlIds: [],
				groupClassifications: [],
				oracleRoleCriticalities: [],
				createdBy: "Z990001",
			})
			const db = getTestDb()
			await db.execute(
				/* sql */ `UPDATE routines SET status = 'approved', updated_by = 'Z990001' WHERE id = '${routineA.id}'`,
			)
			const reviewDate = new Date("2025-06-15")
			await insertCompletedReview(routineA.id, appId, reviewDate)

			const routineB = await copyRoutineOrThrow(routineA.id, "Z990001")
			await makeRoutineReady(routineB.id)
			await replaceRoutine(routineB.id, routineA.id, "continue", "Z990001")

			const reviewB = await getLatestReviewForApp(routineB.id, appId)
			expect(reviewB).not.toBeNull()
			expect(reviewB?.reviewedAt.toISOString()).toBe(reviewDate.toISOString())
			expect(reviewB?.status).toBe("completed")
			expect(reviewB?.inheritedFromReviewId).not.toBeNull()
		})

		it("copies needs_follow_up review as completed (never as needs_follow_up)", async () => {
			const routineA = await createRoutine({
				sectionId,
				name: "Routine A",
				description: "Original",
				frequency: "quarterly",
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: "tech_manager",
				isSectionRoutine: false,
				sectionRoutineOwnerRole: null,
				persistenceLinks: [],
				technologyElementIds: [],
				controlIds: [],
				groupClassifications: [],
				oracleRoleCriticalities: [],
				createdBy: "Z990001",
			})
			const db = getTestDb()
			await db.execute(
				/* sql */ `UPDATE routines SET status = 'approved', updated_by = 'Z990001' WHERE id = '${routineA.id}'`,
			)
			await insertNeedsFollowUpReview(routineA.id, appId, new Date("2025-06-01"))

			const routineB = await copyRoutineOrThrow(routineA.id, "Z990001")
			await makeRoutineReady(routineB.id)
			await replaceRoutine(routineB.id, routineA.id, "continue", "Z990001")

			const reviewB = await getLatestReviewForApp(routineB.id, appId)
			expect(reviewB).not.toBeNull()
			expect(reviewB?.status).toBe("completed") // inherited always as completed
		})

		it("copies only the latest review when A has multiple reviews for same app", async () => {
			const routineA = await createRoutine({
				sectionId,
				name: "Routine A",
				description: "Original",
				frequency: "quarterly",
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: "tech_manager",
				isSectionRoutine: false,
				sectionRoutineOwnerRole: null,
				persistenceLinks: [],
				technologyElementIds: [],
				controlIds: [],
				groupClassifications: [],
				oracleRoleCriticalities: [],
				createdBy: "Z990001",
			})
			const db = getTestDb()
			await db.execute(
				/* sql */ `UPDATE routines SET status = 'approved', updated_by = 'Z990001' WHERE id = '${routineA.id}'`,
			)
			await insertCompletedReview(routineA.id, appId, new Date("2024-01-01"))
			const latestDate = new Date("2025-03-01")
			await insertCompletedReview(routineA.id, appId, latestDate)

			const routineB = await copyRoutineOrThrow(routineA.id, "Z990001")
			await makeRoutineReady(routineB.id)
			await replaceRoutine(routineB.id, routineA.id, "continue", "Z990001")

			expect(await getInheritedReviewCount(routineB.id)).toBe(1)
			const reviewB = await getLatestReviewForApp(routineB.id, appId)
			expect(reviewB?.reviewedAt.toISOString()).toBe(latestDate.toISOString())
		})

		it("skips copying if B already has its own review for that app", async () => {
			const routineA = await createRoutine({
				sectionId,
				name: "Routine A",
				description: "Original",
				frequency: "quarterly",
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: "tech_manager",
				isSectionRoutine: false,
				sectionRoutineOwnerRole: null,
				persistenceLinks: [],
				technologyElementIds: [],
				controlIds: [],
				groupClassifications: [],
				oracleRoleCriticalities: [],
				createdBy: "Z990001",
			})
			const db = getTestDb()
			await db.execute(
				/* sql */ `UPDATE routines SET status = 'approved', updated_by = 'Z990001' WHERE id = '${routineA.id}'`,
			)
			await insertCompletedReview(routineA.id, appId, new Date("2025-01-01"))

			const routineB = await copyRoutineOrThrow(routineA.id, "Z990001")
			// Insert B's own review before replacement
			const ownDate = new Date("2025-06-01")
			await insertCompletedReview(routineB.id, appId, ownDate)

			await makeRoutineReady(routineB.id)
			await replaceRoutine(routineB.id, routineA.id, "continue", "Z990001")

			// B should only have its own review, not an inherited one
			expect(await getInheritedReviewCount(routineB.id)).toBe(0)
			const reviewB = await getLatestReviewForApp(routineB.id, appId)
			expect(reviewB?.reviewedAt.toISOString()).toBe(ownDate.toISOString())
		})

		it("does not copy if A has no reviews", async () => {
			const routineA = await createRoutine({
				sectionId,
				name: "Routine A",
				description: "Original",
				frequency: "quarterly",
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: "tech_manager",
				isSectionRoutine: false,
				sectionRoutineOwnerRole: null,
				persistenceLinks: [],
				technologyElementIds: [],
				controlIds: [],
				groupClassifications: [],
				oracleRoleCriticalities: [],
				createdBy: "Z990001",
			})
			const db = getTestDb()
			await db.execute(
				/* sql */ `UPDATE routines SET status = 'approved', updated_by = 'Z990001' WHERE id = '${routineA.id}'`,
			)

			const routineB = await copyRoutineOrThrow(routineA.id, "Z990001")
			await makeRoutineReady(routineB.id)
			await replaceRoutine(routineB.id, routineA.id, "continue", "Z990001")

			expect(await getInheritedReviewCount(routineB.id)).toBe(0)
			expect(await getLatestReviewForApp(routineB.id, appId)).toBeNull()
		})
	})

	// ─── Transitive chain A→B→C ───────────────────────────────────────────

	describe("transitive chain A→B→C with continue", () => {
		it("C inherits A's original review date via B's inherited review", async () => {
			const routineA = await createRoutine({
				sectionId,
				name: "Routine A",
				description: "Original",
				frequency: "quarterly",
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: "tech_manager",
				isSectionRoutine: false,
				sectionRoutineOwnerRole: null,
				persistenceLinks: [],
				technologyElementIds: [],
				controlIds: [],
				groupClassifications: [],
				oracleRoleCriticalities: [],
				createdBy: "Z990001",
			})
			const db = getTestDb()
			await db.execute(
				/* sql */ `UPDATE routines SET status = 'approved', updated_by = 'Z990001' WHERE id = '${routineA.id}'`,
			)

			const originalDate = new Date("2025-01-15")
			await insertCompletedReview(routineA.id, appId, originalDate)

			// A → B (continue)
			const routineB = await copyRoutineOrThrow(routineA.id, "Z990001")
			await makeRoutineReady(routineB.id)
			await replaceRoutine(routineB.id, routineA.id, "continue", "Z990001")

			// Verify B inherited A's review
			const reviewB = await getLatestReviewForApp(routineB.id, appId)
			expect(reviewB).not.toBeNull()
			expect(reviewB?.reviewedAt.toISOString()).toBe(originalDate.toISOString())

			// B → C (continue)
			const routineC = await copyRoutineOrThrow(routineB.id, "Z990001")
			await makeRoutineReady(routineC.id)
			await replaceRoutine(routineC.id, routineB.id, "continue", "Z990001")

			// C should inherit B's review date (which is A's original date)
			const reviewC = await getLatestReviewForApp(routineC.id, appId)
			expect(reviewC).not.toBeNull()
			expect(reviewC?.reviewedAt.toISOString()).toBe(originalDate.toISOString())
			expect(reviewC?.inheritedFromReviewId).not.toBeNull()
		})

		it("mixed chain: A→B (continue) then B→C (reset) — C has no inherited review", async () => {
			const routineA = await createRoutine({
				sectionId,
				name: "Routine A",
				description: "Original",
				frequency: "quarterly",
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: "tech_manager",
				isSectionRoutine: false,
				sectionRoutineOwnerRole: null,
				persistenceLinks: [],
				technologyElementIds: [],
				controlIds: [],
				groupClassifications: [],
				oracleRoleCriticalities: [],
				createdBy: "Z990001",
			})
			const db = getTestDb()
			await db.execute(
				/* sql */ `UPDATE routines SET status = 'approved', updated_by = 'Z990001' WHERE id = '${routineA.id}'`,
			)
			await insertCompletedReview(routineA.id, appId, new Date("2025-01-01"))

			// A → B (continue)
			const routineB = await copyRoutineOrThrow(routineA.id, "Z990001")
			await makeRoutineReady(routineB.id)
			await replaceRoutine(routineB.id, routineA.id, "continue", "Z990001")

			// B → C (reset) — should NOT inherit
			const routineC = await copyRoutineOrThrow(routineB.id, "Z990001")
			await makeRoutineReady(routineC.id)
			await replaceRoutine(routineC.id, routineB.id, "reset", "Z990001")

			const reviewC = await getLatestReviewForApp(routineC.id, appId)
			expect(reviewC).toBeNull()
		})

		it("links point to C (head) after full A→B→C chain", async () => {
			const routineA = await createRoutine({
				sectionId,
				name: "Routine A",
				description: "Original",
				frequency: "quarterly",
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: "tech_manager",
				isSectionRoutine: false,
				sectionRoutineOwnerRole: null,
				persistenceLinks: [],
				technologyElementIds: [],
				controlIds: [],
				groupClassifications: [],
				oracleRoleCriticalities: [],
				createdBy: "Z990001",
			})
			const db = getTestDb()
			await db.execute(
				/* sql */ `UPDATE routines SET status = 'approved', updated_by = 'Z990001' WHERE id = '${routineA.id}'`,
			)

			const effectId = await insertPresetRoutineEffect(controlId, routineA.id)
			const acId = await insertApplicationControlsWithRoutine(appId, controlId, routineA.id)

			// A → B
			const routineB = await copyRoutineOrThrow(routineA.id, "Z990001")
			await makeRoutineReady(routineB.id)
			await replaceRoutine(routineB.id, routineA.id, "continue", "Z990001")

			expect(await getPresetRoutineId(effectId)).toBe(routineB.id)
			expect(await getMatchingRoutineIds(acId)).toContain(routineB.id)

			// B → C
			const routineC = await copyRoutineOrThrow(routineB.id, "Z990001")
			await makeRoutineReady(routineC.id)
			await replaceRoutine(routineC.id, routineB.id, "continue", "Z990001")

			expect(await getPresetRoutineId(effectId)).toBe(routineC.id)
			const ids = await getMatchingRoutineIds(acId)
			expect(ids).toContain(routineC.id)
			expect(ids).not.toContain(routineA.id)
			expect(ids).not.toContain(routineB.id)
		})
	})

	// ─── migrateExistingReplacementChains ─────────────────────────────────

	describe("migrateExistingReplacementChains", () => {
		/**
		 * Simulate a pre-existing chain where replaceRoutine did NOT update links
		 * (i.e., the old behaviour before this fix).
		 */
		async function buildStaleChain(opts: { deadlinePolicy?: "continue" | "reset"; withReviewOnA?: boolean } = {}) {
			const db = getTestDb()

			// Create A as approved
			const routineA = await createRoutine({
				sectionId,
				name: "Stale Routine A",
				description: "Old",
				frequency: "quarterly",
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: "tech_manager",
				isSectionRoutine: false,
				sectionRoutineOwnerRole: null,
				persistenceLinks: [],
				technologyElementIds: [],
				controlIds: [],
				groupClassifications: [],
				oracleRoleCriticalities: [],
				createdBy: "Z990001",
			})
			await db.execute(
				/* sql */ `UPDATE routines SET status = 'approved', updated_by = 'Z990001' WHERE id = '${routineA.id}'`,
			)

			if (opts.withReviewOnA) {
				await insertCompletedReview(routineA.id, appId, new Date("2025-03-01"))
			}

			// Create B as a copy pointing to A
			const routineB = await copyRoutineOrThrow(routineA.id, "Z990001")

			// Manually archive A and approve B (bypassing replaceRoutine's new link updates)
			// This simulates the OLD behaviour
			await db.execute(
				/* sql */ `UPDATE routines SET status = 'archived', archived_at = NOW(), archived_by = 'Z990001', replaced_by_routine_id = '${routineB.id}' WHERE id = '${routineA.id}'`,
			)
			await db.execute(
				/* sql */ `UPDATE routines SET status = 'approved', updated_by = 'Z990001' WHERE id = '${routineB.id}'`,
			)

			// Insert audit log for replacement with deadlinePolicy
			const policy = opts.deadlinePolicy ?? "continue"
			await db.execute(
				/* sql */ `INSERT INTO audit_log (action, entity_type, entity_id, metadata, performed_by, performed_at)
				VALUES ('routine_replaced', 'routine', '${routineB.id}', 
				'{"replacedRoutineId":"${routineA.id}","deadlinePolicy":"${policy}"}',
				'Z990001', NOW())`,
			)

			return { routineA, routineB }
		}

		it("migrates stale preset_routine_id from A to B", async () => {
			const { routineA, routineB } = await buildStaleChain()
			const effectId = await insertPresetRoutineEffect(controlId, routineA.id)
			expect(await getPresetRoutineId(effectId)).toBe(routineA.id)

			await migrateExistingReplacementChains("test-migration")

			expect(await getPresetRoutineId(effectId)).toBe(routineB.id)
		})

		it("migrates stale screening_routine_selections from A to B", async () => {
			const { routineA, routineB } = await buildStaleChain()
			const effectId = await insertPresetRoutineEffect(controlId, routineA.id)
			const selectionId = await insertScreeningRoutineSelection(appId, effectId, routineA.id)
			expect(await getSelectionRoutineId(selectionId)).toBe(routineA.id)

			await migrateExistingReplacementChains("test-migration")

			expect(await getSelectionRoutineId(selectionId)).toBe(routineB.id)
		})

		it("migrates stale matching_routine_ids from A to B", async () => {
			const { routineA, routineB } = await buildStaleChain()
			const acId = await insertApplicationControlsWithRoutine(appId, controlId, routineA.id)
			expect(await getMatchingRoutineIds(acId)).toContain(routineA.id)

			await migrateExistingReplacementChains("test-migration")

			const ids = await getMatchingRoutineIds(acId)
			expect(ids).toContain(routineB.id)
			expect(ids).not.toContain(routineA.id)
		})

		it("inherits review from A to B for continue chain", async () => {
			const { routineB } = await buildStaleChain({ deadlinePolicy: "continue", withReviewOnA: true })
			expect(await getInheritedReviewCount(routineB.id)).toBe(0)

			await migrateExistingReplacementChains("test-migration")

			expect(await getInheritedReviewCount(routineB.id)).toBe(1)
			const reviewB = await getLatestReviewForApp(routineB.id, appId)
			expect(reviewB).not.toBeNull()
			expect(reviewB?.status).toBe("completed")
		})

		it("does NOT inherit review for reset chain", async () => {
			const { routineB } = await buildStaleChain({ deadlinePolicy: "reset", withReviewOnA: true })

			await migrateExistingReplacementChains("test-migration")

			expect(await getInheritedReviewCount(routineB.id)).toBe(0)
			expect(await getLatestReviewForApp(routineB.id, appId)).toBeNull()
		})

		it("handles transitive stale chain A→B→C and migrates all links to C", async () => {
			const db = getTestDb()

			// Create A→B stale
			const { routineA, routineB } = await buildStaleChain({ deadlinePolicy: "continue", withReviewOnA: true })

			// Create C as a copy of B, stale (same pattern)
			const routineC = await copyRoutineOrThrow(routineB.id, "Z990001")
			await db.execute(
				/* sql */ `UPDATE routines SET status = 'archived', archived_at = NOW(), archived_by = 'Z990001', replaced_by_routine_id = '${routineC.id}' WHERE id = '${routineB.id}'`,
			)
			await db.execute(
				/* sql */ `UPDATE routines SET status = 'approved', updated_by = 'Z990001' WHERE id = '${routineC.id}'`,
			)
			await db.execute(
				/* sql */ `INSERT INTO audit_log (action, entity_type, entity_id, metadata, performed_by, performed_at)
				VALUES ('routine_replaced', 'routine', '${routineC.id}', 
				'{"replacedRoutineId":"${routineB.id}","deadlinePolicy":"continue"}',
				'Z990001', NOW())`,
			)

			const effectId = await insertPresetRoutineEffect(controlId, routineA.id)
			const acId = await insertApplicationControlsWithRoutine(appId, controlId, routineA.id)

			await migrateExistingReplacementChains("test-migration")

			// All links should point to C (head of chain)
			expect(await getPresetRoutineId(effectId)).toBe(routineC.id)
			const ids = await getMatchingRoutineIds(acId)
			expect(ids).toContain(routineC.id)
			expect(ids).not.toContain(routineA.id)
			expect(ids).not.toContain(routineB.id)

			// C should have inherited A's review
			const reviewC = await getLatestReviewForApp(routineC.id, appId)
			expect(reviewC).not.toBeNull()
			expect(reviewC?.status).toBe("completed")
		})

		it("is idempotent — running twice does not create duplicate inherited reviews", async () => {
			const { routineB } = await buildStaleChain({ deadlinePolicy: "continue", withReviewOnA: true })

			await migrateExistingReplacementChains("test-migration")
			await migrateExistingReplacementChains("test-migration") // run again

			expect(await getInheritedReviewCount(routineB.id)).toBe(1)
		})

		it("does NOT inherit A's review when A→B was reset, even if B→C is continue (mixed policy chain)", async () => {
			const db = getTestDb()

			// Build A→B with reset (A has a review, B gets no inherited review from A)
			const { routineA, routineB } = await buildStaleChain({ deadlinePolicy: "reset", withReviewOnA: true })

			// Build B→C with continue (C should inherit from B, but B has no reviews — so C gets nothing)
			const routineC = await copyRoutineOrThrow(routineB.id, "Z990001")
			await db.execute(
				/* sql */ `UPDATE routines SET status = 'archived', archived_at = NOW(), archived_by = 'Z990001', replaced_by_routine_id = '${routineC.id}' WHERE id = '${routineB.id}'`,
			)
			await db.execute(
				/* sql */ `UPDATE routines SET status = 'approved', updated_by = 'Z990001' WHERE id = '${routineC.id}'`,
			)
			// Audit log: B→C hop has deadlinePolicy=continue
			await db.execute(
				/* sql */ `INSERT INTO audit_log (action, entity_type, entity_id, metadata, performed_by, performed_at)
				VALUES ('routine_replaced', 'routine', '${routineC.id}',
				'{"replacedRoutineId":"${routineB.id}","deadlinePolicy":"continue"}',
				'Z990001', NOW())`,
			)

			await migrateExistingReplacementChains("test-migration")

			// C must NOT have A's review — A→B was reset, so A's reviews don't cross to C
			const reviewC = await getLatestReviewForApp(routineC.id, appId)
			expect(reviewC).toBeNull()
			// A's review is untouched
			expect(await getLatestReviewForApp(routineA.id, appId)).not.toBeNull()
		})

		it("B inherits A's review (A→B continue), but C does NOT inherit (B→C reset blocks at the hop)", async () => {
			const db = getTestDb()

			// Build A→B with continue (A has a review, B gets an inherited review from A)
			const { routineA, routineB } = await buildStaleChain({ deadlinePolicy: "continue", withReviewOnA: true })

			// Build B→C with RESET — the reset should block A's review from reaching C
			const routineC = await copyRoutineOrThrow(routineB.id, "Z990001")
			await db.execute(
				/* sql */ `UPDATE routines SET status = 'archived', archived_at = NOW(), archived_by = 'Z990001', replaced_by_routine_id = '${routineC.id}' WHERE id = '${routineB.id}'`,
			)
			await db.execute(
				/* sql */ `UPDATE routines SET status = 'approved', updated_by = 'Z990001' WHERE id = '${routineC.id}'`,
			)
			// Audit log: B→C hop has deadlinePolicy=reset
			await db.execute(
				/* sql */ `INSERT INTO audit_log (action, entity_type, entity_id, metadata, performed_by, performed_at)
				VALUES ('routine_replaced', 'routine', '${routineC.id}',
				'{"replacedRoutineId":"${routineB.id}","deadlinePolicy":"reset"}',
				'Z990001', NOW())`,
			)

			await migrateExistingReplacementChains("test-migration")

			// C must NOT have any inherited review — B→C is reset, breaking the chain
			const reviewC = await getLatestReviewForApp(routineC.id, appId)
			expect(reviewC).toBeNull()
			// A's review is untouched (only the A→B continue was stale, not C)
			expect(await getLatestReviewForApp(routineA.id, appId)).not.toBeNull()
			// B inherited from A (A→B=continue), but C gets nothing due to reset
			expect(await getInheritedReviewCount(routineB.id)).toBe(1)
		})

		it("returns counts of what was changed", async () => {
			const { routineA } = await buildStaleChain({ deadlinePolicy: "continue", withReviewOnA: true })
			await insertPresetRoutineEffect(controlId, routineA.id)
			await insertPresetRoutineEffect(controlId, routineA.id)
			// Both effects point to routineA — both should migrate (each creates its own screening_question)
			await insertApplicationControlsWithRoutine(appId, controlId, routineA.id)

			const result = await migrateExistingReplacementChains("test-migration")
			expect(result).not.toBeNull()
			expect(result?.presets).toBeGreaterThanOrEqual(1)
			expect(result?.arrayReplacements).toBeGreaterThanOrEqual(1)
			expect(result?.reviewsInherited).toBe(1)
		})
	})

	// ─── Section-level reviews (applicationId = NULL) ──────────────────────

	describe("section-level reviews (applicationId = NULL)", () => {
		it("replaceRoutine with continue inherits section-level review (applicationId = NULL)", async () => {
			const routineA = await createRoutine({
				sectionId,
				name: "Section Routine A",
				description: "Original section routine",
				frequency: "quarterly",
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: "tech_manager",
				isSectionRoutine: false,
				sectionRoutineOwnerRole: null,
				persistenceLinks: [],
				technologyElementIds: [],
				controlIds: [],
				groupClassifications: [],
				oracleRoleCriticalities: [],
				createdBy: "Z990001",
			})
			const db = getTestDb()
			await db.execute(
				/* sql */ `UPDATE routines SET status = 'approved', updated_by = 'Z990001' WHERE id = '${routineA.id}'`,
			)
			// Insert a section-level review (applicationId = NULL)
			const reviewDate = new Date("2025-03-20")
			await insertCompletedReview(routineA.id, null, reviewDate)

			const routineB = await copyRoutineOrThrow(routineA.id, "Z990001")
			await makeRoutineReady(routineB.id)
			await replaceRoutine(routineB.id, routineA.id, "continue", "Z990001")

			// B must have an inherited section-level review (applicationId = NULL)
			const reviewB = await getLatestSectionReview(routineB.id)
			expect(reviewB).not.toBeNull()
			expect(reviewB?.reviewedAt.toISOString()).toBe(reviewDate.toISOString())
			expect(reviewB?.inheritedFromReviewId).not.toBeNull()
		})

		it("migrateExistingReplacementChains inherits section-level review for stale continue chain", async () => {
			const db = getTestDb()
			// Build a stale A→B chain manually (simulates old replaceRoutine without link propagation)
			const routineA = await createRoutine({
				sectionId,
				name: "Section Stale Routine A",
				description: "Old",
				frequency: "quarterly",
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: "tech_manager",
				isSectionRoutine: false,
				sectionRoutineOwnerRole: null,
				persistenceLinks: [],
				technologyElementIds: [],
				controlIds: [],
				groupClassifications: [],
				oracleRoleCriticalities: [],
				createdBy: "Z990001",
			})
			await db.execute(
				/* sql */ `UPDATE routines SET status = 'approved', updated_by = 'Z990001' WHERE id = '${routineA.id}'`,
			)
			const routineB = await copyRoutineOrThrow(routineA.id, "Z990001")
			// Simulate stale replacement (bypass replaceRoutine's link propagation)
			await db.execute(
				/* sql */ `UPDATE routines SET status = 'archived', archived_at = NOW(), archived_by = 'Z990001', replaced_by_routine_id = '${routineB.id}' WHERE id = '${routineA.id}'`,
			)
			await db.execute(
				/* sql */ `UPDATE routines SET status = 'approved', updated_by = 'Z990001' WHERE id = '${routineB.id}'`,
			)
			await db.execute(
				/* sql */ `INSERT INTO audit_log (action, entity_type, entity_id, metadata, performed_by, performed_at)
				VALUES ('routine_replaced', 'routine', '${routineB.id}',
				'{"replacedRoutineId":"${routineA.id}","deadlinePolicy":"continue"}',
				'Z990001', NOW())`,
			)

			// Insert section-level review on A (applicationId = NULL)
			const reviewDate = new Date("2025-02-10")
			await insertCompletedReview(routineA.id, null, reviewDate)

			const result = await migrateExistingReplacementChains("test-migration")
			expect(result).not.toBeNull()

			// B must have an inherited section-level review
			const reviewB = await getLatestSectionReview(routineB.id)
			expect(reviewB).not.toBeNull()
			expect(reviewB?.reviewedAt.toISOString()).toBe(reviewDate.toISOString())
			expect(reviewB?.inheritedFromReviewId).not.toBeNull()
			expect(result?.reviewsInherited).toBeGreaterThanOrEqual(1)
		})
	})
})
