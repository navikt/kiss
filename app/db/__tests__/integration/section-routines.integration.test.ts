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

const { createRoutine, updateRoutine, createReview, getSectionRoutinesForSection } = await import(
	"~/db/queries/routines.server"
)
const { getRoutineDeadlinesWithControls } = await import("~/db/queries/routine-deadlines.server")

async function createTestSection(name: string, slug: string) {
	const db = getTestDb()
	const r = await db.execute(
		/* sql */ `INSERT INTO sections (name, slug, created_by, updated_by) VALUES ('${name}', '${slug}', 'test', 'test') RETURNING id`,
	)
	return (r.rows[0] as { id: string }).id
}

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

describe("Section routines integration tests", () => {
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
			DELETE FROM application_team_mappings;
			DELETE FROM monitored_applications;
			DELETE FROM dev_teams;
			DELETE FROM sections;
		`)
	})

	it("should create a section routine with owner role", async () => {
		const sectionId = await createTestSection("Test Seksjon", `test-${Date.now()}`)

		const routine = await createRoutine({
			sectionId,
			name: "Seksjonsrutine test",
			description: "Test beskrivelse",
			frequency: "annually",
			screeningQuestionId: null,
			screeningChoiceValue: null,
			appliesToAllInSection: false,
			responsibleRole: null,
			activityType: null,
			isSectionRoutine: true,
			sectionRoutineOwnerRole: "Seksjonsleder",
			persistenceLinks: [],
			technologyElementIds: [],
			controlIds: [],
			groupClassifications: [],
			oracleRoleCriticalities: [],
			createdBy: "test",
		})

		expect(routine.isSectionRoutine).toBe(1)
		expect(routine.sectionRoutineOwnerRole).toBe("Seksjonsleder")
	})

	it("should list section routines for a section", async () => {
		const sectionId = await createTestSection("Test Seksjon", `test-${Date.now()}`)

		// Create a regular routine
		await createRoutine({
			sectionId,
			name: "Vanlig rutine",
			description: null,
			frequency: "quarterly",
			screeningQuestionId: null,
			screeningChoiceValue: null,
			appliesToAllInSection: true,
			responsibleRole: null,
			activityType: null,
			isSectionRoutine: false,
			persistenceLinks: [],
			technologyElementIds: [],
			controlIds: [],
			groupClassifications: [],
			oracleRoleCriticalities: [],
			createdBy: "test",
		})

		// Create a section routine
		const sectionRoutine = await createRoutine({
			sectionId,
			name: "Seksjonsrutine",
			description: null,
			frequency: "annually",
			screeningQuestionId: null,
			screeningChoiceValue: null,
			appliesToAllInSection: false,
			responsibleRole: null,
			activityType: null,
			isSectionRoutine: true,
			sectionRoutineOwnerRole: "Teknologileder",
			persistenceLinks: [],
			technologyElementIds: [],
			controlIds: [],
			groupClassifications: [],
			oracleRoleCriticalities: [],
			createdBy: "test",
		})

		// Approve the section routine
		const db = getTestDb()
		await db.execute(/* sql */ `UPDATE routines SET status = 'approved' WHERE id = '${sectionRoutine.id}'`)

		const results = await getSectionRoutinesForSection(sectionId)
		expect(results).toHaveLength(1)
		expect(results[0].routine.name).toBe("Seksjonsrutine")
		expect(results[0].routine.sectionRoutineOwnerRole).toBe("Teknologileder")
	})

	it("should update section routine fields", async () => {
		const sectionId = await createTestSection("Test Seksjon", `test-${Date.now()}`)

		const routine = await createRoutine({
			sectionId,
			name: "Rutine",
			description: null,
			frequency: "quarterly",
			screeningQuestionId: null,
			screeningChoiceValue: null,
			appliesToAllInSection: false,
			responsibleRole: null,
			activityType: null,
			isSectionRoutine: false,
			persistenceLinks: [],
			technologyElementIds: [],
			controlIds: [],
			groupClassifications: [],
			oracleRoleCriticalities: [],
			createdBy: "test",
		})

		// Update to make it a section routine
		const updated = await updateRoutine({
			id: routine.id,
			name: "Rutine (seksjon)",
			description: null,
			frequency: "quarterly",
			screeningQuestionId: null,
			screeningChoiceValue: null,
			appliesToAllInSection: false,
			responsibleRole: null,
			activityType: null,
			isSectionRoutine: true,
			sectionRoutineOwnerRole: "Arkitekt",
			persistenceLinks: [],
			technologyElementIds: [],
			controlIds: [],
			groupClassifications: [],
			oracleRoleCriticalities: [],
			updatedBy: "test",
		})

		expect(updated?.isSectionRoutine).toBe(1)
		expect(updated?.sectionRoutineOwnerRole).toBe("Arkitekt")
	})

	it("should create section-level review (applicationId = null)", async () => {
		const sectionId = await createTestSection("Test Seksjon", `test-${Date.now()}`)

		const routine = await createRoutine({
			sectionId,
			name: "Seksjonsrutine",
			description: null,
			frequency: "annually",
			screeningQuestionId: null,
			screeningChoiceValue: null,
			appliesToAllInSection: false,
			responsibleRole: null,
			activityType: null,
			isSectionRoutine: true,
			sectionRoutineOwnerRole: "Seksjonsleder",
			persistenceLinks: [],
			technologyElementIds: [],
			controlIds: [],
			groupClassifications: [],
			oracleRoleCriticalities: [],
			createdBy: "test",
		})

		// Approve the routine
		const db = getTestDb()
		await db.execute(/* sql */ `UPDATE routines SET status = 'approved' WHERE id = '${routine.id}'`)

		// Create a section-level review (no application)
		const review = await createReview({
			routineId: routine.id,
			applicationId: null,
			title: "Seksjonsgjennomgang",
			summary: "Alt OK",
			routineSnapshotPath: null,
			reviewedAt: new Date(),
			createdBy: "tester",
			participants: [],
		})

		expect(review.applicationId).toBeNull()
		expect(review.routineId).toBe(routine.id)
	})

	it("should include section routine fields in deadline pipeline", async () => {
		const sectionId = await createTestSection("Test Seksjon", `test-${Date.now()}`)
		const appId = await createTestApp("TestApp", sectionId)

		const routine = await createRoutine({
			sectionId,
			name: "Seksjonsrutine deadline",
			description: null,
			frequency: "annually",
			screeningQuestionId: null,
			screeningChoiceValue: null,
			appliesToAllInSection: true,
			responsibleRole: null,
			activityType: null,
			isSectionRoutine: true,
			sectionRoutineOwnerRole: "Teknologileder",
			persistenceLinks: [],
			technologyElementIds: [],
			controlIds: [],
			groupClassifications: [],
			oracleRoleCriticalities: [],
			createdBy: "test",
		})

		// Approve the routine
		const db = getTestDb()
		await db.execute(/* sql */ `UPDATE routines SET status = 'approved' WHERE id = '${routine.id}'`)

		const deadlines = await getRoutineDeadlinesWithControls(appId)
		const sectionDeadline = deadlines.find((d) => d.routine?.id === routine.id)

		expect(sectionDeadline).toBeDefined()
		expect(sectionDeadline?.isSectionRoutine).toBe(true)
		expect(sectionDeadline?.sectionRoutineOwnerRole).toBe("Teknologileder")
	})

	it("section-level review should override deadline for section routine", async () => {
		const sectionId = await createTestSection("Test Seksjon", `test-${Date.now()}`)
		const appId = await createTestApp("TestApp", sectionId)

		const routine = await createRoutine({
			sectionId,
			name: "Seksjonsrutine med gjennomgang",
			description: null,
			frequency: "annually",
			screeningQuestionId: null,
			screeningChoiceValue: null,
			appliesToAllInSection: true,
			responsibleRole: null,
			activityType: null,
			isSectionRoutine: true,
			sectionRoutineOwnerRole: "Seksjonsleder",
			persistenceLinks: [],
			technologyElementIds: [],
			controlIds: [],
			groupClassifications: [],
			oracleRoleCriticalities: [],
			createdBy: "test",
		})

		// Approve
		const db = getTestDb()
		await db.execute(/* sql */ `UPDATE routines SET status = 'approved' WHERE id = '${routine.id}'`)

		// Create a section-level review
		const reviewDate = new Date()
		await createReview({
			routineId: routine.id,
			applicationId: null,
			title: "Seksjon OK",
			summary: null,
			routineSnapshotPath: null,
			reviewedAt: reviewDate,
			createdBy: "tester",
			participants: [],
		})

		// Complete the review
		await db.execute(
			/* sql */ `UPDATE routine_reviews SET status = 'completed' WHERE routine_id = '${routine.id}' AND application_id IS NULL`,
		)

		const deadlines = await getRoutineDeadlinesWithControls(appId)
		const sectionDeadline = deadlines.find((d) => d.routine?.id === routine.id)

		expect(sectionDeadline).toBeDefined()
		expect(sectionDeadline?.lastReviewDate).toBeDefined()
		// The deadline should not be overdue since we just did a review
		expect(sectionDeadline?.overdue).toBe(false)
	})
})
