import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { DataClassification, GroupCriticality, PersistenceType } from "~/db/schema/applications"
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
	createRoutine,
	updateRoutine,
	createReview,
	completeReview,
	addFollowUpPoint,
	getSectionRoutinesForSection,
	getAppsRequiringRoutine,
	getRoutineDeadlinesForAppBySection,
} = await import("~/db/queries/routines.server")
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
			createdBy: "Z990001",
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
			createdBy: "Z990001",
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

	it("section routine review with applicationId set should NOT count as lastReviewDate (section reviews require applicationId = null)", async () => {
		const sectionId = await createTestSection("Test Seksjon", `test-${Date.now()}-${Math.random()}`)
		const appId = await createTestApp("TestApp", sectionId)

		const routine = await createRoutine({
			sectionId,
			name: "Seksjonsrutine med app-kontekst-gjennomgang",
			description: null,
			frequency: "annually",
			screeningQuestionId: null,
			screeningChoiceValue: null,
			appliesToAllInSection: true,
			responsibleRole: null,
			isSectionRoutine: true,
			sectionRoutineOwnerRole: "Teknologileder",
			persistenceLinks: [],
			technologyElementIds: [],
			controlIds: [],
			groupClassifications: [],
			oracleRoleCriticalities: [],
			createdBy: "Z990001",
		})

		const db = getTestDb()
		await db.execute(/* sql */ `UPDATE routines SET status = 'approved' WHERE id = '${routine.id}'`)

		// A review created with applicationId set (app-context) should not count for section routines
		const review = await createReview({
			routineId: routine.id,
			applicationId: appId,
			title: "Gjennomgang fra app-kontekst",
			summary: null,
			routineSnapshotPath: null,
			reviewedAt: new Date(),
			createdBy: "Z990001",
			participants: [],
		})
		await completeReview(review.id, "Z990001")

		const results = await getSectionRoutinesForSection(sectionId)
		const result = results.find((r) => r.routine.id === routine.id)

		expect(result).toBeDefined()
		// Section-level reviews require applicationId = null — app-context review should not count
		expect(result?.lastReviewDate).toBeNull()
		// Deadline is ~1 year from now (approvedAt ?? createdAt + annually), so not overdue yet
		expect(result?.overdue).toBe(false)
	})

	it("sets needsFollowUp on app-level deadline when latest review for app has needs_follow_up status", async () => {
		const sectionId = await createTestSection("Test Seksjon", `test-${Date.now()}-${Math.random()}`)
		const appId = await createTestApp("AppNF", sectionId)

		const routine = await createRoutine({
			sectionId,
			name: "App rutine med oppfølging",
			description: null,
			frequency: "monthly",
			screeningQuestionId: null,
			screeningChoiceValue: null,
			appliesToAllInSection: true,
			responsibleRole: null,
			isSectionRoutine: false,
			persistenceLinks: [],
			technologyElementIds: [],
			controlIds: [],
			groupClassifications: [],
			oracleRoleCriticalities: [],
			createdBy: "test",
		})
		const db = getTestDb()
		await db.execute(/* sql */ `UPDATE routines SET status = 'approved' WHERE id = '${routine.id}'`)

		const review = await createReview({
			routineId: routine.id,
			applicationId: appId,
			title: "GG",
			summary: null,
			routineSnapshotPath: null,
			reviewedAt: new Date(),
			createdBy: "test",
			participants: [],
		})
		await addFollowUpPoint({ reviewId: review.id, text: "Pkt", description: "Beskrivelse", performedBy: "test" })
		await completeReview(review.id, "test")

		const deadlines = await getRoutineDeadlinesWithControls(appId)
		const dl = deadlines.find((d) => d.routine?.id === routine.id)
		expect(dl).toBeDefined()
		expect(dl?.needsFollowUp).toBe(true)
	})

	it("sets needsFollowUp on section-routine deadline when latest section review has needs_follow_up status", async () => {
		const sectionId = await createTestSection("Test Seksjon", `test-${Date.now()}-${Math.random()}`)
		const appId = await createTestApp("AppSec", sectionId)

		const routine = await createRoutine({
			sectionId,
			name: "Seksjonsrutine med oppfølging",
			description: null,
			frequency: "annually",
			screeningQuestionId: null,
			screeningChoiceValue: null,
			appliesToAllInSection: true,
			responsibleRole: null,
			isSectionRoutine: true,
			sectionRoutineOwnerRole: "Seksjonsleder",
			persistenceLinks: [],
			technologyElementIds: [],
			controlIds: [],
			groupClassifications: [],
			oracleRoleCriticalities: [],
			createdBy: "test",
		})
		const db = getTestDb()
		await db.execute(/* sql */ `UPDATE routines SET status = 'approved' WHERE id = '${routine.id}'`)

		const review = await createReview({
			routineId: routine.id,
			applicationId: null,
			title: "Seksjon GG",
			summary: null,
			routineSnapshotPath: null,
			reviewedAt: new Date(),
			createdBy: "test",
			participants: [],
		})
		await addFollowUpPoint({ reviewId: review.id, text: "Sek-pkt", description: "Beskrivelse", performedBy: "test" })
		await completeReview(review.id, "test")

		const deadlines = await getRoutineDeadlinesWithControls(appId)
		const dl = deadlines.find((d) => d.routine?.id === routine.id)
		expect(dl).toBeDefined()
		expect(dl?.needsFollowUp).toBe(true)
	})

	it("does not set needsFollowUp when latest review is fully completed", async () => {
		const sectionId = await createTestSection("Test Seksjon", `test-${Date.now()}-${Math.random()}`)
		const appId = await createTestApp("AppOk", sectionId)

		const routine = await createRoutine({
			sectionId,
			name: "OK rutine",
			description: null,
			frequency: "monthly",
			screeningQuestionId: null,
			screeningChoiceValue: null,
			appliesToAllInSection: true,
			responsibleRole: null,
			isSectionRoutine: false,
			persistenceLinks: [],
			technologyElementIds: [],
			controlIds: [],
			groupClassifications: [],
			oracleRoleCriticalities: [],
			createdBy: "test",
		})
		const db = getTestDb()
		await db.execute(/* sql */ `UPDATE routines SET status = 'approved' WHERE id = '${routine.id}'`)

		const review = await createReview({
			routineId: routine.id,
			applicationId: appId,
			title: "GG OK",
			summary: null,
			routineSnapshotPath: null,
			reviewedAt: new Date(),
			createdBy: "test",
			participants: [],
		})
		await completeReview(review.id, "test")

		const deadlines = await getRoutineDeadlinesWithControls(appId)
		const dl = deadlines.find((d) => d.routine?.id === routine.id)
		expect(dl).toBeDefined()
		expect(dl?.needsFollowUp).toBe(false)
	})
})

