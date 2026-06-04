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
	getRoutine,
	getRoutinesForSection,
	updateRoutine,
	updateRoutinePriority,
	archiveRoutine,
	createReview,
	getSectionIdsForApp,
	getReviewsForRoutine,
	confirmParticipation,
	getAppsRequiringRoutine,
	getLatestReviewForApp,
	calculateDeadline,
	isOverdue,
	createReviewActivity,
	getReviewActivity,
	recordEntraChange,
	completeReviewActivity,
	getActivitiesForReviews,
	getRoutineDeadlinesForApp,
	findActiveReviewConflict,
	getRoutineActivityLinks,
	getFollowUpReviewsForSection,
} = await import("~/db/queries/routines.server")

const { getRoutineDeadlinesWithControls } = await import("~/db/queries/routine-deadlines.server")
const { upsertUser } = await import("~/db/queries/users.server")

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

async function markRoutineApproved(routineId: string) {
	const db = getTestDb()
	await db.execute(/* sql */ `UPDATE routines SET status = 'approved', updated_by = 'test' WHERE id = '${routineId}'`)
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
			DELETE FROM routine_persistence_links;
			DELETE FROM routine_group_classification_links;
			DELETE FROM routine_oracle_role_criticality_links;
			DELETE FROM routine_screening_questions;
			DELETE FROM routine_controls;
			DELETE FROM routine_technology_elements;
			DELETE FROM ruleset_routines;
			DELETE FROM rulesets;
			DELETE FROM routines;
			DELETE FROM screening_routine_selections;
			DELETE FROM screening_answers;
			DELETE FROM screening_choice_effects;
			DELETE FROM screening_question_choices;
			DELETE FROM screening_question_effects;
			DELETE FROM screening_questions;
			DELETE FROM framework_controls;
			DELETE FROM oracle_role_assessments;
			DELETE FROM application_oracle_instances;
			DELETE FROM application_persistence;
			DELETE FROM application_manual_groups;
			DELETE FROM application_group_assessments;
			DELETE FROM entra_group_classifications;
			DELETE FROM application_auth_integrations;
			DELETE FROM section_ignored_applications;
			DELETE FROM section_environments;
			DELETE FROM application_environments;
			DELETE FROM application_team_mappings;
			DELETE FROM dev_team_nais_team_mappings;
			DELETE FROM application_technology_elements;
			DELETE FROM technology_elements;
			DELETE FROM monitored_applications;
			DELETE FROM nais_teams;
			DELETE FROM dev_teams;
			DELETE FROM sections;
			DELETE FROM audit_log;
		`)
	})

	describe("getSectionIdsForApp", () => {
		it("resolves the same effective sections across all membership paths", async () => {
			const db = getTestDb()
			const directTeamSectionId = await createTestSection("Direct team", "direct-team")
			const directNaisSectionId = await createTestSection("Direct nais", "direct-nais")
			const indirectSectionId = await createTestSection("Indirect", "indirect")
			const excludedSectionId = await createTestSection("Excluded", "excluded")
			const ignoredSectionId = await createTestSection("Ignored", "ignored")
			const appId = await createTestApp("Section app")

			const directTeam = await db.execute(
				/* sql */ `INSERT INTO dev_teams (section_id, name, slug, created_by, updated_by)
					VALUES ('${directTeamSectionId}', 'Direct team', 'direct-team', 'test', 'test') RETURNING id`,
			)
			const indirectTeam = await db.execute(
				/* sql */ `INSERT INTO dev_teams (section_id, name, slug, created_by, updated_by)
					VALUES ('${indirectSectionId}', 'Indirect team', 'indirect-team', 'test', 'test') RETURNING id`,
			)
			const excludedTeam = await db.execute(
				/* sql */ `INSERT INTO dev_teams (section_id, name, slug, created_by, updated_by)
					VALUES ('${excludedSectionId}', 'Excluded team', 'excluded-team', 'test', 'test') RETURNING id`,
			)
			const ignoredTeam = await db.execute(
				/* sql */ `INSERT INTO dev_teams (section_id, name, slug, created_by, updated_by)
					VALUES ('${ignoredSectionId}', 'Ignored team', 'ignored-team', 'test', 'test') RETURNING id`,
			)

			const directTeamId = (directTeam.rows[0] as { id: string }).id
			const indirectTeamId = (indirectTeam.rows[0] as { id: string }).id
			const excludedTeamId = (excludedTeam.rows[0] as { id: string }).id
			const ignoredTeamId = (ignoredTeam.rows[0] as { id: string }).id

			await db.execute(/* sql */ `
				INSERT INTO application_team_mappings (application_id, dev_team_id, created_by)
				VALUES ('${appId}', '${directTeamId}', 'test')
			`)

			const naisRows = await db.execute(/* sql */ `
				INSERT INTO nais_teams (slug, section_id)
				VALUES
					('direct-nais-team', '${directNaisSectionId}'),
					('indirect-nais-team', NULL),
					('excluded-nais-team', NULL),
					('ignored-nais-team', NULL)
				RETURNING id, slug
			`)
			const naisTeams = naisRows.rows as Array<{ id: string; slug: string }>
			const directNaisTeamId = naisTeams.find((row) => row.slug === "direct-nais-team")?.id
			const indirectNaisTeamId = naisTeams.find((row) => row.slug === "indirect-nais-team")?.id
			const excludedNaisTeamId = naisTeams.find((row) => row.slug === "excluded-nais-team")?.id
			const ignoredNaisTeamId = naisTeams.find((row) => row.slug === "ignored-nais-team")?.id

			expect(directNaisTeamId).toBeDefined()
			expect(indirectNaisTeamId).toBeDefined()
			expect(excludedNaisTeamId).toBeDefined()
			expect(ignoredNaisTeamId).toBeDefined()

			await db.execute(/* sql */ `
				INSERT INTO dev_team_nais_team_mappings (dev_team_id, nais_team_id, created_by)
				VALUES
					('${indirectTeamId}', '${indirectNaisTeamId}', 'test'),
					('${excludedTeamId}', '${excludedNaisTeamId}', 'test'),
					('${ignoredTeamId}', '${ignoredNaisTeamId}', 'test')
			`)

			await db.execute(/* sql */ `
				INSERT INTO application_environments (application_id, cluster, namespace, nais_team_id)
				VALUES
					('${appId}', 'prod-gcp', 'kiss', '${directNaisTeamId}'),
					('${appId}', 'dev-gcp', 'kiss', '${indirectNaisTeamId}'),
					('${appId}', 'excluded-cluster', 'kiss', '${excludedNaisTeamId}'),
					('${appId}', 'ignored-cluster', 'kiss', '${ignoredNaisTeamId}')
			`)

			await db.execute(/* sql */ `
				INSERT INTO section_environments (section_id, cluster, included, added_by, updated_by)
				VALUES ('${excludedSectionId}', 'excluded-cluster', false, 'test', 'test')
			`)
			await db.execute(/* sql */ `
				INSERT INTO section_ignored_applications (section_id, application_id, ignored_by)
				VALUES ('${ignoredSectionId}', '${appId}', 'test')
			`)

			const sectionIds = await getSectionIdsForApp(appId)

			expect([...sectionIds].sort()).toEqual([directNaisSectionId, directTeamSectionId, indirectSectionId].sort())
		})

		it("keeps directly mapped apps when they have no environments", async () => {
			const db = getTestDb()
			const sectionId = await createTestSection("No env section", "no-env-section")
			const appId = await createTestApp("No env app")
			const team = await db.execute(
				/* sql */ `INSERT INTO dev_teams (section_id, name, slug, created_by, updated_by)
					VALUES ('${sectionId}', 'No env team', 'no-env-team', 'test', 'test') RETURNING id`,
			)
			const teamId = (team.rows[0] as { id: string }).id

			await db.execute(/* sql */ `
				INSERT INTO application_team_mappings (application_id, dev_team_id, created_by)
				VALUES ('${appId}', '${teamId}', 'test')
			`)
			await db.execute(/* sql */ `
				INSERT INTO section_environments (section_id, cluster, included, added_by, updated_by)
				VALUES ('${sectionId}', 'prod-gcp', false, 'test', 'test')
			`)

			await expect(getSectionIdsForApp(appId)).resolves.toEqual([sectionId])
		})

		it("excludes archived and child applications", async () => {
			const db = getTestDb()
			const sectionId = await createTestSection("Filtered", "filtered")
			const archivedAppId = await createTestApp("Archived app")
			const parentAppId = await createTestApp("Parent app")
			const childAppId = await createTestApp("Child app")
			const team = await db.execute(
				/* sql */ `INSERT INTO dev_teams (section_id, name, slug, created_by, updated_by)
					VALUES ('${sectionId}', 'Filtered team', 'filtered-team', 'test', 'test') RETURNING id`,
			)
			const teamId = (team.rows[0] as { id: string }).id

			await db.execute(/* sql */ `
				INSERT INTO application_team_mappings (application_id, dev_team_id, created_by)
				VALUES
					('${archivedAppId}', '${teamId}', 'test'),
					('${childAppId}', '${teamId}', 'test')
			`)
			await db.execute(/* sql */ `
				UPDATE monitored_applications
				SET archived_at = NOW(), archived_by = 'test', updated_by = 'test'
				WHERE id = '${archivedAppId}'
			`)
			await db.execute(/* sql */ `
				UPDATE monitored_applications
				SET primary_application_id = '${parentAppId}', updated_by = 'test'
				WHERE id = '${childAppId}'
			`)

			await expect(getSectionIdsForApp(archivedAppId)).resolves.toEqual([])
			await expect(getSectionIdsForApp(childAppId)).resolves.toEqual([])
		})
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
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
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
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [elemId],
				createdBy: "Z990001",
			})
			await createRoutine({
				sectionId,
				name: "Dependency Scan",
				description: null,
				frequency: "monthly",
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
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
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [elemId],
				createdBy: "Z990001",
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
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [elem1],
				createdBy: "Z990001",
			})

			const updated = await updateRoutine({
				id: created.id,
				name: "UI Framework Review",
				description: "Updated description",
				frequency: "monthly",
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
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

		it("should soft-delete a routine and keep reviews", async () => {
			const sectionId = await createTestSection("Security", "security")

			const routine = await createRoutine({
				sectionId,
				name: "To Be Deleted",
				description: null,
				frequency: "annually",
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
			})

			await markRoutineApproved(routine.id)
			await createReview({
				routineId: routine.id,
				applicationId: null,
				title: "Review 1",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date(),
				createdBy: "Z990001",
				participants: [],
			})

			await archiveRoutine(routine.id, "admin-user")

			const fetched = await getRoutine(routine.id)
			expect(fetched).not.toBeNull()
			expect(fetched?.archivedAt).not.toBeNull()
			expect(fetched?.archivedBy).toBe("admin-user")

			// Archived routines should not appear in section listings
			const sectionRoutines = await getRoutinesForSection(sectionId)
			expect(sectionRoutines.find((r) => r.id === routine.id)).toBeUndefined()

			// Reviews should be preserved after soft delete
			const db = getTestDb()
			const reviewResult = await db.execute(
				/* sql */ `SELECT * FROM routine_reviews WHERE routine_id = '${routine.id}'`,
			)
			expect(reviewResult.rows.length).toBe(1)

			const auditResult = await db.execute(
				/* sql */ `SELECT * FROM audit_log WHERE action = 'routine_archived' AND entity_id = '${routine.id}'`,
			)
			expect(auditResult.rows.length).toBeGreaterThanOrEqual(1)
		})
	})

	// ─── Reviews ─────────────────────────────────────────────────────────

	describe("Reviews", () => {
		it("should reject creating a review for a routine with status 'ready' (not approved)", async () => {
			const sectionId = await createTestSection("Security", "security")

			const routine = await createRoutine({
				sectionId,
				name: "Not Yet Approved",
				description: null,
				frequency: "annually",
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
			})

			// Set to 'ready' — not 'approved'
			const db = getTestDb()
			await db.execute(/* sql */ `UPDATE routines SET status = 'ready' WHERE id = '${routine.id}'`)

			await expect(
				createReview({
					routineId: routine.id,
					applicationId: null,
					title: "Should fail",
					summary: null,
					routineSnapshotPath: null,
					reviewedAt: new Date(),
					createdBy: "Z990001",
					participants: [],
				}),
			).rejects.toMatchObject({ status: 400 })
		})

		it("should create a review with participants", async () => {
			const sectionId = await createTestSection("Security", "security")

			const routine = await createRoutine({
				sectionId,
				name: "Pen Test",
				description: null,
				frequency: "annually",
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
			})

			await markRoutineApproved(routine.id)
			const review = await createReview({
				routineId: routine.id,
				applicationId: null,
				title: "Q1 Review",
				summary: "All good",
				routineSnapshotPath: null,
				reviewedAt: new Date("2024-03-15"),
				createdBy: "Z990001",
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
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
			})

			await markRoutineApproved(routine.id)
			const review = await createReview({
				routineId: routine.id,
				applicationId: null,
				title: "Review for confirmation",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date(),
				createdBy: "Z990001",
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
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
			})

			await markRoutineApproved(routine.id)
			const olderReview = await createReview({
				routineId: routine.id,
				applicationId: null,
				title: "Older Review",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date("2024-01-01"),
				createdBy: "Z990001",
				participants: [],
			})
			// Complete the first review so the unique active-review index allows a second draft
			const db = getTestDb()
			await db.execute(/* sql */ `UPDATE routine_reviews SET status = 'completed' WHERE id = '${olderReview.id}'`)
			await createReview({
				routineId: routine.id,
				applicationId: null,
				title: "Newer Review",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date("2024-06-01"),
				createdBy: "Z990001",
				participants: [],
			})

			const reviews = await getReviewsForRoutine(routine.id)

			expect(reviews).toHaveLength(2)
			expect(reviews[0].title).toBe("Newer Review")
			expect(reviews[1].title).toBe("Older Review")
		})
	})

	// ─── Aktiv gjennomgang-guard ──────────────────────────────────────────

	describe("findActiveReviewConflict", () => {
		async function makeApprovedRoutine(sectionId: string, name: string) {
			const routine = await createRoutine({
				sectionId,
				name,
				description: null,
				frequency: "annually",
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
			})
			await markRoutineApproved(routine.id)
			return routine
		}

		it("should return null when no active reviews exist", async () => {
			const conflict = await findActiveReviewConflict(
				"00000000-0000-0000-0000-000000000001",
				"00000000-0000-0000-0000-000000000002",
				["entra_id_group_maintenance"],
			)
			expect(conflict).toBeNull()
		})

		it("should return null when activityTypes is empty and no active review for routine", async () => {
			const conflict = await findActiveReviewConflict(
				"00000000-0000-0000-0000-000000000001",
				"00000000-0000-0000-0000-000000000002",
				[],
			)
			expect(conflict).toBeNull()
		})

		it("should detect conflict for an active (draft) review with matching activityType", async () => {
			const sectionId = await createTestSection("Guard test section", "guard-test")
			const appId = await createTestApp("Guard test app")
			const routine = await makeApprovedRoutine(sectionId, "Guard test routine")

			const review = await createReview({
				routineId: routine.id,
				applicationId: appId,
				title: "Active review",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date(),
				createdBy: "Z990001",
				participants: [],
			})
			await createReviewActivity(review.id, "entra_id_group_maintenance", null, "Z990001")

			const conflict = await findActiveReviewConflict(routine.id, appId, ["entra_id_group_maintenance"])
			expect(conflict).not.toBeNull()
			expect(conflict?.activityType).toBe("entra_id_group_maintenance")
			expect(conflict?.reviewId).toBe(review.id)
		})

		it("should detect conflict for needs_follow_up status", async () => {
			const sectionId = await createTestSection("Guard nfu section", "guard-nfu")
			const appId = await createTestApp("Guard nfu app")
			const routine = await makeApprovedRoutine(sectionId, "Guard nfu routine")

			const review = await createReview({
				routineId: routine.id,
				applicationId: appId,
				title: "Needs follow-up review",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date(),
				createdBy: "Z990001",
				participants: [],
			})
			await createReviewActivity(review.id, "entra_id_group_maintenance", null, "Z990001")

			// Set review to needs_follow_up
			const db = getTestDb()
			await db.execute(/* sql */ `UPDATE routine_reviews SET status = 'needs_follow_up' WHERE id = '${review.id}'`)

			const conflict = await findActiveReviewConflict(routine.id, appId, ["entra_id_group_maintenance"])
			expect(conflict).not.toBeNull()
			expect(conflict?.activityType).toBe("entra_id_group_maintenance")
		})

		it("should not detect conflict for completed reviews", async () => {
			const sectionId = await createTestSection("Guard completed section", "guard-completed")
			const appId = await createTestApp("Guard completed app")
			const routine = await makeApprovedRoutine(sectionId, "Guard completed routine")

			const review = await createReview({
				routineId: routine.id,
				applicationId: appId,
				title: "Completed review",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date(),
				createdBy: "Z990001",
				participants: [],
			})
			await createReviewActivity(review.id, "entra_id_group_maintenance", null, "Z990001")

			const db = getTestDb()
			await db.execute(/* sql */ `UPDATE routine_reviews SET status = 'completed' WHERE id = '${review.id}'`)

			const conflict = await findActiveReviewConflict(routine.id, appId, ["entra_id_group_maintenance"])
			expect(conflict).toBeNull()
		})

		it("should not detect conflict for discarded reviews", async () => {
			const sectionId = await createTestSection("Guard discarded section", "guard-discarded")
			const appId = await createTestApp("Guard discarded app")
			const routine = await makeApprovedRoutine(sectionId, "Guard discarded routine")

			const review = await createReview({
				routineId: routine.id,
				applicationId: appId,
				title: "Discarded review",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date(),
				createdBy: "Z990001",
				participants: [],
			})
			await createReviewActivity(review.id, "entra_id_group_maintenance", null, "Z990001")

			const db = getTestDb()
			await db.execute(/* sql */ `UPDATE routine_reviews SET status = 'discarded' WHERE id = '${review.id}'`)

			const conflict = await findActiveReviewConflict(routine.id, appId, ["entra_id_group_maintenance"])
			expect(conflict).toBeNull()
		})

		it("should not detect conflict for a different application", async () => {
			const sectionId = await createTestSection("Guard diff app section", "guard-diff-app")
			const appA = await createTestApp("App A")
			const appB = await createTestApp("App B")
			const routine = await makeApprovedRoutine(sectionId, "Guard diff app routine")

			const review = await createReview({
				routineId: routine.id,
				applicationId: appA,
				title: "App A review",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date(),
				createdBy: "Z990001",
				participants: [],
			})
			await createReviewActivity(review.id, "entra_id_group_maintenance", null, "Z990001")

			const conflict = await findActiveReviewConflict(routine.id, appB, ["entra_id_group_maintenance"])
			expect(conflict).toBeNull()
		})

		it("should detect conflict for section routines (applicationId = null)", async () => {
			const sectionId = await createTestSection("Guard section routine", "guard-section-routine")
			const routine = await makeApprovedRoutine(sectionId, "Guard section routine A")

			const review = await createReview({
				routineId: routine.id,
				applicationId: null,
				title: "Section review",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date(),
				createdBy: "Z990001",
				participants: [],
			})
			await createReviewActivity(review.id, "entra_id_group_maintenance", null, "Z990001")

			const conflict = await findActiveReviewConflict(routine.id, null, ["entra_id_group_maintenance"])
			expect(conflict).not.toBeNull()
			expect(conflict?.activityType).toBe("entra_id_group_maintenance")
		})

		it("should not match null applicationId against a real applicationId", async () => {
			const sectionId = await createTestSection("Guard null vs real", "guard-null-vs-real")
			const appId = await createTestApp("Real app for null test")
			const routine = await makeApprovedRoutine(sectionId, "Guard null vs real routine")

			// Create review for a specific app
			const review = await createReview({
				routineId: routine.id,
				applicationId: appId,
				title: "Real app review",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date(),
				createdBy: "Z990001",
				participants: [],
			})
			await createReviewActivity(review.id, "entra_id_group_maintenance", null, "Z990001")

			// Guard for null (section routine) should not match
			const conflict = await findActiveReviewConflict(routine.id, null, ["entra_id_group_maintenance"])
			expect(conflict).toBeNull()
		})

		// ─── No-activity-type (routine-scoped) guard ──────────────────────────

		it("should detect conflict for routine with no activityTypes (draft review exists)", async () => {
			const sectionId = await createTestSection("Guard no-activity section", "guard-no-activity")
			const appId = await createTestApp("Guard no-activity app")
			const routine = await makeApprovedRoutine(sectionId, "Guard no-activity routine")

			const review = await createReview({
				routineId: routine.id,
				applicationId: appId,
				title: "Active review (no activity)",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date(),
				createdBy: "Z990001",
				participants: [],
			})

			const conflict = await findActiveReviewConflict(routine.id, appId, [])
			expect(conflict).not.toBeNull()
			expect(conflict?.activityType).toBeNull()
			expect(conflict?.reviewId).toBe(review.id)
		})

		it("should detect conflict for no-activity routine with needs_follow_up status", async () => {
			const sectionId = await createTestSection("Guard no-act nfu section", "guard-no-act-nfu")
			const appId = await createTestApp("Guard no-act nfu app")
			const routine = await makeApprovedRoutine(sectionId, "Guard no-act nfu routine")

			const review = await createReview({
				routineId: routine.id,
				applicationId: appId,
				title: "Needs follow-up review (no activity)",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date(),
				createdBy: "Z990001",
				participants: [],
			})
			const db = getTestDb()
			await db.execute(/* sql */ `UPDATE routine_reviews SET status = 'needs_follow_up' WHERE id = '${review.id}'`)

			const conflict = await findActiveReviewConflict(routine.id, appId, [])
			expect(conflict).not.toBeNull()
			expect(conflict?.activityType).toBeNull()
		})

		it("should not detect conflict for completed review with no activityTypes", async () => {
			const sectionId = await createTestSection("Guard no-act completed section", "guard-no-act-completed")
			const appId = await createTestApp("Guard no-act completed app")
			const routine = await makeApprovedRoutine(sectionId, "Guard no-act completed routine")

			const review = await createReview({
				routineId: routine.id,
				applicationId: appId,
				title: "Completed review (no activity)",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date(),
				createdBy: "Z990001",
				participants: [],
			})
			const db = getTestDb()
			await db.execute(/* sql */ `UPDATE routine_reviews SET status = 'completed' WHERE id = '${review.id}'`)

			const conflict = await findActiveReviewConflict(routine.id, appId, [])
			expect(conflict).toBeNull()
		})

		it("should not detect conflict for a different routine when activityTypes is empty", async () => {
			const sectionId = await createTestSection("Guard diff routine section", "guard-diff-routine")
			const appId = await createTestApp("Guard diff routine app")
			const routineA = await makeApprovedRoutine(sectionId, "Guard diff routine A")
			const routineB = await makeApprovedRoutine(sectionId, "Guard diff routine B")

			await createReview({
				routineId: routineA.id,
				applicationId: appId,
				title: "Review for routine A",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date(),
				createdBy: "Z990001",
				participants: [],
			})

			// Guard for routineB should not match routineA's review
			const conflict = await findActiveReviewConflict(routineB.id, appId, [])
			expect(conflict).toBeNull()
		})

		it("should detect conflict for section routine with no activityTypes", async () => {
			const sectionId = await createTestSection("Guard sec no-act section", "guard-sec-no-act")
			const routine = await makeApprovedRoutine(sectionId, "Guard sec no-act routine")

			const review = await createReview({
				routineId: routine.id,
				applicationId: null,
				title: "Section review (no activity)",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date(),
				createdBy: "Z990001",
				participants: [],
			})

			const conflict = await findActiveReviewConflict(routine.id, null, [])
			expect(conflict).not.toBeNull()
			expect(conflict?.activityType).toBeNull()
			expect(conflict?.reviewId).toBe(review.id)
		})

		it("should not block a different section routine with the same activityType", async () => {
			// Regression test: section routines with applicationId=null must be scoped by routineId,
			// not globally. A review for routine A must not block routine B in another section.
			const sectionA = await createTestSection("Guard cross-sec A", "guard-cross-sec-a")
			const sectionB = await createTestSection("Guard cross-sec B", "guard-cross-sec-b")
			const routineA = await makeApprovedRoutine(sectionA, "Guard cross-sec routine A")
			const routineB = await makeApprovedRoutine(sectionB, "Guard cross-sec routine B")

			// Active review for routineA (section routine, same activityType)
			const review = await createReview({
				routineId: routineA.id,
				applicationId: null,
				title: "Section A review",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date(),
				createdBy: "Z990001",
				participants: [],
			})
			await createReviewActivity(review.id, "entra_id_group_maintenance", null, "Z990001")

			// routineB should NOT be blocked
			const conflict = await findActiveReviewConflict(routineB.id, null, ["entra_id_group_maintenance"])
			expect(conflict).toBeNull()
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
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
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
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [elemId],
				createdBy: "Z990001",
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
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
			})

			const apps = await getAppsRequiringRoutine(routine.id)

			expect(apps).toHaveLength(0)
		})

		it("should find apps via persistence links (Path 2)", async () => {
			const db = getTestDb()
			const sectionId = await createTestSection("Security", "security")
			const appId = await createTestApp("Oracle App")

			// App has Oracle persistence with data classification
			await db.execute(
				/* sql */ `INSERT INTO application_persistence (application_id, type, name, data_classification)
				VALUES ('${appId}', 'oracle', 'PROD_DB', 'financial_regulation')`,
			)

			// Routine linked to Oracle + that classification
			const routine = await createRoutine({
				sectionId,
				name: "Oracle Review",
				description: null,
				frequency: "quarterly",
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [{ persistenceType: "oracle", dataClassification: "financial_regulation" }],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
			})

			const apps = await getAppsRequiringRoutine(routine.id)
			expect(apps).toHaveLength(1)
			expect(apps[0].name).toBe("Oracle App")
		})

		it("should NOT match apps with different persistence type (Path 2)", async () => {
			const db = getTestDb()
			const sectionId = await createTestSection("Security", "security")
			const appId = await createTestApp("Postgres App")

			await db.execute(
				/* sql */ `INSERT INTO application_persistence (application_id, type, name, data_classification)
				VALUES ('${appId}', 'nais_postgres', 'PG_DB', 'financial_regulation')`,
			)

			const routine = await createRoutine({
				sectionId,
				name: "Oracle-only Review",
				description: null,
				frequency: "quarterly",
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [{ persistenceType: "oracle", dataClassification: "financial_regulation" }],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
			})

			const apps = await getAppsRequiringRoutine(routine.id)
			expect(apps).toHaveLength(0)
		})

		it("should find apps via group classification links (Path 3)", async () => {
			const db = getTestDb()
			const sectionId = await createTestSection("Security", "security")
			const appId = await createTestApp("Entra App")

			// Create an Entra group with classification
			const groupId = "test-group-001"
			await db.execute(
				/* sql */ `INSERT INTO entra_group_classifications (group_id, classification, created_by, updated_by)
				VALUES ('${groupId}', 'mine_tilganger', 'test', 'test')`,
			)

			// App uses this group via auth integration
			await db.execute(
				/* sql */ `INSERT INTO application_auth_integrations (application_id, type, cluster, groups)
				VALUES ('${appId}', 'entra_id', 'prod-gcp', '["${groupId}"]')`,
			)

			// Routine linked to 'mine_tilganger' classification
			const routine = await createRoutine({
				sectionId,
				name: "Mine Tilganger Review",
				description: null,
				frequency: "quarterly",
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				groupClassifications: ["mine_tilganger"],
				createdBy: "Z990001",
			})

			const apps = await getAppsRequiringRoutine(routine.id)
			expect(apps).toHaveLength(1)
			expect(apps[0].name).toBe("Entra App")
		})

		it("should find apps via manual groups with classification (Path 3)", async () => {
			const db = getTestDb()
			const sectionId = await createTestSection("Security", "security")
			const appId = await createTestApp("Manual Group App")

			const groupId = "manual-group-001"
			await db.execute(
				/* sql */ `INSERT INTO entra_group_classifications (group_id, classification, created_by, updated_by)
				VALUES ('${groupId}', 'identrutina', 'test', 'test')`,
			)

			// App uses this group via manual groups
			await db.execute(
				/* sql */ `INSERT INTO application_manual_groups (application_id, group_id, group_name, created_by)
				VALUES ('${appId}', '${groupId}', 'Test Group', 'test')`,
			)

			const routine = await createRoutine({
				sectionId,
				name: "Identrutina Review",
				description: null,
				frequency: "quarterly",
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				groupClassifications: ["identrutina"],
				createdBy: "Z990001",
			})

			const apps = await getAppsRequiringRoutine(routine.id)
			expect(apps).toHaveLength(1)
			expect(apps[0].name).toBe("Manual Group App")
		})

		it("should find apps via oracle role criticality (Path 4)", async () => {
			const db = getTestDb()
			const sectionId = await createTestSection("Security", "security")
			const appId = await createTestApp("Critical Oracle App")

			// Create Oracle instance first
			await db.execute(
				/* sql */ `INSERT INTO application_oracle_instances (application_id, instance_id, configured_by)
				VALUES ('${appId}', 'INST1', 'test')`,
			)

			// App has an Oracle role assessment with high criticality
			await db.execute(
				/* sql */ `INSERT INTO oracle_role_assessments (application_id, instance_id, role_name, criticality, assessed_by, updated_by)
				VALUES ('${appId}', 'INST1', 'DBA_ROLE', 'high', 'test', 'test')`,
			)

			const routine = await createRoutine({
				sectionId,
				name: "High Criticality Oracle Review",
				description: null,
				frequency: "quarterly",
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				oracleRoleCriticalities: ["high"],
				createdBy: "Z990001",
			})

			const apps = await getAppsRequiringRoutine(routine.id)
			expect(apps).toHaveLength(1)
			expect(apps[0].name).toBe("Critical Oracle App")
		})

		it("should find apps via screening selections (Path 5)", async () => {
			const db = getTestDb()
			const sectionId = await createTestSection("Security", "security")
			const appId = await createTestApp("Selected App")
			const questionId = await createTestScreeningQuestion(sectionId, "Some question?")
			const choiceId = await createTestChoice(questionId, "Yes")

			// Create a control and choice effect (control_id is required)
			const controlResult = await db.execute(
				/* sql */ `INSERT INTO framework_controls (control_id) VALUES ('K-TEST.01') RETURNING id`,
			)
			const controlId = (controlResult.rows[0] as { id: string }).id
			const effectResult = await db.execute(
				/* sql */ `INSERT INTO screening_choice_effects (choice_id, control_id) VALUES ('${choiceId}', '${controlId}') RETURNING id`,
			)
			const effectId = (effectResult.rows[0] as { id: string }).id

			const routine = await createRoutine({
				sectionId,
				name: "Selected Routine",
				description: null,
				frequency: "quarterly",
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
			})

			// Explicit routine selection for this app
			await db.execute(
				/* sql */ `INSERT INTO screening_routine_selections (application_id, choice_effect_id, routine_id, selected_by)
				VALUES ('${appId}', '${effectId}', '${routine.id}', 'test')`,
			)

			const apps = await getAppsRequiringRoutine(routine.id)
			expect(apps).toHaveLength(1)
			expect(apps[0].name).toBe("Selected App")
		})

		it("should find apps via appliesToAllInSection (Path 6)", async () => {
			const db = getTestDb()
			const sectionId = await createTestSection("Security", "security")

			// Create dev team in the section
			const teamResult = await db.execute(
				/* sql */ `INSERT INTO dev_teams (name, slug, section_id, created_by, updated_by)
				VALUES ('Team A', 'team-a', '${sectionId}', 'test', 'test') RETURNING id`,
			)
			const teamId = (teamResult.rows[0] as { id: string }).id

			// Create nais team
			const naisTeamResult = await db.execute(/* sql */ `INSERT INTO nais_teams (slug) VALUES ('team-a') RETURNING id`)
			const naisTeamId = (naisTeamResult.rows[0] as { id: string }).id

			// Link dev team to nais team
			await db.execute(
				/* sql */ `INSERT INTO dev_team_nais_team_mappings (dev_team_id, nais_team_id, created_by)
				VALUES ('${teamId}', '${naisTeamId}', 'test')`,
			)

			// Create app with environment linked to nais team
			const appId = await createTestApp("Section App")
			await db.execute(
				/* sql */ `INSERT INTO application_environments (application_id, cluster, namespace, nais_team_id)
				VALUES ('${appId}', 'prod-gcp', 'team-a', '${naisTeamId}')`,
			)

			// Routine with appliesToAllInSection=true (but NOT isSectionRoutine)
			const routine = await createRoutine({
				sectionId,
				name: "Section-wide Routine",
				description: null,
				frequency: "quarterly",
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: true,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
			})

			const apps = await getAppsRequiringRoutine(routine.id)
			expect(apps).toHaveLength(1)
			expect(apps[0].name).toBe("Section App")
		})

		it("should find apps via ruleset (Path 7)", async () => {
			const db = getTestDb()
			const sectionId = await createTestSection("Security", "security")

			// Create dev team in section
			const teamResult = await db.execute(
				/* sql */ `INSERT INTO dev_teams (name, slug, section_id, created_by, updated_by)
				VALUES ('Team A', 'team-a', '${sectionId}', 'test', 'test') RETURNING id`,
			)
			const teamId = (teamResult.rows[0] as { id: string }).id

			// Create nais team and link to dev team
			const naisTeamResult = await db.execute(/* sql */ `INSERT INTO nais_teams (slug) VALUES ('team-a') RETURNING id`)
			const naisTeamId = (naisTeamResult.rows[0] as { id: string }).id
			await db.execute(
				/* sql */ `INSERT INTO dev_team_nais_team_mappings (dev_team_id, nais_team_id, created_by)
				VALUES ('${teamId}', '${naisTeamId}', 'test')`,
			)

			// Create app with environment linked to nais team (section membership)
			const appId = await createTestApp("Ruleset App")
			await db.execute(
				/* sql */ `INSERT INTO application_environments (application_id, cluster, namespace, nais_team_id)
				VALUES ('${appId}', 'prod-gcp', 'team-a', '${naisTeamId}')`,
			)

			// Create a ruleset
			const rulesetResult = await db.execute(
				/* sql */ `INSERT INTO rulesets (section_id, name, frequency, status, created_by, updated_by)
				VALUES ('${sectionId}', 'Test Ruleset', 'quarterly', 'active', 'test', 'test') RETURNING id`,
			)
			const rulesetId = (rulesetResult.rows[0] as { id: string }).id

			// Create routine
			const routine = await createRoutine({
				sectionId,
				name: "Ruleset Routine",
				description: null,
				frequency: "quarterly",
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
			})

			// Link routine to ruleset
			await db.execute(
				/* sql */ `INSERT INTO ruleset_routines (ruleset_id, routine_id, created_by)
				VALUES ('${rulesetId}', '${routine.id}', 'test')`,
			)

			// Create screening question linked to ruleset
			const questionResult = await db.execute(
				/* sql */ `INSERT INTO screening_questions (section_id, ruleset_id, question_text, answer_type, status, created_by, updated_by)
				VALUES ('${sectionId}', '${rulesetId}', 'Select ruleset', 'boolean', 'approved', 'test', 'test') RETURNING id`,
			)
			const questionId = (questionResult.rows[0] as { id: string }).id

			// App answered the screening question
			await createTestScreeningAnswer(appId, questionId, "Yes")

			const apps = await getAppsRequiringRoutine(routine.id)
			expect(apps).toHaveLength(1)
			expect(apps[0].name).toBe("Ruleset App")
		})

		it("should deduplicate apps matched by multiple paths", async () => {
			const db = getTestDb()
			const sectionId = await createTestSection("Security", "security")
			const questionId = await createTestScreeningQuestion(sectionId, "Uses Oracle?")
			await createTestChoice(questionId, "Yes")

			const appId = await createTestApp("Multi-match App")

			// Match via screening question (Path 1)
			await createTestScreeningAnswer(appId, questionId, "Yes")

			// Also match via persistence (Path 2)
			await db.execute(
				/* sql */ `INSERT INTO application_persistence (application_id, type, name)
				VALUES ('${appId}', 'oracle', 'ORA_DB')`,
			)

			const routine = await createRoutine({
				sectionId,
				name: "Oracle Review",
				description: null,
				frequency: "quarterly",
				screeningQuestionId: questionId,
				screeningChoiceValue: "Yes",
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [{ persistenceType: "oracle", dataClassification: null }],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
			})

			const apps = await getAppsRequiringRoutine(routine.id)
			// Should return exactly 1 (not 2)
			expect(apps).toHaveLength(1)
			expect(apps[0].name).toBe("Multi-match App")
		})

		it("should return empty for routine with no matching paths at all", async () => {
			const sectionId = await createTestSection("Security", "security")

			// Routine with NO links of any kind
			const routine = await createRoutine({
				sectionId,
				name: "Orphan Routine",
				description: null,
				frequency: "quarterly",
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
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
			expect(deadline).not.toBeNull()
			expect(deadline?.getTime()).toBe(expected.getTime())
		})

		it("should calculate deadline from last review", () => {
			const createdAt = new Date("2024-01-01")
			const lastReview = new Date("2024-06-15")
			const deadline = calculateDeadline(lastReview, createdAt, "monthly")

			const expected = new Date("2024-06-15")
			expected.setDate(expected.getDate() + 30)
			expect(deadline).not.toBeNull()
			expect(deadline?.getTime()).toBe(expected.getTime())
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
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
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

	describe("Event-only routines (hendelsesbasert)", () => {
		it("should return null deadline when frequency is null", () => {
			const deadline = calculateDeadline(null, new Date(), null)
			expect(deadline).toBeNull()
		})

		it("should not be overdue when deadline is null", () => {
			expect(isOverdue(null)).toBe(false)
		})

		it("should create routine with eventFrequency and null frequency", async () => {
			const sectionId = await createTestSection("event-section", "event-section")
			const questionId = await createTestScreeningQuestion(sectionId, "Uses events?")
			await createTestChoice(questionId, "Yes")

			const routine = await createRoutine({
				sectionId,
				name: "Event Only Routine",
				description: "Triggered on demand",
				frequency: null,
				eventFrequency: "Ved behov",
				screeningQuestionId: questionId,
				screeningChoiceValue: "Yes",
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
			})

			expect(routine.frequency).toBeNull()
			expect(routine.eventFrequency).toBe("Ved behov")

			const fetched = await getRoutine(routine.id)
			expect(fetched?.frequency).toBeNull()
			expect(fetched?.eventFrequency).toBe("Ved behov")
		})

		it("should create routine with both frequency and eventFrequency", async () => {
			const sectionId = await createTestSection("dual-section", "dual-section")
			const questionId = await createTestScreeningQuestion(sectionId, "Dual freq?")
			await createTestChoice(questionId, "Yes")

			const routine = await createRoutine({
				sectionId,
				name: "Dual Frequency Routine",
				description: "Periodic and on demand",
				frequency: "quarterly",
				eventFrequency: "Ved endring",
				screeningQuestionId: questionId,
				screeningChoiceValue: "Yes",
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
			})

			expect(routine.frequency).toBe("quarterly")
			expect(routine.eventFrequency).toBe("Ved endring")

			const deadline = calculateDeadline(null, routine.createdAt, routine.frequency)
			expect(deadline).not.toBeNull()
		})

		it("should still allow reviews on event-only routines", async () => {
			const sectionId = await createTestSection("event-review-section", "event-review-section")
			const questionId = await createTestScreeningQuestion(sectionId, "Has events?")
			await createTestChoice(questionId, "Yes")

			const routine = await createRoutine({
				sectionId,
				name: "Reviewable Event Routine",
				description: null,
				frequency: null,
				eventFrequency: "Ved behov",
				screeningQuestionId: questionId,
				screeningChoiceValue: "Yes",
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
			})

			const appId = await createTestApp("Event Review App")
			await createTestScreeningAnswer(appId, questionId, "Yes")

			await markRoutineApproved(routine.id)

			const review = await createReview({
				routineId: routine.id,
				applicationId: appId,
				title: "On-demand review",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date(),
				createdBy: "Z990001",
				participants: [{ userIdent: "Z990001", userName: "Frisk Ål" }],
			})

			expect(review.routineId).toBe(routine.id)

			const reviews = await getReviewsForRoutine(routine.id)
			expect(reviews.length).toBeGreaterThanOrEqual(1)
		})
	})

	describe("Review Activities", () => {
		it("should create and retrieve a review activity", async () => {
			const sectionId = await createTestSection("act-section", "act-section")
			const routine = await createRoutine({
				sectionId,
				name: "Entra-rutine",
				description: "Rutine med Entra-vedlikehold",
				frequency: "monthly",
				responsibleRole: null,
				appliesToAllInSection: false,
				persistenceLinks: [],
				screeningQuestionId: null,
				screeningChoiceValue: null,
				controlIds: [],
				technologyElementIds: [],
				createdBy: "test",
				activityTypes: ["entra_id_group_maintenance"],
			})

			await markRoutineApproved(routine.id)
			const review = await createReview({
				routineId: routine.id,
				applicationId: null,
				title: "Test gjennomgang",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date(),
				createdBy: "test",
				participants: [],
			})

			const activity = await createReviewActivity(
				review.id,
				"entra_id_group_maintenance",
				{
					groups: [
						{
							groupId: "group-1",
							groupName: "Group 1",
							source: "nais_auth",
							hasNaisSource: true,
							hasManualSource: false,
							isGone: false,
							criticality: null,
						},
						{
							groupId: "group-2",
							groupName: "Group 2",
							source: "manual",
							hasNaisSource: false,
							hasManualSource: true,
							isGone: false,
							criticality: "high",
						},
					],
				},
				"test",
			)

			expect(activity).toBeDefined()
			expect(activity.id).toBeTruthy()
			expect(activity.reviewId).toBe(review.id)
			expect(activity.type).toBe("entra_id_group_maintenance")
			expect(activity.status).toBe("pending")
			expect(activity.snapshotBefore).toEqual({
				groups: [
					{
						groupId: "group-1",
						groupName: "Group 1",
						source: "nais_auth",
						hasNaisSource: true,
						hasManualSource: false,
						isGone: false,
						criticality: null,
					},
					{
						groupId: "group-2",
						groupName: "Group 2",
						source: "manual",
						hasNaisSource: false,
						hasManualSource: true,
						isGone: false,
						criticality: "high",
					},
				],
			})
			expect(activity.snapshotAfter).toBeNull()

			const fetched = await getReviewActivity(review.id)
			expect(fetched).toBeDefined()
			expect(fetched?.id).toBe(activity.id)
		})

		it("should record Entra changes on an activity", async () => {
			const sectionId = await createTestSection("act-changes-section", "act-changes-section")
			const routine = await createRoutine({
				sectionId,
				name: "Entra-rutine 2",
				description: "Test",
				frequency: "monthly",
				responsibleRole: null,
				appliesToAllInSection: false,
				persistenceLinks: [],
				screeningQuestionId: null,
				screeningChoiceValue: null,
				controlIds: [],
				technologyElementIds: [],
				createdBy: "test",
				activityTypes: ["entra_id_group_maintenance"],
			})

			await markRoutineApproved(routine.id)
			const review = await createReview({
				routineId: routine.id,
				applicationId: null,
				title: "Gjennomgang 2",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date(),
				createdBy: "test",
				participants: [],
			})

			const activity = await createReviewActivity(review.id, "entra_id_group_maintenance", { groups: [] }, "test")

			await recordEntraChange({
				activityId: activity.id,
				changeType: "added",
				groupId: "group-abc",
				groupName: "Test Group ABC",
				previousValue: null,
				newValue: "group-abc",
				performedBy: "test",
			})

			await recordEntraChange({
				activityId: activity.id,
				changeType: "criticality_changed",
				groupId: "group-abc",
				groupName: "Test Group ABC",
				previousValue: "low",
				newValue: "high",
				performedBy: "test",
			})

			await recordEntraChange({
				activityId: activity.id,
				changeType: "removed",
				groupId: "group-xyz",
				groupName: "Old Group XYZ",
				previousValue: "group-xyz",
				newValue: null,
				performedBy: "test",
			})

			const activities = await getActivitiesForReviews([review.id])
			expect(activities).toHaveLength(1)
			expect(activities[0].changes).toHaveLength(3)

			const addChange = activities[0].changes.find((c) => c.changeType === "added")
			expect(addChange?.groupId).toBe("group-abc")
			expect(addChange?.groupName).toBe("Test Group ABC")
			expect(addChange?.newValue).toBe("group-abc")

			const critChange = activities[0].changes.find((c) => c.changeType === "criticality_changed")
			expect(critChange?.previousValue).toBe("low")
			expect(critChange?.newValue).toBe("high")

			const removeChange = activities[0].changes.find((c) => c.changeType === "removed")
			expect(removeChange?.groupId).toBe("group-xyz")
			expect(removeChange?.previousValue).toBe("group-xyz")
		})

		it("should complete an activity with snapshot after", async () => {
			const sectionId = await createTestSection("act-complete-section", "act-complete-section")
			const routine = await createRoutine({
				sectionId,
				name: "Entra-rutine 3",
				description: "Test complete",
				frequency: "quarterly",
				responsibleRole: null,
				appliesToAllInSection: false,
				persistenceLinks: [],
				screeningQuestionId: null,
				screeningChoiceValue: null,
				controlIds: [],
				technologyElementIds: [],
				createdBy: "test",
				activityTypes: ["entra_id_group_maintenance"],
			})

			await markRoutineApproved(routine.id)
			const review = await createReview({
				routineId: routine.id,
				applicationId: null,
				title: "Gjennomgang 3",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date(),
				createdBy: "test",
				participants: [],
			})

			const activity = await createReviewActivity(
				review.id,
				"entra_id_group_maintenance",
				{
					groups: [
						{
							groupId: "a",
							groupName: "A",
							source: "nais_auth",
							hasNaisSource: true,
							hasManualSource: false,
							isGone: false,
							criticality: null,
						},
					],
				},
				"test",
			)

			expect(activity.status).toBe("pending")
			expect(activity.completedAt).toBeNull()

			const completed = await completeReviewActivity(
				activity.id,
				{
					groups: [
						{
							groupId: "a",
							groupName: "A",
							source: "nais_auth",
							hasNaisSource: true,
							hasManualSource: false,
							isGone: false,
							criticality: null,
						},
						{
							groupId: "b",
							groupName: "B",
							source: "manual",
							hasNaisSource: false,
							hasManualSource: true,
							isGone: false,
							criticality: "low",
						},
					],
				},
				"test",
			)

			expect(completed.status).toBe("completed")
			expect(completed.completedAt).toBeDefined()
			expect(completed.snapshotAfter).toEqual({
				groups: [
					{
						groupId: "a",
						groupName: "A",
						source: "nais_auth",
						hasNaisSource: true,
						hasManualSource: false,
						isGone: false,
						criticality: null,
					},
					{
						groupId: "b",
						groupName: "B",
						source: "manual",
						hasNaisSource: false,
						hasManualSource: true,
						isGone: false,
						criticality: "low",
					},
				],
			})
		})

		it("should return empty for reviews with no activities", async () => {
			const activities = await getActivitiesForReviews([])
			expect(activities).toEqual([])

			const activities2 = await getActivitiesForReviews(["00000000-0000-0000-0000-000000000000"])
			expect(activities2).toEqual([])
		})

		it("should support activityTypes on routine create and update", async () => {
			const sectionId = await createTestSection("act-type-section", "act-type-section")

			const routine = await createRoutine({
				sectionId,
				name: "Med aktivitetstype",
				description: "Test",
				frequency: "monthly",
				responsibleRole: null,
				appliesToAllInSection: false,
				persistenceLinks: [],
				screeningQuestionId: null,
				screeningChoiceValue: null,
				controlIds: [],
				technologyElementIds: [],
				createdBy: "test",
				activityTypes: ["entra_id_group_maintenance"],
			})

			const links = await getRoutineActivityLinks(routine.id)
			expect(links).toHaveLength(1)
			expect(links[0].activityType).toBe("entra_id_group_maintenance")

			await updateRoutine({
				id: routine.id,
				name: "Uten aktivitetstype",
				description: "Updated",
				frequency: "monthly",
				responsibleRole: null,
				appliesToAllInSection: false,
				persistenceLinks: [],
				screeningQuestionId: null,
				screeningChoiceValue: null,
				controlIds: [],
				technologyElementIds: [],
				updatedBy: "test",
				activityTypes: [],
			})

			const updatedLinks = await getRoutineActivityLinks(routine.id)
			expect(updatedLinks).toHaveLength(0)
		})
	})

	// ─── Ruleset Routine Filtering ──────────────────────────────────────

	describe("getRoutineDeadlinesForAppByRuleset", () => {
		async function createTestNaisTeam(slug: string, sectionId: string) {
			const db = getTestDb()
			const result = await db.execute(
				/* sql */ `INSERT INTO nais_teams (slug, section_id) VALUES ('${slug}', '${sectionId}') RETURNING id`,
			)
			return (result.rows[0] as { id: string }).id
		}

		async function createTestAppEnvironment(appId: string, naisTeamId: string) {
			const db = getTestDb()
			await db.execute(
				/* sql */ `INSERT INTO application_environments (application_id, cluster, namespace, nais_team_id) VALUES ('${appId}', 'prod-gcp', 'test-ns', '${naisTeamId}')`,
			)
		}

		async function createTestRuleset(sectionId: string, name: string, status = "active") {
			const db = getTestDb()
			const result = await db.execute(
				/* sql */ `INSERT INTO rulesets (section_id, name, frequency, status, created_by, updated_by) VALUES ('${sectionId}', '${name}', 'quarterly', '${status}', 'test', 'test') RETURNING id`,
			)
			return (result.rows[0] as { id: string }).id
		}

		async function linkRulesetRoutine(rulesetId: string, routineId: string) {
			const db = getTestDb()
			await db.execute(
				/* sql */ `INSERT INTO ruleset_routines (ruleset_id, routine_id, created_by) VALUES ('${rulesetId}', '${routineId}', 'test')`,
			)
		}

		async function createApprovedScreeningQuestion(sectionId: string, text: string, rulesetId: string | null) {
			const db = getTestDb()
			const rulesetVal = rulesetId ? `'${rulesetId}'` : "NULL"
			const result = await db.execute(
				/* sql */ `INSERT INTO screening_questions (section_id, question_text, answer_type, status, ruleset_id, created_by, updated_by) VALUES ('${sectionId}', '${text}', 'boolean', 'approved', ${rulesetVal}, 'test', 'test') RETURNING id`,
			)
			return (result.rows[0] as { id: string }).id
		}

		it("should NOT return ruleset routines when app has no screening answers", async () => {
			const { getRoutineDeadlinesForAppByRuleset } = await import("~/db/queries/routines.server")

			const sectionId = await createTestSection("Sec1", "sec1")
			const appId = await createTestApp("my-app")
			const teamId = await createTestNaisTeam("team1", sectionId)
			await createTestAppEnvironment(appId, teamId)

			const rulesetId = await createTestRuleset(sectionId, "Endringshåndtering")
			const routine = await createRoutine({
				sectionId,
				name: "Review Routine",
				description: null,
				frequency: "quarterly",
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				screeningQuestionLinks: [],
				groupClassifications: [],
				oracleRoleCriticalities: [],
				createdBy: "test",
			})
			await markRoutineApproved(routine.id)
			await linkRulesetRoutine(rulesetId, routine.id)

			const results = await getRoutineDeadlinesForAppByRuleset(appId)
			expect(results).toHaveLength(0)
		})

		it("should return ruleset routines when app has answered a linked screening question", async () => {
			const { getRoutineDeadlinesForAppByRuleset } = await import("~/db/queries/routines.server")

			const sectionId = await createTestSection("Sec2", "sec2")
			const appId = await createTestApp("my-app-2")
			const teamId = await createTestNaisTeam("team2", sectionId)
			await createTestAppEnvironment(appId, teamId)

			const rulesetId = await createTestRuleset(sectionId, "Endringshåndtering")
			const questionId = await createApprovedScreeningQuestion(sectionId, "Har du endringshåndtering?", rulesetId)

			const routine = await createRoutine({
				sectionId,
				name: "Review Routine",
				description: null,
				frequency: "quarterly",
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				screeningQuestionLinks: [],
				groupClassifications: [],
				oracleRoleCriticalities: [],
				createdBy: "test",
			})
			await markRoutineApproved(routine.id)
			await linkRulesetRoutine(rulesetId, routine.id)

			// Answer the screening question
			await createTestScreeningAnswer(appId, questionId, "Ja")

			const results = await getRoutineDeadlinesForAppByRuleset(appId)
			expect(results).toHaveLength(1)
			expect(results[0].routine?.name).toBe("Review Routine")
		})

		it("should NOT return routines for a ruleset when the answered question is linked to a different ruleset", async () => {
			const { getRoutineDeadlinesForAppByRuleset } = await import("~/db/queries/routines.server")

			const sectionId = await createTestSection("Sec3", "sec3")
			const appId = await createTestApp("my-app-3")
			const teamId = await createTestNaisTeam("team3", sectionId)
			await createTestAppEnvironment(appId, teamId)

			const rulesetA = await createTestRuleset(sectionId, "Ruleset A")
			const rulesetB = await createTestRuleset(sectionId, "Ruleset B")
			await createApprovedScreeningQuestion(sectionId, "Question for A", rulesetA)
			const questionB = await createApprovedScreeningQuestion(sectionId, "Question for B", rulesetB)

			const routineA = await createRoutine({
				sectionId,
				name: "Routine for A",
				description: null,
				frequency: "quarterly",
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				screeningQuestionLinks: [],
				groupClassifications: [],
				oracleRoleCriticalities: [],
				createdBy: "test",
			})
			await markRoutineApproved(routineA.id)
			await linkRulesetRoutine(rulesetA, routineA.id)

			// App only answers question B — should NOT get routine A
			await createTestScreeningAnswer(appId, questionB, "Ja")

			const results = await getRoutineDeadlinesForAppByRuleset(appId)
			// Should not include routineA since the app only answered the question for rulesetB
			const routineAResult = results.find((r) => r.routine?.name === "Routine for A")
			expect(routineAResult).toBeUndefined()
		})
		it("should return ruleset routines when app selects a ruleset via a 'ruleset' type screening question", async () => {
			const { getRoutineDeadlinesForAppByRuleset } = await import("~/db/queries/routines.server")

			const sectionId = await createTestSection("Sec4", "sec4")
			const appId = await createTestApp("my-app-4")
			const teamId = await createTestNaisTeam("team4", sectionId)
			await createTestAppEnvironment(appId, teamId)

			const rulesetId = await createTestRuleset(sectionId, "Standard regelsett")

			// Create a 'ruleset' type question (rulesetId on the question is NULL — the answer IS the ruleset ID)
			const db = getTestDb()
			const result = await db.execute(
				/* sql */ `INSERT INTO screening_questions (section_id, question_text, answer_type, status, ruleset_id, created_by, updated_by) VALUES ('${sectionId}', 'Hvilket regelsett bruker appen?', 'ruleset', 'approved', NULL, 'test', 'test') RETURNING id`,
			)
			const questionId = (result.rows[0] as { id: string }).id

			const routine = await createRoutine({
				sectionId,
				name: "Ruleset Routine",
				description: null,
				frequency: "quarterly",
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				screeningQuestionLinks: [],
				groupClassifications: [],
				oracleRoleCriticalities: [],
				createdBy: "test",
			})
			await markRoutineApproved(routine.id)
			await linkRulesetRoutine(rulesetId, routine.id)

			// Answer the screening question with the ruleset ID as the answer
			await createTestScreeningAnswer(appId, questionId, rulesetId)

			const results = await getRoutineDeadlinesForAppByRuleset(appId)
			expect(results).toHaveLength(1)
			expect(results[0].routine?.name).toBe("Ruleset Routine")
		})
	})

	describe("getRoutineDeadlinesForApp", () => {
		it("returns empty when app has no screening answers", async () => {
			const appId = await createTestApp("No-Answers App")
			const results = await getRoutineDeadlinesForApp(appId)
			expect(results).toHaveLength(0)
		})

		it("matches routines via routine_screening_questions", async () => {
			const sectionId = await createTestSection("Screening Q Section", "screening-q-section")
			const appId = await createTestApp("Screening Q App")
			const questionId = await createTestScreeningQuestion(sectionId, "Has CI/CD?")
			const choiceLabel = "yes"
			await createTestChoice(questionId, choiceLabel)

			const routine = await createRoutine({
				name: "CI/CD Routine",
				description: "Routine matched via screening questions",
				sectionId,
				frequency: "annually",
				screeningQuestionId: null,
				screeningChoiceValue: null,
				responsibleRole: null,
				appliesToAllInSection: false,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "test",
			})
			const routineId = routine.id
			await markRoutineApproved(routineId)

			// Link routine to screening question + choice
			const db = getTestDb()
			await db.execute(
				/* sql */ `INSERT INTO routine_screening_questions (routine_id, question_id, choice_value)
					VALUES ('${routineId}', '${questionId}', '${choiceLabel}')`,
			)

			// App answers the screening question with matching choice
			await createTestScreeningAnswer(appId, questionId, choiceLabel)

			const results = await getRoutineDeadlinesForApp(appId)
			expect(results).toHaveLength(1)
			expect(results[0].routine?.id).toBe(routineId)
			expect(results[0].routine?.name).toBe("CI/CD Routine")
		})

		it("matches routines via legacy screeningQuestionId/screeningChoiceValue fields", async () => {
			const sectionId = await createTestSection("Legacy Section", "legacy-section")
			const appId = await createTestApp("Legacy App")
			const questionId = await createTestScreeningQuestion(sectionId, "Uses database?")
			const choiceLabel = "yes"
			await createTestChoice(questionId, choiceLabel)

			// Create routine with legacy screening fields
			const db = getTestDb()
			const result = await db.execute(
				/* sql */ `INSERT INTO routines (name, description, section_id, frequency, status, screening_question_id, screening_choice_value, created_by, updated_by)
					VALUES ('Legacy Routine', 'Matched via legacy fields', '${sectionId}', 'annually', 'approved', '${questionId}', '${choiceLabel}', 'test', 'test')
					RETURNING id`,
			)
			const routineId = (result.rows[0] as { id: string }).id

			// App answers the screening question
			await createTestScreeningAnswer(appId, questionId, choiceLabel)

			const results = await getRoutineDeadlinesForApp(appId)
			expect(results).toHaveLength(1)
			expect(results[0].routine?.id).toBe(routineId)
			expect(results[0].routine?.name).toBe("Legacy Routine")
		})

		it("does not match non-approved or archived routines", async () => {
			const sectionId = await createTestSection("Filter Section", "filter-section")
			const appId = await createTestApp("Filter App")
			const questionId = await createTestScreeningQuestion(sectionId, "Has monitoring?")
			const choiceLabel = "yes"
			await createTestChoice(questionId, choiceLabel)

			// Draft routine (not approved)
			const draftRoutine = await createRoutine({
				name: "Draft Routine",
				description: "Should not match",
				sectionId,
				frequency: "annually",
				screeningQuestionId: null,
				screeningChoiceValue: null,
				responsibleRole: null,
				appliesToAllInSection: false,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "test",
			})
			const draftId = draftRoutine.id
			const db = getTestDb()
			await db.execute(
				/* sql */ `INSERT INTO routine_screening_questions (routine_id, question_id, choice_value)
					VALUES ('${draftId}', '${questionId}', '${choiceLabel}')`,
			)

			// Archived routine (approved but archived)
			const archivedRoutine = await createRoutine({
				name: "Archived Routine",
				description: "Should not match because archived",
				sectionId,
				frequency: "annually",
				screeningQuestionId: null,
				screeningChoiceValue: null,
				responsibleRole: null,
				appliesToAllInSection: false,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "test",
			})
			const archivedId = archivedRoutine.id
			await markRoutineApproved(archivedId)
			await db.execute(
				/* sql */ `UPDATE routines SET archived_at = NOW(), archived_by = 'test' WHERE id = '${archivedId}'`,
			)
			await db.execute(
				/* sql */ `INSERT INTO routine_screening_questions (routine_id, question_id, choice_value)
					VALUES ('${archivedId}', '${questionId}', '${choiceLabel}')`,
			)

			await createTestScreeningAnswer(appId, questionId, choiceLabel)

			const results = await getRoutineDeadlinesForApp(appId)
			// Neither draft nor archived routine should appear
			expect(results.every((r) => r.routine?.id !== draftId)).toBe(true)
			expect(results.every((r) => r.routine?.id !== archivedId)).toBe(true)
		})
	})

	describe("updateRoutinePriority", () => {
		it("should update priority and set priorityUpdatedAt/By", async () => {
			const db = getTestDb()
			const sectionId = await createTestSection("Priority Section", "priority-section")
			const routine = await createRoutine({
				sectionId,
				name: "Prioritetsrutine",
				description: null,
				frequency: "quarterly",
				eventFrequency: null,
				responsibleRole: null,
				appliesToAllInSection: false,
				isSectionRoutine: false,
				sectionRoutineOwnerRole: null,
				screeningQuestionId: null,
				screeningChoiceValue: null,
				technologyElementIds: [],
				controlIds: [],
				persistenceLinks: [],
				createdBy: "Z990001",
			})

			const result = await updateRoutinePriority(routine.id, 1, "prioritet-bruker")
			expect(result.priority).toBe(1)
			expect(result.priorityUpdatedBy).toBe("prioritet-bruker")
			expect(result.priorityUpdatedAt).toBeTruthy()

			const fetched = await getRoutine(routine.id)
			expect(fetched?.priority).toBe(1)
			expect(fetched?.priorityUpdatedBy).toBe("prioritet-bruker")

			const auditResult = await db.execute(
				/* sql */ `SELECT * FROM audit_log WHERE action = 'routine_priority_changed' AND entity_id = '${routine.id}'`,
			)
			expect(auditResult.rows.length).toBe(1)
			const auditRow = auditResult.rows[0] as { previous_value: string; new_value: string; performed_by: string }
			expect(auditRow.previous_value).toBe("3")
			expect(auditRow.new_value).toBe("1")
			expect(auditRow.performed_by).toBe("prioritet-bruker")
		})

		it("should return existing routine without changes when priority is unchanged", async () => {
			const db = getTestDb()
			const sectionId = await createTestSection("Priority Noop Section", "priority-noop-section")
			const routine = await createRoutine({
				sectionId,
				name: "Uendret prioritetsrutine",
				description: null,
				frequency: "quarterly",
				eventFrequency: null,
				responsibleRole: null,
				appliesToAllInSection: false,
				isSectionRoutine: false,
				sectionRoutineOwnerRole: null,
				screeningQuestionId: null,
				screeningChoiceValue: null,
				technologyElementIds: [],
				controlIds: [],
				persistenceLinks: [],
				createdBy: "Z990001",
				priority: 2,
			})

			const result = await updateRoutinePriority(routine.id, 2, "Z990001")
			expect(result.priority).toBe(2)

			const auditResult = await db.execute(
				/* sql */ `SELECT * FROM audit_log WHERE action = 'routine_priority_changed' AND entity_id = '${routine.id}'`,
			)
			expect(auditResult.rows.length).toBe(0)
		})

		it("should reject updates to archived routines", async () => {
			const sectionId = await createTestSection("Priority Archive Section", "priority-archive-section")
			const routine = await createRoutine({
				sectionId,
				name: "Arkivert prioritetsrutine",
				description: null,
				frequency: "quarterly",
				eventFrequency: null,
				responsibleRole: null,
				appliesToAllInSection: false,
				isSectionRoutine: false,
				sectionRoutineOwnerRole: null,
				screeningQuestionId: null,
				screeningChoiceValue: null,
				technologyElementIds: [],
				controlIds: [],
				persistenceLinks: [],
				createdBy: "Z990001",
			})
			await markRoutineApproved(routine.id)
			await archiveRoutine(routine.id, "Z990001")

			await expect(updateRoutinePriority(routine.id, 1, "Z990001")).rejects.toThrow()
		})

		it("should reject invalid priority values at runtime", async () => {
			const sectionId = await createTestSection("Priority Invalid Section", "priority-invalid-section")
			const routine = await createRoutine({
				sectionId,
				name: "Ugyldig prioritetsrutine",
				description: null,
				frequency: "quarterly",
				eventFrequency: null,
				responsibleRole: null,
				appliesToAllInSection: false,
				isSectionRoutine: false,
				sectionRoutineOwnerRole: null,
				screeningQuestionId: null,
				screeningChoiceValue: null,
				technologyElementIds: [],
				controlIds: [],
				persistenceLinks: [],
				createdBy: "Z990001",
			})

			await expect(updateRoutinePriority(routine.id, 0 as 1 | 2 | 3, "Z990001")).rejects.toThrow()
			await expect(updateRoutinePriority(routine.id, 4 as 1 | 2 | 3, "Z990001")).rejects.toThrow()
		})
	})

	describe("getRoutineDeadlinesWithControls — screening_selection unlinking", () => {
		async function setupScreeningSelectionFixture(label: string) {
			const db = getTestDb()
			const sectionId = await createTestSection(`Seksjon ${label}`, `seksjon-${label}`)
			const appId = await createTestApp(`Stille Fjord ${label}`)
			const questionId = await createTestScreeningQuestion(sectionId, `Har du Oracle ${label}?`)
			const choiceId = await createTestChoice(questionId, "Ja")
			const controlResult = await db.execute(
				/* sql */ `INSERT INTO framework_controls (control_id) VALUES ('K-TEST.SRS.${label}') RETURNING id`,
			)
			const controlId = (controlResult.rows[0] as { id: string }).id
			const effectResult = await db.execute(
				/* sql */ `INSERT INTO screening_choice_effects (choice_id, control_id, effect, preset_routine_id)
				VALUES ('${choiceId}', '${controlId}', 'preset_routine', NULL) RETURNING id`,
			)
			const effectId = (effectResult.rows[0] as { id: string }).id

			const routine = await createRoutine({
				sectionId,
				name: `Rutine ${label}`,
				description: null,
				frequency: "annually",
				screeningQuestionId: null,
				screeningChoiceValue: null,
				responsibleRole: null,
				appliesToAllInSection: false,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
			})
			await markRoutineApproved(routine.id)

			return { appId, effectId, routine }
		}

		it("viser ikke rutinen når screening_routine_selections-raden er arkivert", async () => {
			const db = getTestDb()
			const { appId, effectId, routine } = await setupScreeningSelectionFixture("1")

			// Legg til aktiv seleksjon
			await db.execute(
				/* sql */ `INSERT INTO screening_routine_selections (application_id, choice_effect_id, routine_id, selected_by)
				VALUES ('${appId}', '${effectId}', '${routine.id}', 'Z990001')`,
			)

			// Rutinen skal vises
			const before = await getRoutineDeadlinesWithControls(appId)
			expect(before.some((d) => d.routine?.id === routine.id)).toBe(true)
			expect(before.find((d) => d.routine?.id === routine.id)?.matchSource).toBe("screening_selection")

			// Arkiver seleksjonen (simulerer at ny screening gir annet svar)
			await db.execute(
				/* sql */ `UPDATE screening_routine_selections
				SET archived_at = NOW(), archived_by = 'Z990001'
				WHERE application_id = '${appId}' AND choice_effect_id = '${effectId}'`,
			)

			// Rutinen skal ikke lenger vises
			const after = await getRoutineDeadlinesWithControls(appId)
			expect(after.some((d) => d.routine?.id === routine.id)).toBe(false)
		})

		it("viser rutinen fra aktiv seleksjon men ikke fra arkivert seleksjon for samme rutine", async () => {
			const db = getTestDb()
			const { appId, effectId, routine } = await setupScreeningSelectionFixture("2")

			// Opprett en arkivert og en aktiv seleksjon for samme rutine
			await db.execute(
				/* sql */ `INSERT INTO screening_routine_selections (application_id, choice_effect_id, routine_id, selected_by, archived_at, archived_by)
				VALUES ('${appId}', '${effectId}', '${routine.id}', 'Z990001', NOW(), 'Z990001')`,
			)

			// Arkivert seleksjon alene skal ikke gi rutinen
			const onlyArchived = await getRoutineDeadlinesWithControls(appId)
			expect(onlyArchived.some((d) => d.routine?.id === routine.id)).toBe(false)
		})
	})

	describe("getAppsRequiringRoutine — screening_selection unlinking", () => {
		it("teller ikke med apper som bare har arkiverte screening_routine_selections", async () => {
			const db = getTestDb()
			const sectionId = await createTestSection("Apps-seksjon", "apps-seksjon")
			const appId = await createTestApp("Modig Bjørk")
			const questionId = await createTestScreeningQuestion(sectionId, "Bruker dere Oracle?")
			const choiceId = await createTestChoice(questionId, "Ja")
			const controlResult = await db.execute(
				/* sql */ `INSERT INTO framework_controls (control_id) VALUES ('K-TEST.GAR.01') RETURNING id`,
			)
			const controlId = (controlResult.rows[0] as { id: string }).id
			const effectResult = await db.execute(
				/* sql */ `INSERT INTO screening_choice_effects (choice_id, control_id) VALUES ('${choiceId}', '${controlId}') RETURNING id`,
			)
			const effectId = (effectResult.rows[0] as { id: string }).id

			const routine = await createRoutine({
				sectionId,
				name: "GAR Rutine",
				description: null,
				frequency: "annually",
				screeningQuestionId: null,
				screeningChoiceValue: null,
				responsibleRole: null,
				appliesToAllInSection: false,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
			})
			await markRoutineApproved(routine.id)

			// Aktiv seleksjon — appen skal inkluderes
			await db.execute(
				/* sql */ `INSERT INTO screening_routine_selections (application_id, choice_effect_id, routine_id, selected_by)
				VALUES ('${appId}', '${effectId}', '${routine.id}', 'Z990001')`,
			)
			const withActive = await getAppsRequiringRoutine(routine.id)
			expect(withActive.some((a) => a.id === appId)).toBe(true)

			// Arkiver seleksjonen — appen skal ikke lenger inkluderes
			await db.execute(
				/* sql */ `UPDATE screening_routine_selections
				SET archived_at = NOW(), archived_by = 'Z990001'
				WHERE application_id = '${appId}' AND choice_effect_id = '${effectId}'`,
			)
			const withArchived = await getAppsRequiringRoutine(routine.id)
			expect(withArchived.some((a) => a.id === appId)).toBe(false)
		})
	})

	describe("getRoutineDeadlinesWithControls — draftReviewId", () => {
		it("setter draftReviewId på deadline når det finnes en aktiv draft-gjennomgang for appen", async () => {
			const sectionId = await createTestSection("Draft-seksjon", "draft-seksjon")
			const appId = await createTestApp("Draft-app")
			const questionId = await createTestScreeningQuestion(sectionId, "Har rutine?")
			await createTestChoice(questionId, "ja")

			const routine = await createRoutine({
				name: "Draft-rutine",
				description: null,
				sectionId,
				frequency: "annually",
				screeningQuestionId: null,
				screeningChoiceValue: null,
				responsibleRole: null,
				appliesToAllInSection: false,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
			})
			await markRoutineApproved(routine.id)

			const db = getTestDb()
			await db.execute(
				/* sql */ `INSERT INTO routine_screening_questions (routine_id, question_id, choice_value) VALUES ('${routine.id}', '${questionId}', 'ja')`,
			)
			await createTestScreeningAnswer(appId, questionId, "ja")

			// Ingen draft ennå — draftReviewId skal være undefined
			const before = await getRoutineDeadlinesWithControls(appId)
			const dlBefore = before.find((d) => d.routine?.id === routine.id)
			expect(dlBefore).toBeDefined()
			expect(dlBefore?.draftReviewId).toBeUndefined()

			// Opprett draft-gjennomgang for appen
			const review = await createReview({
				routineId: routine.id,
				applicationId: appId,
				title: "Utkast-gjennomgang",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date(),
				createdBy: "Z990001",
				participants: [],
			})

			// draftReviewId skal nå peke på gjennomgangen
			const after = await getRoutineDeadlinesWithControls(appId)
			const dlAfter = after.find((d) => d.routine?.id === routine.id)
			expect(dlAfter?.draftReviewId).toBe(review.id)
		})

		it("setter ikke draftReviewId for en gjennomgang tilhørende en annen app", async () => {
			const sectionId = await createTestSection("Annen-app-seksjon", "annen-app-seksjon")
			const appA = await createTestApp("App A")
			const appB = await createTestApp("App B")
			const questionId = await createTestScreeningQuestion(sectionId, "Har rutine annen?")
			await createTestChoice(questionId, "ja")

			const routine = await createRoutine({
				name: "Felles rutine",
				description: null,
				sectionId,
				frequency: "annually",
				screeningQuestionId: null,
				screeningChoiceValue: null,
				responsibleRole: null,
				appliesToAllInSection: false,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
			})
			await markRoutineApproved(routine.id)

			const db = getTestDb()
			await db.execute(
				/* sql */ `INSERT INTO routine_screening_questions (routine_id, question_id, choice_value) VALUES ('${routine.id}', '${questionId}', 'ja')`,
			)
			await createTestScreeningAnswer(appA, questionId, "ja")
			await createTestScreeningAnswer(appB, questionId, "ja")

			// Opprett draft kun for app B
			await createReview({
				routineId: routine.id,
				applicationId: appB,
				title: "Draft for B",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date(),
				createdBy: "Z990001",
				participants: [],
			})

			// App A skal ikke få draftReviewId
			const deadlines = await getRoutineDeadlinesWithControls(appA)
			const dl = deadlines.find((d) => d.routine?.id === routine.id)
			expect(dl?.draftReviewId).toBeUndefined()
		})
	})

	describe("getFollowUpReviewsForSection", () => {
		async function createApprovedRoutine(sectionId: string, name: string) {
			const routine = await createRoutine({
				name,
				description: null,
				sectionId,
				frequency: "annually",
				screeningQuestionId: null,
				screeningChoiceValue: null,
				responsibleRole: null,
				appliesToAllInSection: false,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
			})
			await markRoutineApproved(routine.id)
			return routine
		}

		async function createReviewWithStatus(
			routineId: string,
			appId: string | null,
			status: "completed" | "needs_follow_up" | "discarded",
		) {
			const db = getTestDb()
			const review = await createReview({
				routineId,
				applicationId: appId,
				title: "Test gjennomgang",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date(),
				createdBy: "Z990001",
				participants: [],
			})
			await db.execute(/* sql */ `UPDATE routine_reviews SET status = '${status}' WHERE id = '${review.id}'`)
			return review
		}

		async function createFollowUpPoint(
			reviewId: string,
			text: string,
			status: "needs_follow_up" | "completed" | "not_relevant",
		) {
			const db = getTestDb()
			const result = await db.execute(
				/* sql */ `INSERT INTO routine_review_follow_up_points (review_id, text, status, created_by, updated_by)
					VALUES ('${reviewId}', '${text}', '${status}', 'Z990001', 'Z990001') RETURNING id`,
			)
			return (result.rows[0] as { id: string }).id
		}

		it("returnerer kun needs_follow_up-gjennomganger for den forespurte seksjonen", async () => {
			const sectionA = await createTestSection("Seksjon A", "seksjon-a")
			const sectionB = await createTestSection("Seksjon B", "seksjon-b")
			const appA = await createTestApp("App i seksjon A")
			const appB = await createTestApp("App i seksjon B")

			const routineA = await createApprovedRoutine(sectionA, "Rutine A")
			const routineB = await createApprovedRoutine(sectionB, "Rutine B")

			const followUpReviewA = await createReviewWithStatus(routineA.id, appA, "needs_follow_up")
			await createReviewWithStatus(routineB.id, appB, "needs_follow_up")

			const results = await getFollowUpReviewsForSection(sectionA)

			expect(results).toHaveLength(1)
			expect(results[0].id).toBe(followUpReviewA.id)
		})

		it("ekskluderer gjennomganger med status completed og discarded", async () => {
			const sectionId = await createTestSection("Status-seksjon", "status-seksjon")
			const appId = await createTestApp("Status-app")
			const routine = await createApprovedRoutine(sectionId, "Status-rutine")

			await createReviewWithStatus(routine.id, appId, "completed")
			await createReviewWithStatus(routine.id, appId, "discarded")
			const followUpReview = await createReviewWithStatus(routine.id, appId, "needs_follow_up")

			const results = await getFollowUpReviewsForSection(sectionId)

			expect(results).toHaveLength(1)
			expect(results[0].id).toBe(followUpReview.id)
		})

		it("ekskluderer gjennomganger fra arkiverte rutiner", async () => {
			const sectionId = await createTestSection("Arkiv-seksjon", "arkiv-seksjon")
			const appId = await createTestApp("Arkiv-app")
			const routine = await createApprovedRoutine(sectionId, "Arkivert rutine")

			await createReviewWithStatus(routine.id, appId, "needs_follow_up")
			await archiveRoutine(routine.id, "Z990001")

			const results = await getFollowUpReviewsForSection(sectionId)

			expect(results).toHaveLength(0)
		})

		it("inkluderer kun åpne oppfølgingspunkter (status needs_follow_up), ikke løste", async () => {
			const sectionId = await createTestSection("Punkt-seksjon", "punkt-seksjon")
			const appId = await createTestApp("Punkt-app")
			const routine = await createApprovedRoutine(sectionId, "Punkt-rutine")
			const review = await createReviewWithStatus(routine.id, appId, "needs_follow_up")

			const openPointId = await createFollowUpPoint(review.id, "Åpent punkt", "needs_follow_up")
			await createFollowUpPoint(review.id, "Løst punkt", "completed")

			const results = await getFollowUpReviewsForSection(sectionId)

			expect(results).toHaveLength(1)
			expect(results[0].openFollowUpPoints).toHaveLength(1)
			expect(results[0].openFollowUpPoints[0].id).toBe(openPointId)
			expect(results[0].openFollowUpPoints[0].text).toBe("Åpent punkt")
		})

		it("returnerer tom liste når seksjonen ikke har noen rutiner", async () => {
			const sectionId = await createTestSection("Tom seksjon", "tom-seksjon")
			const results = await getFollowUpReviewsForSection(sectionId)
			expect(results).toHaveLength(0)
		})

		it("inkluderer applikasjonsnavn og rutinenavn på gjennomgangen", async () => {
			const sectionId = await createTestSection("Navn-seksjon", "navn-seksjon")
			const appId = await createTestApp("Glad Fjord")
			const routine = await createApprovedRoutine(sectionId, "Tilgangskontroll")
			const review = await createReviewWithStatus(routine.id, appId, "needs_follow_up")

			const results = await getFollowUpReviewsForSection(sectionId)

			expect(results).toHaveLength(1)
			expect(results[0].id).toBe(review.id)
			expect(results[0].routineName).toBe("Tilgangskontroll")
			expect(results[0].applicationName).toBe("Glad Fjord")
		})
		it("returnerer createdByName når brukeren finnes i users-tabellen", async () => {
			const sectionId = await createTestSection("Bruker-seksjon", "bruker-seksjon")
			const appId = await createTestApp("Bruker-app")
			const routine = await createApprovedRoutine(sectionId, "Navne-rutine")
			await upsertUser("Z990042", "Modig Fjord", "modig.fjord@nav.no")
			const review = await createReviewWithStatus(routine.id, appId, "needs_follow_up")
			const db = getTestDb()
			await db.execute(/* sql */ `UPDATE routine_reviews SET created_by = 'Z990042' WHERE id = '${review.id}'`)

			const results = await getFollowUpReviewsForSection(sectionId)

			expect(results).toHaveLength(1)
			expect(results[0].createdByName).toBe("Modig Fjord")
		})

		it("returnerer null for createdByName når brukeren ikke finnes i users-tabellen", async () => {
			const sectionId = await createTestSection("Ukjent-seksjon", "ukjent-seksjon")
			const appId = await createTestApp("Ukjent-app")
			const routine = await createApprovedRoutine(sectionId, "Ukjent-rutine")
			const review = await createReviewWithStatus(routine.id, appId, "needs_follow_up")
			const db = getTestDb()
			await db.execute(/* sql */ `UPDATE routine_reviews SET created_by = 'Z999999' WHERE id = '${review.id}'`)

			const results = await getFollowUpReviewsForSection(sectionId)

			expect(results).toHaveLength(1)
			expect(results[0].createdByName).toBeNull()
		})
	})
})
