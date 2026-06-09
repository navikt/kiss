/**
 * Integration tests that verify archived screening_routine_selections are excluded
 * from the two query paths that were missing the archivedAt IS NULL filter:
 *
 * 1. getAppsRequiringRoutine – Path 5 (explicit per-app screening selections)
 * 2. getRoutineDeadlinesForAppByScreeningSelection
 *
 * Also verifies that getRoutineDeadlinesWithControls attaches screeningSelectionQuestion
 * for routines matched via screening_selection.
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
const { getRoutineDeadlinesWithControls } = await import("~/db/queries/routine-deadlines.server")

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

async function createQuestion(text: string, sectionId?: string) {
	const db = getTestDb()
	const r = sectionId
		? await db.execute(
				sql`INSERT INTO screening_questions (section_id, question_text, created_by, updated_by) VALUES (${sectionId}, ${text}, 'Z990001', 'Z990001') RETURNING id`,
			)
		: await db.execute(
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
			DELETE FROM application_team_mappings;
			DELETE FROM dev_teams;
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

	describe("getRoutineDeadlinesWithControls — screeningSelectionQuestion", () => {
		it("attaches question id and text to a screening_selection routine", async () => {
			const sectionId = await createSection("Seksjon Grønn Dal")
			const appId = await createApp("Blå Bekk")
			const controlId = await createControl(`K-SSQ.01-${uid()}`)
			const { questionId, choiceId } = await createQuestion("Håndterer systemet sensitive data?", sectionId)
			const choiceEffectId = await createChoiceEffect(choiceId, controlId)

			const routine = await createRoutine({
				sectionId,
				name: "Rutine Hvit Sky",
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

			const deadlines = await getRoutineDeadlinesWithControls(appId)
			const match = deadlines.find((d) => d.routine?.id === routine.id)

			expect(match).toBeDefined()
			expect(match?.matchSource).toBe("screening_selection")
			expect(match?.screeningSelectionQuestion).toMatchObject({
				id: questionId,
				questionText: "Håndterer systemet sensitive data?",
				sectionId,
			})
		})

		it("does not attach screeningSelectionQuestion for routines matched by other sources", async () => {
			const sectionId = await createSection("Seksjon Sterk Vind")
			const appId = await createApp("Rolig Hav")
			const controlId = await createControl(`K-SSQ.02-${uid()}`)
			const { choiceId } = await createQuestion("Har systemet ekstern pålogging?")
			const choiceEffectId = await createChoiceEffect(choiceId, controlId)

			// Link the app to the section via dev_team + application_team_mapping
			const db = getTestDb()
			const teamSlug = `team-${uid()}`
			const teamResult = await db.execute(
				sql`INSERT INTO dev_teams (name, slug, section_id, created_by, updated_by) VALUES (${teamSlug}, ${teamSlug}, ${sectionId}, 'Z990001', 'Z990001') RETURNING id`,
			)
			const teamId = (teamResult.rows[0] as { id: string }).id
			await db.execute(
				sql`INSERT INTO application_team_mappings (application_id, dev_team_id, created_by) VALUES (${appId}, ${teamId}, 'Z990001')`,
			)

			// Create a section-wide routine (matched via "section", not "screening_selection")
			const sectionRoutine = await createRoutine({
				sectionId,
				name: "Rutine Klar Dag",
				description: "Seksjonsrutine",
				frequency: "annually",
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: true,
				responsibleRole: "tech_manager",
				isSectionRoutine: true,
				sectionRoutineOwnerRole: "tech_manager",
				persistenceLinks: [],
				technologyElementIds: [],
				controlIds: [],
				createdBy: "Z990001",
			})
			await setRoutineApproved(sectionRoutine.id)

			// Also create a screening_selection routine to confirm the section one is distinct
			const selectionRoutine = await createRoutine({
				sectionId,
				name: "Rutine Sterk Strøm",
				description: "Valgt via spørsmål",
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
			await setRoutineApproved(selectionRoutine.id)
			await saveRoutineSelection(appId, choiceEffectId, selectionRoutine.id, "Z990001")

			const deadlines = await getRoutineDeadlinesWithControls(appId)

			const sectionMatch = deadlines.find((d) => d.routine?.id === sectionRoutine.id)
			expect(sectionMatch).toBeDefined()
			expect(sectionMatch?.matchSource).toBe("section")
			expect(sectionMatch?.screeningSelectionQuestion).toBeUndefined()

			const selectionMatch = deadlines.find((d) => d.routine?.id === selectionRoutine.id)
			expect(selectionMatch).toBeDefined()
			expect(selectionMatch?.matchSource).toBe("screening_selection")
			expect(selectionMatch?.screeningSelectionQuestion).toBeDefined()
		})

		it("returns null for screeningSelectionQuestion when the archived selection is restored without a question", async () => {
			const sectionId = await createSection("Seksjon Mørk Natt")
			const appId = await createApp("Dyp Fjord")
			const controlId = await createControl(`K-SSQ.03-${uid()}`)
			const { questionId, choiceId } = await createQuestion("Behandles betalingsdata?")
			const choiceEffectId = await createChoiceEffect(choiceId, controlId)

			const routine = await createRoutine({
				sectionId,
				name: "Rutine Grå Stein",
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
			await saveRoutineSelection(appId, choiceEffectId, routine.id, "Z990001")

			const deadlines = await getRoutineDeadlinesWithControls(appId)
			const match = deadlines.find((d) => d.routine?.id === routine.id)

			expect(match?.screeningSelectionQuestion).toMatchObject({
				id: questionId,
				questionText: "Behandles betalingsdata?",
			})
		})
	})
})
