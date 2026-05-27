/**
 * Integration tests for deadlinePolicy logic in routine replacement.
 *
 * Tests that getEffectiveLastReviewDate() respects the deadlinePolicy stored in audit_log
 * when a routine replaces an existing routine (has sourceRoutineId).
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
const { createRoutine, copyRoutine, replaceRoutine, getEffectiveLastReviewDate, getSectionRoutinesForSection } =
	await import("~/db/queries/routines.server")
const { createSection } = await import("~/db/queries/sections.server")

async function createTestApp(name: string, sectionId: string) {
	const db = getTestDb()
	const slug = `team-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
	const teamR = await db.execute(
		/* sql */ `INSERT INTO dev_teams (name, slug, section_id, created_by, updated_by) VALUES ('${name}-team', '${slug}', '${sectionId}', 'test', 'test') RETURNING id`,
	)
	const teamId = (teamR.rows[0] as { id: string }).id
	const appR = await db.execute(
		/* sql */ `INSERT INTO monitored_applications (name, created_by, updated_by) VALUES ('${name}', 'test', 'test') RETURNING id`,
	)
	const appId = (appR.rows[0] as { id: string }).id
	await db.execute(
		/* sql */ `INSERT INTO application_team_mappings (application_id, dev_team_id, created_by) VALUES ('${appId}', '${teamId}', 'test')`,
	)
	return appId
}

async function createReview(routineId: string, applicationId: string, reviewedAt: Date) {
	const db = getTestDb()
	const result = await db.execute(
		/* sql */ `INSERT INTO routine_reviews (routine_id, application_id, title, reviewed_at, status, created_by) 
VALUES ('${routineId}', '${applicationId}', 'Test Review', '${reviewedAt.toISOString()}', 'completed', 'test-user') 
RETURNING id`,
	)
	return (result.rows[0] as { id: string }).id
}

async function setRoutineStatus(routineId: string, status: string) {
	const db = getTestDb()
	await db.execute(/* sql */ `UPDATE routines SET status = '${status}' WHERE id = '${routineId}'`)
}

