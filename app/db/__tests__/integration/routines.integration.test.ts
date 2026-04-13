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

// Import AFTER mocking
const {
	createRoutine,
	getRoutine,
	getRoutinesForSection,
	updateRoutine,
	deleteRoutine,
	createReview,
	getReviewsForRoutine,
	confirmParticipation,
	getAppsRequiringRoutine,
	getLatestReviewForApp,
	calculateDeadline,
	isOverdue,
} = await import("~/db/queries/routines.server")

// ─── Helpers ─────────────────────────────────────────────────────────────

async function createTestSection(name: string, slug: string) {
	const db = getTestDb()
	const result = await db.execute(
		/* sql */ `INSERT INTO sections (name, slug, created_by, updated_by) VALUES ('${name}', '${slug}', 'test', 'test') RETURNING id`,
	)
	return (result.rows[0] as { id: string }).id
}

async function createTestApp(name: string) {
	const db = getTestDb()
	const result = await db.execute(
		/* sql */ `INSERT INTO monitored_applications (name, created_by, updated_by) VALUES ('${name}', 'test', 'test') RETURNING id`,
	)
	return (result.rows[0] as { id: string }).id
}

async function createTestScreeningQuestion(sectionId: string, text: string) {
	const db = getTestDb()
	const result = await db.execute(
		/* sql */ `INSERT INTO screening_questions (section_id, question_text, answer_type, created_by, updated_by) VALUES ('${sectionId}', '${text}', 'boolean', 'test', 'test') RETURNING id`,
	)
	return (result.rows[0] as { id: string }).id
}

async function createTestChoice(questionId: string, label: string) {
	const db = getTestDb()
	const result = await db.execute(
		/* sql */ `INSERT INTO screening_question_choices (question_id, label) VALUES ('${questionId}', '${label}') RETURNING id`,
	)
	return (result.rows[0] as { id: string }).id
}

async function createTestScreeningAnswer(appId: string, questionId: string, answer: string) {
	const db = getTestDb()
	await db.execute(
		/* sql */ `INSERT INTO screening_answers (application_id, question_id, answer, answered_by) VALUES ('${appId}', '${questionId}', '${answer}', 'test')`,
	)
}

async function createTestTechElement(name: string) {
	const db = getTestDb()
	const result = await db.execute(
		/* sql */ `INSERT INTO technology_elements (name, slug) VALUES ('${name}', '${name.toLowerCase().replace(/ /g, "-")}') RETURNING id`,
	)
	return (result.rows[0] as { id: string }).id
}

async function confirmAppTechElement(appId: string, elementId: string) {
	const db = getTestDb()
	await db.execute(
		/* sql */ `INSERT INTO application_technology_elements (application_id, element_id, source, confirmed_at, confirmed_by) VALUES ('${appId}', '${elementId}', 'manual', NOW(), 'test')`,
	)
}

// ─── Test Suite ──────────────────────────────────────────────────────────

