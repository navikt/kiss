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
			activityType: null,
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
			activityType: null,
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

	async function addPersistence(appId: string, type: string, classification: string | null) {
		const db = getTestDb()
		const cls = classification ? `'${classification}'` : "NULL"
		await db.execute(
			/* sql */ `INSERT INTO application_persistence (application_id, type, data_classification, manually_added)
				VALUES ('${appId}', '${type}', ${cls}, true)`,
		)
	}

	async function addOracleAssessment(appId: string, criticality: string) {
		const db = getTestDb()
		await db.execute(
			/* sql */ `INSERT INTO oracle_role_assessments (application_id, criticality, created_by)
				VALUES ('${appId}', '${criticality}', 'test')`,
		)
	}

	async function makeSectionRoutine(
		sectionId: string,
		technologyElementIds: string[],
		persistenceLinks: Array<{ type: string | null; classification: string | null }>,
		oracleRoleCriticalities: string[],
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
			activityType: null,
			isSectionRoutine: true,
			technologyElementIds,
			persistenceLinks: persistenceLinks.map((p) => ({
				persistenceType: p.type as never,
				dataClassification: p.classification as never,
			})),
			controlIds: [],
			groupClassifications: [],
			oracleRoleCriticalities: oracleRoleCriticalities as never[],
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
		await addOracleAssessment(appWith, "critical")
		const routine = await makeSectionRoutine(sectionId, [], [], ["critical"])

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
})
