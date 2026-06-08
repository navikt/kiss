/**
 * Integration tests that verify archived screening_routine_selections are excluded
 * from the two query paths that were missing the archivedAt IS NULL filter:
 *
 * 1. getAppsRequiringRoutine – Path 5 (explicit per-app screening selections)
 * 2. getRoutineDeadlinesForAppByScreeningSelection
 */
import { sql } from "drizzle-orm"
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
const { getAppsRequiringRoutine, getRoutineDeadlinesForAppByScreeningSelection, createRoutine } = await import(
	"~/db/queries/routines.server"
)
const { saveRoutineSelection } = await import("~/db/queries/screening.server")

// ─── Helpers ─────────────────────────────────────────────────────────────────

function uid() {
	return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

async function createApp(name: string) {
	const db = getTestDb()
	const r = await db.execute(
		sql`INSERT INTO monitored_applications (name, created_by, updated_by) VALUES (${name}, 'Z990001', 'Z990001') RETURNING id`,
	)
	return (r.rows[0] as { id: string }).id
}

async function createSection(name: string) {
	const db = getTestDb()
	const slug = `sek-${uid()}`
	const r = await db.execute(
		sql`INSERT INTO sections (name, slug, created_by, updated_by) VALUES (${name}, ${slug}, 'Z990001', 'Z990001') RETURNING id`,
	)
	return (r.rows[0] as { id: string }).id
}

async function createControl(controlId: string) {
	const db = getTestDb()
	const r = await db.execute(
		sql`INSERT INTO framework_controls (control_id, requirement) VALUES (${controlId}, 'krav') RETURNING id`,
	)
	return (r.rows[0] as { id: string }).id
}

async function createQuestion(text: string) {
	const db = getTestDb()
	const r = await db.execute(
		sql`INSERT INTO screening_questions (question_text, created_by, updated_by) VALUES (${text}, 'Z990001', 'Z990001') RETURNING id`,
	)
	const questionId = (r.rows[0] as { id: string }).id
	// Create a "Ja" choice
	const cr = await db.execute(
		sql`INSERT INTO screening_question_choices (question_id, label) VALUES (${questionId}, 'Ja') RETURNING id`,
	)
	const choiceId = (cr.rows[0] as { id: string }).id
	return { questionId, choiceId }
}

async function createChoiceEffect(choiceId: string, controlId: string) {
	const db = getTestDb()
	const r = await db.execute(
		sql`INSERT INTO screening_choice_effects (choice_id, control_id, effect) VALUES (${choiceId}, ${controlId}, 'select_routine') RETURNING id`,
	)
	return (r.rows[0] as { id: string }).id
}

async function setRoutineApproved(routineId: string) {
	const db = getTestDb()
	await db.execute(sql`UPDATE routines SET status = 'approved' WHERE id = ${routineId}`)
}

async function archiveSelection(applicationId: string, choiceEffectId: string) {
	const db = getTestDb()
	await db.execute(
		sql`UPDATE screening_routine_selections SET archived_at = NOW(), archived_by = 'Z990001' WHERE application_id = ${applicationId} AND choice_effect_id = ${choiceEffectId} AND archived_at IS NULL`,
	)
}

// ─── Test suite ──────────────────────────────────────────────────────────────

describe("archived screening_routine_selections are excluded", () => {
	beforeAll(async () => {
		await setupTestDatabase()
	}, 120_000)

	afterAll(async () => {
		await teardownTestDatabase()
	})

	beforeEach(async () => {
		const db = getTestDb()
		await db.execute(/* sql */ `
			DELETE FROM screening_routine_selections;
			DELETE FROM screening_choice_effects;
			DELETE FROM screening_question_choices;
			DELETE FROM screening_question_technology_elements;
			DELETE FROM routine_screening_questions;
			DELETE FROM screening_questions;
			DELETE FROM routine_controls;
			DELETE FROM routine_technology_elements;
			DELETE FROM routine_group_classification_links;
			DELETE FROM routine_oracle_role_criticality_links;
			DELETE FROM routine_persistence_links;
			DELETE FROM routines;
			DELETE FROM framework_controls;
			DELETE FROM monitored_applications;
			DELETE FROM sections;
			DELETE FROM audit_log;
		`)
	})

	describe("getAppsRequiringRoutine – Path 5", () => {
		it("includes app when it has an active screening selection for the routine", async () => {
			const sectionId = await createSection("Seksjon Glad Fjord")
			const appId = await createApp("Rask Elv")
			const controlId = await createControl(`K-ARCH-SEL.01-${uid()}`)
			const { choiceId } = await createQuestion("Brukes sensitiv lagring?")
			const choiceEffectId = await createChoiceEffect(choiceId, controlId)

			const routine = await createRoutine({
				sectionId,
				name: "Rutine Stille Vann",
				description: "Testrutine",
				frequency: "quarterly",
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: "tech_manager",
				isSectionRoutine: false,
				persistenceLinks: [],
				technologyElementIds: [],
				controlIds: [],
				createdBy: "Z990001",
			})
			await setRoutineApproved(routine.id)

			await saveRoutineSelection(appId, choiceEffectId, routine.id, "Z990001")

			const apps = await getAppsRequiringRoutine(routine.id)
			expect(apps.map((a) => a.id)).toContain(appId)
		})

		it("excludes app when its screening selection for the routine is archived", async () => {
			const sectionId = await createSection("Seksjon Sterk Berg")
			const appId = await createApp("Mild Skog")
			const controlId = await createControl(`K-ARCH-SEL.02-${uid()}`)
			const { choiceId } = await createQuestion("Behandles personopplysninger?")
			const choiceEffectId = await createChoiceEffect(choiceId, controlId)

			const routine = await createRoutine({
				sectionId,
				name: "Rutine Klar Himmel",
				description: "Testrutine",
				frequency: "quarterly",
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: "tech_manager",
				isSectionRoutine: false,
				persistenceLinks: [],
				technologyElementIds: [],
				controlIds: [],
				createdBy: "Z990001",
			})
			await setRoutineApproved(routine.id)

			await saveRoutineSelection(appId, choiceEffectId, routine.id, "Z990001")
			await archiveSelection(appId, choiceEffectId)

			const apps = await getAppsRequiringRoutine(routine.id)
			expect(apps.map((a) => a.id)).not.toContain(appId)
		})

		it("includes app when it re-selects a routine after a previous selection was archived", async () => {
			const sectionId = await createSection("Seksjon Dyp Dal")
			const appId = await createApp("Høy Fjell")
			const controlId = await createControl(`K-ARCH-SEL.03-${uid()}`)
			const { choiceId } = await createQuestion("Har ekstern tilgang?")
			const choiceEffectId = await createChoiceEffect(choiceId, controlId)

			const routine = await createRoutine({
				sectionId,
				name: "Rutine Lys Morgen",
				description: "Testrutine",
				frequency: "annually",
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: "tech_manager",
				isSectionRoutine: false,
				persistenceLinks: [],
				technologyElementIds: [],
				controlIds: [],
				createdBy: "Z990001",
			})
			await setRoutineApproved(routine.id)

			// First selection → archive → re-select
			await saveRoutineSelection(appId, choiceEffectId, routine.id, "Z990001")
			// saveRoutineSelection archives the old and inserts a new one:
			await saveRoutineSelection(appId, choiceEffectId, routine.id, "Z990002")

			const apps = await getAppsRequiringRoutine(routine.id)
			expect(apps.map((a) => a.id)).toContain(appId)
		})
	})

	describe("getRoutineDeadlinesForAppByScreeningSelection", () => {
		it("returns deadline for routine when app has an active screening selection", async () => {
			const sectionId = await createSection("Seksjon Bred Elv")
			const appId = await createApp("Tung Stein")
			const controlId = await createControl(`K-DEAD-SEL.01-${uid()}`)
			const { choiceId } = await createQuestion("Er systemet kritisk?")
			const choiceEffectId = await createChoiceEffect(choiceId, controlId)

			const routine = await createRoutine({
				sectionId,
				name: "Rutine Varm Sol",
				description: "Testrutine",
				frequency: "quarterly",
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: "tech_manager",
				isSectionRoutine: false,
				persistenceLinks: [],
				technologyElementIds: [],
				controlIds: [],
				createdBy: "Z990001",
			})
			await setRoutineApproved(routine.id)

			await saveRoutineSelection(appId, choiceEffectId, routine.id, "Z990001")

			const deadlines = await getRoutineDeadlinesForAppByScreeningSelection(appId)
			expect(deadlines.map((d) => d.routine?.id)).toContain(routine.id)
		})

		it("omits routine deadline when the app's screening selection is archived", async () => {
			const sectionId = await createSection("Seksjon Kald Vinter")
			const appId = await createApp("Stille Natt")
			const controlId = await createControl(`K-DEAD-SEL.02-${uid()}`)
			const { choiceId } = await createQuestion("Lagres kryptonøkler?")
			const choiceEffectId = await createChoiceEffect(choiceId, controlId)

			const routine = await createRoutine({
				sectionId,
				name: "Rutine Frisk Vind",
				description: "Testrutine",
				frequency: "quarterly",
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: "tech_manager",
				isSectionRoutine: false,
				persistenceLinks: [],
				technologyElementIds: [],
				controlIds: [],
				createdBy: "Z990001",
			})
			await setRoutineApproved(routine.id)

			await saveRoutineSelection(appId, choiceEffectId, routine.id, "Z990001")
			await archiveSelection(appId, choiceEffectId)

			const deadlines = await getRoutineDeadlinesForAppByScreeningSelection(appId)
			expect(deadlines.map((d) => d.routine?.id)).not.toContain(routine.id)
		})
	})
})