describe("Routines integration tests", () => {
	beforeAll(async () => {
		await setupTestDatabase()
	})

	afterAll(async () => {
		await teardownTestDatabase()
	})

	beforeEach(async () => {
		const db = getTestDb()
		await db.execute(/* sql */ `
			DELETE FROM routine_review_attachments;
			DELETE FROM routine_review_participants;
			DELETE FROM routine_reviews;
			DELETE FROM routine_technology_elements;
			DELETE FROM routines;
			DELETE FROM screening_answers;
			DELETE FROM screening_choice_effects;
			DELETE FROM screening_question_choices;
			DELETE FROM screening_question_effects;
			DELETE FROM screening_questions;
			DELETE FROM application_technology_elements;
			DELETE FROM technology_elements;
			DELETE FROM monitored_applications;
			DELETE FROM dev_teams;
			DELETE FROM sections;
			DELETE FROM audit_log;
		`)
	})

	// ─── CRUD ────────────────────────────────────────────────────────────

	describe("CRUD", () => {
		it("should create a routine for a section", async () => {
			const sectionId = await createTestSection("Security", "security")

			const routine = await createRoutine({
				sectionId,
				name: "Code Review",
				description: "Review application code",
				frequency: "quarterly",
				screeningQuestionId: null,
				screeningChoiceValue: null,
				responsibleRole: null,
				persistenceType: null,
				dataClassification: null,
				controlIds: [],
				technologyElementIds: [],
				createdBy: "test-user",
			})

			expect(routine).toBeDefined()
			expect(routine.name).toBe("Code Review")
			expect(routine.frequency).toBe("quarterly")
			expect(routine.sectionId).toBe(sectionId)
		})

		it("should get routines for a section", async () => {
			const sectionId = await createTestSection("Security", "security")
			const elemId = await createTestTechElement("Kubernetes")

			await createRoutine({
				sectionId,
				name: "Code Review",
				description: null,
				frequency: "quarterly",
				screeningQuestionId: null,
				screeningChoiceValue: null,
				responsibleRole: null,
				persistenceType: null,
				dataClassification: null,
				controlIds: [],
				technologyElementIds: [elemId],
				createdBy: "test-user",
			})
			await createRoutine({
				sectionId,
				name: "Dependency Scan",
				description: null,
				frequency: "monthly",
				screeningQuestionId: null,
				screeningChoiceValue: null,
				responsibleRole: null,
				persistenceType: null,
				dataClassification: null,
				controlIds: [],
				technologyElementIds: [],
				createdBy: "test-user",
			})

			const routinesList = await getRoutinesForSection(sectionId)

			expect(routinesList).toHaveLength(2)
			const names = routinesList.map((r) => r.name)
			expect(names).toContain("Code Review")
			expect(names).toContain("Dependency Scan")

			const withElements = routinesList.find((r) => r.name === "Code Review")
			expect(withElements?.technologyElements).toHaveLength(1)
			expect(withElements?.technologyElements[0].name).toBe("Kubernetes")
		})

		it("should get a single routine by ID", async () => {
			const sectionId = await createTestSection("Security", "security")
			const elemId = await createTestTechElement("Docker")

			const created = await createRoutine({
				sectionId,
				name: "Container Review",
				description: "Review container configs",
				frequency: "semi_annually",
				screeningQuestionId: null,
				screeningChoiceValue: null,
				responsibleRole: null,
				persistenceType: null,
				dataClassification: null,
				controlIds: [],
				technologyElementIds: [elemId],
				createdBy: "test-user",
			})

			const routine = await getRoutine(created.id)

			expect(routine).not.toBeNull()
			expect(routine?.name).toBe("Container Review")
			expect(routine?.description).toBe("Review container configs")
			expect(routine?.frequency).toBe("semi_annually")
			expect(routine?.technologyElements).toHaveLength(1)
			expect(routine?.technologyElements[0].name).toBe("Docker")
		})

		it("should update a routine", async () => {
			const sectionId = await createTestSection("Security", "security")
			const elem1 = await createTestTechElement("React")
			const elem2 = await createTestTechElement("Vue")

			const created = await createRoutine({
				sectionId,
				name: "Frontend Review",
				description: null,
				frequency: "quarterly",
				screeningQuestionId: null,
				screeningChoiceValue: null,
				responsibleRole: null,
				persistenceType: null,
				dataClassification: null,
				controlIds: [],
				technologyElementIds: [elem1],
				createdBy: "test-user",
			})

			const updated = await updateRoutine({
				id: created.id,
				name: "UI Framework Review",
				description: "Updated description",
				frequency: "monthly",
				screeningQuestionId: null,
				screeningChoiceValue: null,
				responsibleRole: null,
				persistenceType: null,
				dataClassification: null,
				controlIds: [],
				technologyElementIds: [elem2],
				updatedBy: "admin-user",
			})

			expect(updated.name).toBe("UI Framework Review")
			expect(updated.frequency).toBe("monthly")

			const fetched = await getRoutine(created.id)
			expect(fetched?.technologyElements).toHaveLength(1)
			expect(fetched?.technologyElements[0].name).toBe("Vue")

			const db = getTestDb()
			const auditResult = await db.execute(
				/* sql */ `SELECT * FROM audit_log WHERE action = 'routine_updated' AND entity_id = '${created.id}'`,
			)
			expect(auditResult.rows.length).toBeGreaterThanOrEqual(1)
		})

		it("should delete a routine and cascade reviews", async () => {
			const sectionId = await createTestSection("Security", "security")

			const routine = await createRoutine({
				sectionId,
				name: "To Be Deleted",
				description: null,
				frequency: "annually",
				screeningQuestionId: null,
				screeningChoiceValue: null,
				responsibleRole: null,
				persistenceType: null,
				dataClassification: null,
				controlIds: [],
				technologyElementIds: [],
				createdBy: "test-user",
			})

			await createReview({
				routineId: routine.id,
				applicationId: null,
				title: "Review 1",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date(),
				createdBy: "test-user",
				participants: [],
			})

			await deleteRoutine(routine.id, "admin-user")

			const fetched = await getRoutine(routine.id)
			expect(fetched).toBeNull()

			const db = getTestDb()
			const reviewResult = await db.execute(
				/* sql */ `SELECT * FROM routine_reviews WHERE routine_id = '${routine.id}'`,
			)
			expect(reviewResult.rows).toHaveLength(0)

			const auditResult = await db.execute(
				/* sql */ `SELECT * FROM audit_log WHERE action = 'routine_deleted' AND entity_id = '${routine.id}'`,
			)
			expect(auditResult.rows.length).toBeGreaterThanOrEqual(1)
		})
	})

	// ─── Reviews ─────────────────────────────────────────────────────────

	describe("Reviews", () => {
		it("should create a review with participants", async () => {
			const sectionId = await createTestSection("Security", "security")

			const routine = await createRoutine({
				sectionId,
				name: "Pen Test",
				description: null,
				frequency: "annually",
				screeningQuestionId: null,
				screeningChoiceValue: null,
				responsibleRole: null,
				persistenceType: null,
				dataClassification: null,
				controlIds: [],
				technologyElementIds: [],
				createdBy: "test-user",
			})

			const review = await createReview({
				routineId: routine.id,
				applicationId: null,
				title: "Q1 Review",
				summary: "All good",
				routineSnapshotPath: null,
				reviewedAt: new Date("2024-03-15"),
				createdBy: "test-user",
				participants: [
					{ userIdent: "alice", userName: "Alice" },
					{ userIdent: "bob", userName: "Bob" },
				],
			})

			expect(review).toBeDefined()
			expect(review.title).toBe("Q1 Review")

			const db = getTestDb()
			const participantResult = await db.execute(
				/* sql */ `SELECT * FROM routine_review_participants WHERE review_id = '${review.id}'`,
			)
			expect(participantResult.rows).toHaveLength(2)
		})

		it("should confirm participation", async () => {
			const sectionId = await createTestSection("Security", "security")

			const routine = await createRoutine({
				sectionId,
				name: "Pen Test",
				description: null,
				frequency: "annually",
				screeningQuestionId: null,
				screeningChoiceValue: null,
				responsibleRole: null,
				persistenceType: null,
				dataClassification: null,
				controlIds: [],
				technologyElementIds: [],
				createdBy: "test-user",
			})

			const review = await createReview({
				routineId: routine.id,
				applicationId: null,
				title: "Review for confirmation",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date(),
				createdBy: "test-user",
				participants: [{ userIdent: "alice", userName: "Alice" }],
			})

			const confirmed = await confirmParticipation(review.id, "alice")

			expect(confirmed).not.toBeNull()
			expect(confirmed?.confirmedAt).toBeDefined()

			const db = getTestDb()
			const auditResult = await db.execute(
				/* sql */ `SELECT * FROM audit_log WHERE action = 'routine_review_confirmed'`,
			)
			expect(auditResult.rows.length).toBeGreaterThanOrEqual(1)
		})

		it("should get reviews for a routine ordered by date", async () => {
			const sectionId = await createTestSection("Security", "security")

			const routine = await createRoutine({
				sectionId,
				name: "Scheduled Review",
				description: null,
				frequency: "monthly",
				screeningQuestionId: null,
				screeningChoiceValue: null,
				responsibleRole: null,
				persistenceType: null,
				dataClassification: null,
				controlIds: [],
				technologyElementIds: [],
				createdBy: "test-user",
			})

			await createReview({
				routineId: routine.id,
				applicationId: null,
				title: "Older Review",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date("2024-01-01"),
				createdBy: "test-user",
				participants: [],
			})
			await createReview({
				routineId: routine.id,
				applicationId: null,
				title: "Newer Review",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date("2024-06-01"),
				createdBy: "test-user",
				participants: [],
			})

			const reviews = await getReviewsForRoutine(routine.id)

			expect(reviews).toHaveLength(2)
			expect(reviews[0].title).toBe("Newer Review")
			expect(reviews[1].title).toBe("Older Review")
		})
	})

	// ─── Eligibility ─────────────────────────────────────────────────────

	describe("Eligibility", () => {
		it("should find apps requiring routine based on screening answer", async () => {
			const sectionId = await createTestSection("Security", "security")
			const questionId = await createTestScreeningQuestion(sectionId, "Handles PII?")
			await createTestChoice(questionId, "Yes")

			const appId = await createTestApp("My App")
			await createTestScreeningAnswer(appId, questionId, "Yes")

			const routine = await createRoutine({
				sectionId,
				name: "PII Review",
				description: null,
				frequency: "quarterly",
				screeningQuestionId: questionId,
				screeningChoiceValue: "Yes",
				responsibleRole: null,
				persistenceType: null,
				dataClassification: null,
				controlIds: [],
				technologyElementIds: [],
				createdBy: "test-user",
			})

			const apps = await getAppsRequiringRoutine(routine.id)

			expect(apps).toHaveLength(1)
			expect(apps[0].name).toBe("My App")
		})

		it("should filter apps by technology elements", async () => {
			const sectionId = await createTestSection("Security", "security")
			const questionId = await createTestScreeningQuestion(sectionId, "Uses containers?")
			await createTestChoice(questionId, "Yes")
			const elemId = await createTestTechElement("Docker")

			const app1Id = await createTestApp("Docker App")
			await createTestScreeningAnswer(app1Id, questionId, "Yes")
			await confirmAppTechElement(app1Id, elemId)

			const app2Id = await createTestApp("Non-Docker App")
			await createTestScreeningAnswer(app2Id, questionId, "Yes")

			const routine = await createRoutine({
				sectionId,
				name: "Container Security",
				description: null,
				frequency: "quarterly",
				screeningQuestionId: questionId,
				screeningChoiceValue: "Yes",
				responsibleRole: null,
				persistenceType: null,
				dataClassification: null,
				controlIds: [],
				technologyElementIds: [elemId],
				createdBy: "test-user",
			})

			const apps = await getAppsRequiringRoutine(routine.id)

			expect(apps).toHaveLength(1)
			expect(apps[0].name).toBe("Docker App")
		})

		it("should return no apps when screening answer doesn't match", async () => {
			const sectionId = await createTestSection("Security", "security")
			const questionId = await createTestScreeningQuestion(sectionId, "Handles PII?")
			await createTestChoice(questionId, "Yes")
			await createTestChoice(questionId, "No")

			const appId = await createTestApp("Safe App")
			await createTestScreeningAnswer(appId, questionId, "No")

			const routine = await createRoutine({
				sectionId,
				name: "PII Review",
				description: null,
				frequency: "quarterly",
				screeningQuestionId: questionId,
				screeningChoiceValue: "Yes",
				responsibleRole: null,
				persistenceType: null,
				dataClassification: null,
				controlIds: [],
				technologyElementIds: [],
				createdBy: "test-user",
			})

			const apps = await getAppsRequiringRoutine(routine.id)

			expect(apps).toHaveLength(0)
		})
	})

	// ─── Deadlines ───────────────────────────────────────────────────────

	describe("Deadlines", () => {
		it("should calculate deadline from routine creation when no reviews", () => {
			const createdAt = new Date("2024-01-01")
			const deadline = calculateDeadline(null, createdAt, "quarterly")

			const expected = new Date("2024-01-01")
			expected.setDate(expected.getDate() + 91)
			expect(deadline.getTime()).toBe(expected.getTime())
		})

		it("should calculate deadline from last review", () => {
			const createdAt = new Date("2024-01-01")
			const lastReview = new Date("2024-06-15")
			const deadline = calculateDeadline(lastReview, createdAt, "monthly")

			const expected = new Date("2024-06-15")
			expected.setDate(expected.getDate() + 30)
			expect(deadline.getTime()).toBe(expected.getTime())
		})

		it("should identify overdue routine", async () => {
			const sectionId = await createTestSection("Security", "security")
			const questionId = await createTestScreeningQuestion(sectionId, "Active?")
			await createTestChoice(questionId, "Yes")

			const appId = await createTestApp("Overdue App")
			await createTestScreeningAnswer(appId, questionId, "Yes")

			const routine = await createRoutine({
				sectionId,
				name: "Overdue Routine",
				description: null,
				frequency: "weekly",
				screeningQuestionId: questionId,
				screeningChoiceValue: "Yes",
				responsibleRole: null,
				persistenceType: null,
				dataClassification: null,
				controlIds: [],
				technologyElementIds: [],
				createdBy: "test-user",
			})

			// Backdate the routine so its deadline is in the past
			const db = getTestDb()
			await db.execute(
				/* sql */ `UPDATE routines SET created_at = NOW() - INTERVAL '30 days' WHERE id = '${routine.id}'`,
			)

			const apps = await getAppsRequiringRoutine(routine.id)
			expect(apps).toHaveLength(1)

			const latestReview = await getLatestReviewForApp(routine.id, appId)
			expect(latestReview).toBeNull()

			const updatedRoutine = await getRoutine(routine.id)
			const deadline = calculateDeadline(null, updatedRoutine?.createdAt ?? new Date(), "weekly")
			expect(isOverdue(deadline)).toBe(true)
		})
	})
})