// ─── Constraint-based filtering for section routines ─────────────────────────

describe("Section routine constraint filtering", () => {
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
			DELETE FROM application_persistence;
			DELETE FROM application_technology_elements;
			DELETE FROM oracle_role_assessments;
			DELETE FROM application_team_mappings;
			DELETE FROM monitored_applications;
			DELETE FROM dev_teams;
			DELETE FROM technology_elements;
			DELETE FROM sections;
		`)
	})

	async function makeSection(slug: string) {
		const db = getTestDb()
		const r = await db.execute(
			/* sql */ `INSERT INTO sections (name, slug, created_by, updated_by) VALUES ('${slug}', '${slug}', 'test', 'test') RETURNING id`,
		)
		return (r.rows[0] as { id: string }).id
	}

	async function makeApp(name: string, sectionId: string) {
		const db = getTestDb()
		const slug = `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
		const teamR = await db.execute(
			/* sql */ `INSERT INTO dev_teams (name, slug, section_id, created_by, updated_by) VALUES ('${slug}', '${slug}', '${sectionId}', 'test', 'test') RETURNING id`,
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

	async function makeTechElement(name: string) {
		const db = getTestDb()
		const r = await db.execute(
			/* sql */ `INSERT INTO technology_elements (name, slug, display_order) VALUES ('${name}', '${name.toLowerCase().replace(/ /g, "-")}', 1) RETURNING id`,
		)
		return (r.rows[0] as { id: string }).id
	}

	async function confirmTechElement(appId: string, elementId: string) {
		const db = getTestDb()
		await db.execute(
			/* sql */ `INSERT INTO application_technology_elements (application_id, element_id, source, confirmed_at, confirmed_by)
				VALUES ('${appId}', '${elementId}', 'manual', NOW(), 'test')`,
		)
	}

	async function addPersistence(appId: string, type: PersistenceType, classification: DataClassification | null) {
		const db = getTestDb()
		const cls = classification ? `'${classification}'` : "NULL"
		await db.execute(
			/* sql */ `INSERT INTO application_persistence (application_id, type, name, data_classification, manually_added)
				VALUES ('${appId}', '${type}', '${type}-test', ${cls}, true)`,
		)
	}

	async function addOracleAssessment(appId: string, criticality: GroupCriticality) {
		const db = getTestDb()
		await db.execute(
			/* sql */ `INSERT INTO oracle_role_assessments (application_id, instance_id, role_name, criticality, assessed_by, updated_by)
				VALUES ('${appId}', 'TEST_INST', 'TEST_ROLE', '${criticality}', 'test', 'test')`,
		)
	}

	async function makeSectionRoutine(
		sectionId: string,
		technologyElementIds: string[],
		persistenceLinks: Array<{ type: PersistenceType | null; classification: DataClassification | null }>,
		oracleRoleCriticalities: GroupCriticality[],
	) {
		const routine = await createRoutine({
			sectionId,
			name: "Constraint test",
			description: null,
			frequency: "annually",
			screeningQuestionId: null,
			screeningChoiceValue: null,
			appliesToAllInSection: true,
			responsibleRole: null,
			isSectionRoutine: true,
			sectionRoutineOwnerRole: "Teknologileder",
			technologyElementIds,
			persistenceLinks: persistenceLinks.map((p) => ({
				persistenceType: p.type,
				dataClassification: p.classification,
			})),
			controlIds: [],
			groupClassifications: [],
			oracleRoleCriticalities,
			createdBy: "test",
		})
		const db = getTestDb()
		await db.execute(/* sql */ `UPDATE routines SET status = 'approved' WHERE id = '${routine.id}'`)
		return routine
	}

	it("section routine without constraints applies to all apps in section", async () => {
		const sectionId = await makeSection(`sec-${Date.now()}`)
		const app1 = await makeApp("App A", sectionId)
		const app2 = await makeApp("App B", sectionId)
		const routine = await makeSectionRoutine(sectionId, [], [], [])

		const apps = await getAppsRequiringRoutine(routine.id)
		const ids = apps.map((a) => a.id)
		expect(ids).toContain(app1)
		expect(ids).toContain(app2)
	})

	it("section routine with tech element only matches apps with confirmed element", async () => {
		const sectionId = await makeSection(`sec-${Date.now()}`)
		const appWith = await makeApp("With Element", sectionId)
		const appWithout = await makeApp("Without Element", sectionId)
		const elementId = await makeTechElement(`postgres-${Date.now()}`)
		await confirmTechElement(appWith, elementId)
		const routine = await makeSectionRoutine(sectionId, [elementId], [], [])

		const apps = await getAppsRequiringRoutine(routine.id)
		const ids = apps.map((a) => a.id)
		expect(ids).toContain(appWith)
		expect(ids).not.toContain(appWithout)
	})

	it("section routine with persistence constraint only matches apps with matching persistence", async () => {
		const sectionId = await makeSection(`sec-${Date.now()}`)
		const appWith = await makeApp("With Postgres Financial", sectionId)
		const appWrongType = await makeApp("With OpenSearch Financial", sectionId)
		const appNoPers = await makeApp("No Persistence", sectionId)
		await addPersistence(appWith, "cloud_sql_postgres", "financial_regulation")
		await addPersistence(appWrongType, "opensearch", "financial_regulation")
		const routine = await makeSectionRoutine(
			sectionId,
			[],
			[{ type: "cloud_sql_postgres", classification: "financial_regulation" }],
			[],
		)

		const apps = await getAppsRequiringRoutine(routine.id)
		const ids = apps.map((a) => a.id)
		expect(ids).toContain(appWith)
		expect(ids).not.toContain(appWrongType)
		expect(ids).not.toContain(appNoPers)
	})

	it("section routine with oracle criticality only matches apps with matching assessment", async () => {
		const sectionId = await makeSection(`sec-${Date.now()}`)
		const appWith = await makeApp("With Critical Oracle", sectionId)
		const appWithout = await makeApp("No Oracle", sectionId)
		await addOracleAssessment(appWith, "high")
		const routine = await makeSectionRoutine(sectionId, [], [], ["high"])

		const apps = await getAppsRequiringRoutine(routine.id)
		const ids = apps.map((a) => a.id)
		expect(ids).toContain(appWith)
		expect(ids).not.toContain(appWithout)
	})

	it("getRoutineDeadlinesForAppBySection includes routine without constraints", async () => {
		const sectionId = await makeSection(`sec-${Date.now()}`)
		const appId = await makeApp("App", sectionId)
		const routine = await makeSectionRoutine(sectionId, [], [], [])

		const deadlines = await getRoutineDeadlinesForAppBySection(appId)
		expect(deadlines.some((d) => d.routine?.id === routine.id)).toBe(true)
	})

	it("getRoutineDeadlinesForAppBySection excludes routine with unmatched tech element", async () => {
		const sectionId = await makeSection(`sec-${Date.now()}`)
		const appId = await makeApp("App", sectionId)
		const elementId = await makeTechElement(`el-${Date.now()}`)
		// App does NOT have this element confirmed
		const routine = await makeSectionRoutine(sectionId, [elementId], [], [])

		const deadlines = await getRoutineDeadlinesForAppBySection(appId)
		expect(deadlines.some((d) => d.routine?.id === routine.id)).toBe(false)
	})

	it("getRoutineDeadlinesForAppBySection includes routine when app has matching tech element", async () => {
		const sectionId = await makeSection(`sec-${Date.now()}`)
		const appId = await makeApp("App", sectionId)
		const elementId = await makeTechElement(`el2-${Date.now()}`)
		await confirmTechElement(appId, elementId)
		const routine = await makeSectionRoutine(sectionId, [elementId], [], [])

		const deadlines = await getRoutineDeadlinesForAppBySection(appId)
		expect(deadlines.some((d) => d.routine?.id === routine.id)).toBe(true)
	})

	it("matchedTechElements contains the matching element when routine matches on tech element", async () => {
		const sectionId = await makeSection(`sec-${Date.now()}`)
		const appId = await makeApp("App", sectionId)
		const elementId = await makeTechElement(`el-match-${Date.now()}`)
		await confirmTechElement(appId, elementId)
		const routine = await makeSectionRoutine(sectionId, [elementId], [], [])

		const deadlines = await getRoutineDeadlinesForAppBySection(appId)
		const deadline = deadlines.find((d) => d.routine?.id === routine.id)
		expect(deadline?.matchedTechElements).toHaveLength(1)
		expect(deadline?.matchedTechElements?.[0]?.id).toBe(elementId)
	})

	it("getRoutineDeadlinesForAppBySection excludes routine with unmatched persistence", async () => {
		const sectionId = await makeSection(`sec-${Date.now()}`)
		const appId = await makeApp("App", sectionId)
		// App has postgres but no financial classification
		await addPersistence(appId, "cloud_sql_postgres", "not_critical")
		const routine = await makeSectionRoutine(
			sectionId,
			[],
			[{ type: "cloud_sql_postgres", classification: "financial_regulation" }],
			[],
		)

		const deadlines = await getRoutineDeadlinesForAppBySection(appId)
		expect(deadlines.some((d) => d.routine?.id === routine.id)).toBe(false)
	})

	it("getRoutineDeadlinesForAppBySection excludes routine with unmatched oracle criticality", async () => {
		const sectionId = await makeSection(`sec-${Date.now()}`)
		const appId = await makeApp("App no oracle", sectionId)
		// App has NO oracle assessment
		const routine = await makeSectionRoutine(sectionId, [], [], ["high"])

		const deadlines = await getRoutineDeadlinesForAppBySection(appId)
		expect(deadlines.some((d) => d.routine?.id === routine.id)).toBe(false)
	})

	it("getRoutineDeadlinesForAppBySection includes routine when app has matching oracle criticality", async () => {
		const sectionId = await makeSection(`sec-${Date.now()}`)
		const appId = await makeApp("App with oracle", sectionId)
		await addOracleAssessment(appId, "high")
		const routine = await makeSectionRoutine(sectionId, [], [], ["high"])

		const deadlines = await getRoutineDeadlinesForAppBySection(appId)
		expect(deadlines.some((d) => d.routine?.id === routine.id)).toBe(true)
	})

	it("matchedOracleCriticalities contains the matching criticality when routine matches on oracle", async () => {
		const sectionId = await makeSection(`sec-${Date.now()}`)
		const appId = await makeApp("App with oracle", sectionId)
		await addOracleAssessment(appId, "high")
		const routine = await makeSectionRoutine(sectionId, [], [], ["high"])

		const deadlines = await getRoutineDeadlinesForAppBySection(appId)
		const deadline = deadlines.find((d) => d.routine?.id === routine.id)
		expect(deadline?.matchedOracleCriticalities).toHaveLength(1)
		expect(deadline?.matchedOracleCriticalities?.[0]?.criticality).toBe("high")
	})

	it("matchedPersistenceLinks contains the matching link when routine matches on persistence", async () => {
		const sectionId = await makeSection(`sec-${Date.now()}`)
		const appId = await makeApp("App with persistence", sectionId)
		await addPersistence(appId, "cloud_sql_postgres", "critical")
		const routine = await makeSectionRoutine(
			sectionId,
			[],
			[{ type: "cloud_sql_postgres", classification: "critical" }],
			[],
		)

		const deadlines = await getRoutineDeadlinesForAppBySection(appId)
		const deadline = deadlines.find((d) => d.routine?.id === routine.id)
		expect(deadline?.matchedPersistenceLinks).toHaveLength(1)
		expect(deadline?.matchedPersistenceLinks?.[0]?.persistenceType).toBe("cloud_sql_postgres")
		expect(deadline?.matchedPersistenceLinks?.[0]?.dataClassification).toBe("critical")
	})

	it("AND-logic: app matching only tech element (not persistence) is excluded", async () => {
		const sectionId = await makeSection(`sec-${Date.now()}`)
		const appMatchesOnlyElement = await makeApp("Only element", sectionId)
		const appMatchesBoth = await makeApp("Both element and persistence", sectionId)
		const elementId = await makeTechElement(`el-and-${Date.now()}`)
		await confirmTechElement(appMatchesOnlyElement, elementId)
		await confirmTechElement(appMatchesBoth, elementId)
		await addPersistence(appMatchesBoth, "cloud_sql_postgres", "financial_regulation")
		// Routine requires BOTH a tech element AND a persistence type+classification
		const routine = await makeSectionRoutine(
			sectionId,
			[elementId],
			[{ type: "cloud_sql_postgres", classification: "financial_regulation" }],
			[],
		)

		const apps = await getAppsRequiringRoutine(routine.id)
		const ids = apps.map((a) => a.id)
		expect(ids).toContain(appMatchesBoth)
		expect(ids).not.toContain(appMatchesOnlyElement)
	})

	// ─── appliesToAllInSection (isSectionRoutine=0) bypasses constraints ─────────

	async function makeAllInSectionRoutine(
		sectionId: string,
		technologyElementIds: string[],
		persistenceLinks: Array<{ type: PersistenceType | null; classification: DataClassification | null }>,
	) {
		const routine = await createRoutine({
			sectionId,
			name: "Gjelder alle test",
			description: null,
			frequency: "quarterly",
			screeningQuestionId: null,
			screeningChoiceValue: null,
			appliesToAllInSection: true,
			responsibleRole: null,
			isSectionRoutine: false,
			technologyElementIds,
			persistenceLinks: persistenceLinks.map((p) => ({
				persistenceType: p.type,
				dataClassification: p.classification,
			})),
			controlIds: [],
			groupClassifications: [],
			oracleRoleCriticalities: [],
			createdBy: "test",
		})
		const db = getTestDb()
		await db.execute(/* sql */ `UPDATE routines SET status = 'approved' WHERE id = '${routine.id}'`)
		return routine
	}

	it("appliesToAllInSection (isSectionRoutine=false) is filtered by tech elements when they are defined", async () => {
		const sectionId = await makeSection(`sec-${Date.now()}`)
		const appWithElement = await makeApp("App With Element", sectionId)
		const appWithoutElement = await makeApp("App Without Element", sectionId)
		const elementId = await makeTechElement(`el-all-${Date.now()}`)
		await confirmTechElement(appWithElement, elementId)
		const routine = await makeAllInSectionRoutine(sectionId, [elementId], [])

		const deadlinesWith = await getRoutineDeadlinesForAppBySection(appWithElement)
		const deadlinesWithout = await getRoutineDeadlinesForAppBySection(appWithoutElement)

		expect(deadlinesWith.some((d) => d.routine?.id === routine.id)).toBe(true)
		// appliesToAllInSection=1 — tech element constraint still applies
		expect(deadlinesWithout.some((d) => d.routine?.id === routine.id)).toBe(false)
	})

	it("appliesToAllInSection (isSectionRoutine=false) is filtered by persistence when it is defined", async () => {
		const sectionId = await makeSection(`sec-${Date.now()}`)
		const appWithPers = await makeApp("App With Persistence", sectionId)
		const appNoPers = await makeApp("App No Persistence", sectionId)
		await addPersistence(appWithPers, "cloud_sql_postgres", "critical")
		const routine = await makeAllInSectionRoutine(
			sectionId,
			[],
			[{ type: "cloud_sql_postgres", classification: "critical" }],
		)

		const deadlinesWith = await getRoutineDeadlinesForAppBySection(appWithPers)
		const deadlinesWithout = await getRoutineDeadlinesForAppBySection(appNoPers)

		expect(deadlinesWith.some((d) => d.routine?.id === routine.id)).toBe(true)
		// appliesToAllInSection=1 — persistence constraint still applies
		expect(deadlinesWithout.some((d) => d.routine?.id === routine.id)).toBe(false)
	})
})