describe("deadlinePolicy integration tests", () => {
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
DELETE FROM routine_controls;
DELETE FROM routine_screening_questions;
DELETE FROM routine_persistence_links;
DELETE FROM routine_technology_elements;
DELETE FROM routine_group_classification_links;
DELETE FROM routine_oracle_role_criticality_links;
DELETE FROM routines;
DELETE FROM audit_log;
DELETE FROM application_team_mappings;
DELETE FROM monitored_applications;
DELETE FROM dev_teams;
DELETE FROM sections;
`)
	})

	it("should return null for routine without sourceRoutineId", async () => {
		const section = await createSection("Test Section", null, "test-user")
		const appId = await createTestApp("Test App", section.id)
		const routine = await createRoutine({
			sectionId: section.id,
			name: "Test Routine",
			description: "Test",
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
			createdBy: "test-user",
		})

		const lastReview = await getEffectiveLastReviewDate(routine.id, appId)

		expect(lastReview).toBeNull()
	})

	it('should inherit old routine review when deadlinePolicy is "continue"', async () => {
		const section = await createSection("Test Section", null, "test-user")
		const appId = await createTestApp("Test App", section.id)

		// Create old routine with a review
		const oldRoutine = await createRoutine({
			sectionId: section.id,
			name: "Old Routine",
			description: "Test",
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
			createdBy: "test-user",
		})

		// Old routine must be approved to be replaced
		await setRoutineStatus(oldRoutine.id, "approved")

		const oldReviewDate = new Date("2025-01-15T12:00:00Z")
		await createReview(oldRoutine.id, appId, oldReviewDate)

		// Create new routine by copying
		const newRoutine = await copyRoutine(oldRoutine.id, "test-user")
		if (!newRoutine) throw new Error("Failed to copy routine")

		// New routine must be "ready" to be replaced
		await setRoutineStatus(newRoutine.id, "ready")

		// Replace with "continue" policy
		await replaceRoutine(newRoutine.id, oldRoutine.id, "continue", "test-user")

		// Get effective last review date (should return old routine's review)
		const effectiveDate = await getEffectiveLastReviewDate(newRoutine.id, appId)

		expect(effectiveDate).not.toBeNull()
		expect(effectiveDate?.toISOString()).toBe(oldReviewDate.toISOString())

		// After the new routine itself gets reviewed, its own review should take precedence
		const newReviewDate = new Date("2025-04-01T12:00:00Z")
		await createReview(newRoutine.id, appId, newReviewDate)

		const effectiveDateAfterOwnReview = await getEffectiveLastReviewDate(newRoutine.id, appId)
		expect(effectiveDateAfterOwnReview?.toISOString()).toBe(newReviewDate.toISOString())
	})

	it('should NOT inherit old routine review when deadlinePolicy is "reset"', async () => {
		const section = await createSection("Test Section", null, "test-user")
		const appId = await createTestApp("Test App", section.id)

		// Create old routine with a review
		const oldRoutine = await createRoutine({
			sectionId: section.id,
			name: "Old Routine",
			description: "Test",
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
			createdBy: "test-user",
		})

		// Old routine must be approved to be replaced
		await setRoutineStatus(oldRoutine.id, "approved")

		const oldReviewDate = new Date("2025-01-15T12:00:00Z")
		await createReview(oldRoutine.id, appId, oldReviewDate)

		// Create new routine by copying
		const newRoutine = await copyRoutine(oldRoutine.id, "test-user")
		if (!newRoutine) throw new Error("Failed to copy routine")

		// New routine must be "ready" to be replaced
		await setRoutineStatus(newRoutine.id, "ready")

		// Replace with "reset" policy
		await replaceRoutine(newRoutine.id, oldRoutine.id, "reset", "test-user")

		// Get effective last review date (should return null, as new routine has no reviews)
		const effectiveDate = await getEffectiveLastReviewDate(newRoutine.id, appId)

		expect(effectiveDate).toBeNull()

		// Now create a review on the new routine
		const newReviewDate = new Date("2025-06-01T12:00:00Z")
		await createReview(newRoutine.id, appId, newReviewDate)

		// Should now return the new routine's review, not the old one
		const effectiveDateAfterNewReview = await getEffectiveLastReviewDate(newRoutine.id, appId)

		expect(effectiveDateAfterNewReview).not.toBeNull()
		expect(effectiveDateAfterNewReview?.toISOString()).toBe(newReviewDate.toISOString())
	})

	it("should handle transitive chain V3→V2→V1 with continue policy", async () => {
		const section = await createSection("Test Section", null, "test-user")
		const appId = await createTestApp("Test App", section.id)

		// Create V1 with a review
		const v1 = await createRoutine({
			sectionId: section.id,
			name: "V1 Routine",
			description: "Test",
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
			createdBy: "test-user",
		})

		// V1 must be approved to be replaced
		await setRoutineStatus(v1.id, "approved")

		const v1ReviewDate = new Date("2025-01-15T12:00:00Z")
		await createReview(v1.id, appId, v1ReviewDate)

		// Create V2 replacing V1 with "continue"
		const v2 = await copyRoutine(v1.id, "test-user")
		if (!v2) throw new Error("Failed to copy V1")
		await setRoutineStatus(v2.id, "ready")
		await replaceRoutine(v2.id, v1.id, "continue", "test-user")

		// Create V3 replacing V2 with "continue"
		const v3 = await copyRoutine(v2.id, "test-user")
		if (!v3) throw new Error("Failed to copy V2")
		await setRoutineStatus(v3.id, "ready")
		await replaceRoutine(v3.id, v2.id, "continue", "test-user")

		// V3 should inherit V1's review (transitive)
		const effectiveDate = await getEffectiveLastReviewDate(v3.id, appId)

		expect(effectiveDate).not.toBeNull()
		expect(effectiveDate?.toISOString()).toBe(v1ReviewDate.toISOString())
	})

	it('should stop at "reset" in transitive chain V3→V2→V1', async () => {
		const section = await createSection("Test Section", null, "test-user")
		const appId = await createTestApp("Test App", section.id)

		// Create V1 with a review
		const v1 = await createRoutine({
			sectionId: section.id,
			name: "V1 Routine",
			description: "Test",
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
			createdBy: "test-user",
		})

		// V1 must be approved to be replaced
		await setRoutineStatus(v1.id, "approved")

		const v1ReviewDate = new Date("2025-01-15T12:00:00Z")
		await createReview(v1.id, appId, v1ReviewDate)

		// Create V2 replacing V1 with "reset" (breaks the chain)
		const v2 = await copyRoutine(v1.id, "test-user")
		if (!v2) throw new Error("Failed to copy V1")
		await setRoutineStatus(v2.id, "ready")
		await replaceRoutine(v2.id, v1.id, "reset", "test-user")

		// Create V2 review
		const v2ReviewDate = new Date("2025-03-01T12:00:00Z")
		await createReview(v2.id, appId, v2ReviewDate)

		// Create V3 replacing V2 with "continue"
		const v3 = await copyRoutine(v2.id, "test-user")
		if (!v3) throw new Error("Failed to copy V2")
		await setRoutineStatus(v3.id, "ready")
		await replaceRoutine(v3.id, v2.id, "continue", "test-user")

		// V3 should inherit V2's review, NOT V1's (because V2 had "reset")
		const effectiveDate = await getEffectiveLastReviewDate(v3.id, appId)

		expect(effectiveDate).not.toBeNull()
		expect(effectiveDate?.toISOString()).toBe(v2ReviewDate.toISOString())
	})

	it('getSectionRoutinesForSection: section routine with "continue" inherits archived source review', async () => {
		const section = await createSection("Test Section", null, "test-user")

		const oldRoutine = await createRoutine({
			sectionId: section.id,
			name: "Old Section Routine",
			description: "Test",
			frequency: "quarterly",
			screeningQuestionId: null,
			screeningChoiceValue: null,
			appliesToAllInSection: true,
			responsibleRole: "tech_manager",
			isSectionRoutine: true,
			sectionRoutineOwnerRole: "tech_manager",
			persistenceLinks: [],
			technologyElementIds: [],
			controlIds: [],
			groupClassifications: [],
			oracleRoleCriticalities: [],
			createdBy: "test-user",
		})

		await setRoutineStatus(oldRoutine.id, "approved")

		// Create a section-level review (applicationId = null)
		const db = getTestDb()
		const oldReviewDate = new Date("2025-02-01T12:00:00Z")
		await db.execute(
			/* sql */ `INSERT INTO routine_reviews (routine_id, application_id, title, reviewed_at, status, created_by)
VALUES ('${oldRoutine.id}', NULL, 'Section Review', '${oldReviewDate.toISOString()}', 'completed', 'test-user')`,
		)

		// Create new routine replacing old with "continue"
		const newRoutine = await copyRoutine(oldRoutine.id, "test-user")
		if (!newRoutine) throw new Error("Failed to copy routine")
		await setRoutineStatus(newRoutine.id, "ready")
		await replaceRoutine(newRoutine.id, oldRoutine.id, "continue", "test-user")

		// getSectionRoutinesForSection should show new routine inheriting old review date
		const sectionRoutines = await getSectionRoutinesForSection(section.id)
		const result = sectionRoutines.find((r) => r.routine.id === newRoutine.id)

		expect(result).toBeDefined()
		expect(result?.lastReviewDate?.toISOString()).toBe(oldReviewDate.toISOString())
	})

	it("getSectionRoutinesForSection: uses own review after new routine is reviewed (not locked to old)", async () => {
		const section = await createSection("Test Section", null, "test-user")

		const oldRoutine = await createRoutine({
			sectionId: section.id,
			name: "Old Routine",
			description: "Test",
			frequency: "quarterly",
			screeningQuestionId: null,
			screeningChoiceValue: null,
			appliesToAllInSection: true,
			responsibleRole: "tech_manager",
			isSectionRoutine: true,
			sectionRoutineOwnerRole: "tech_manager",
			persistenceLinks: [],
			technologyElementIds: [],
			controlIds: [],
			groupClassifications: [],
			oracleRoleCriticalities: [],
			createdBy: "test-user",
		})

		await setRoutineStatus(oldRoutine.id, "approved")

		const db = getTestDb()
		const oldReviewDate = new Date("2025-02-01T12:00:00Z")
		await db.execute(
			/* sql */ `INSERT INTO routine_reviews (routine_id, application_id, title, reviewed_at, status, created_by)
VALUES ('${oldRoutine.id}', NULL, 'Old Review', '${oldReviewDate.toISOString()}', 'completed', 'test-user')`,
		)

		const newRoutine = await copyRoutine(oldRoutine.id, "test-user")
		if (!newRoutine) throw new Error("Failed to copy routine")
		await setRoutineStatus(newRoutine.id, "ready")
		await replaceRoutine(newRoutine.id, oldRoutine.id, "continue", "test-user")

		// Add own review to new routine
		const newReviewDate = new Date("2025-06-01T12:00:00Z")
		await db.execute(
			/* sql */ `INSERT INTO routine_reviews (routine_id, application_id, title, reviewed_at, status, created_by)
VALUES ('${newRoutine.id}', NULL, 'New Review', '${newReviewDate.toISOString()}', 'completed', 'test-user')`,
		)

		const sectionRoutines = await getSectionRoutinesForSection(section.id)
		const result = sectionRoutines.find((r) => r.routine.id === newRoutine.id)

		expect(result).toBeDefined()
		// Should use new routine's own review, not old routine's review
		expect(result?.lastReviewDate?.toISOString()).toBe(newReviewDate.toISOString())
	})

	it('getSectionRoutinesForSection: "reset" policy stops chain, uses own review only', async () => {
		const section = await createSection("Test Section", null, "test-user")

		const oldRoutine = await createRoutine({
			sectionId: section.id,
			name: "Old Routine",
			description: "Test",
			frequency: "quarterly",
			screeningQuestionId: null,
			screeningChoiceValue: null,
			appliesToAllInSection: true,
			responsibleRole: "tech_manager",
			isSectionRoutine: true,
			sectionRoutineOwnerRole: "tech_manager",
			persistenceLinks: [],
			technologyElementIds: [],
			controlIds: [],
			groupClassifications: [],
			oracleRoleCriticalities: [],
			createdBy: "test-user",
		})

		await setRoutineStatus(oldRoutine.id, "approved")

		const db = getTestDb()
		const oldReviewDate = new Date("2025-01-01T12:00:00Z")
		await db.execute(
			/* sql */ `INSERT INTO routine_reviews (routine_id, application_id, title, reviewed_at, status, created_by)
VALUES ('${oldRoutine.id}', NULL, 'Old Review', '${oldReviewDate.toISOString()}', 'completed', 'test-user')`,
		)

		const newRoutine = await copyRoutine(oldRoutine.id, "test-user")
		if (!newRoutine) throw new Error("Failed to copy routine")
		await setRoutineStatus(newRoutine.id, "ready")
		await replaceRoutine(newRoutine.id, oldRoutine.id, "reset", "test-user")

		const sectionRoutines = await getSectionRoutinesForSection(section.id)
		const result = sectionRoutines.find((r) => r.routine.id === newRoutine.id)

		expect(result).toBeDefined()
		// "reset" means no inheritance — lastReviewDate should be null
		expect(result?.lastReviewDate).toBeNull()
	})
})
