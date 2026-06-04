/**
 * Integration tests: Routine ↔ Application linking/unlinking via screening
 *
 * Covers all lifecycle scenarios for the two screening-driven matching paths:
 *   1. `screening` path  — routine_screening_questions + screening_answers
 *   2. `screening_selection` path — screening_routine_selections (preset_routine)
 *
 * Also verifies that historical routine_reviews are preserved after unlinking.
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

import type { NavUser } from "~/lib/auth.server"

const testUser: NavUser = {
	navIdent: "Z990001",
	name: "Frisk Ål",
	email: "test@nav.no",
	groups: [],
	token: "test-token",
	dbRoles: [],
	roles: new Set(),
	isActualAdmin: false,
	adminSuppressed: false,
}

// ─── Query functions (imported after mock) ───────────────────────────────────

const { createReview, getReviewsForApp, getReviewsForRoutine, getAppsRequiringRoutine } = await import(
	"~/db/queries/routines.server"
)

const { getRoutineDeadlinesWithControls } = await import("~/db/queries/routine-deadlines.server")

const { createScreeningSession, saveScreeningSessionAnswer, completeScreeningSession } = await import(
	"~/db/queries/screening-sessions.server"
)

const { addChoiceEffect } = await import("~/db/queries/screening.server")

// ─── DB helpers ──────────────────────────────────────────────────────────────

async function insertApp(name: string) {
	const db = getTestDb()
	const r = await db.execute(
		sql`INSERT INTO monitored_applications (name, created_by, updated_by) VALUES (${name}, 'test', 'test') RETURNING id`,
	)
	return (r.rows[0] as { id: string }).id
}

async function insertSection(name: string) {
	const db = getTestDb()
	const slug = name.toLowerCase().replace(/\s+/g, "-")
	const r = await db.execute(
		sql`INSERT INTO sections (name, slug, created_by, updated_by) VALUES (${name}, ${slug}, 'test', 'test') RETURNING id`,
	)
	return (r.rows[0] as { id: string }).id
}

async function insertApprovedRoutine(name: string, sectionId: string) {
	const db = getTestDb()
	const r = await db.execute(
		sql`INSERT INTO routines (name, section_id, frequency, status, created_by, updated_by)
		    VALUES (${name}, ${sectionId}, 'annually', 'approved', 'test', 'test') RETURNING id`,
	)
	return (r.rows[0] as { id: string }).id
}

async function insertQuestion(text: string) {
	const db = getTestDb()
	const r = await db.execute(
		sql`INSERT INTO screening_questions (question_text, answer_type, status, created_by, updated_by)
		    VALUES (${text}, 'boolean', 'approved', 'test', 'test') RETURNING id`,
	)
	return (r.rows[0] as { id: string }).id
}

async function insertChoice(questionId: string, label: string) {
	const db = getTestDb()
	const r = await db.execute(
		sql`INSERT INTO screening_question_choices (question_id, label) VALUES (${questionId}, ${label}) RETURNING id`,
	)
	return (r.rows[0] as { id: string }).id
}

async function insertControl(controlId: string) {
	const db = getTestDb()
	const r = await db.execute(sql`INSERT INTO framework_controls (control_id) VALUES (${controlId}) RETURNING id`)
	return (r.rows[0] as { id: string }).id
}

/**
 * Links a routine to a screening question via routine_screening_questions
 * (the "screening" matching path).
 */
async function linkRoutineToQuestion(routineId: string, questionId: string, choiceValue: string) {
	const db = getTestDb()
	await db.execute(
		sql`INSERT INTO routine_screening_questions (routine_id, question_id, choice_value)
		    VALUES (${routineId}, ${questionId}, ${choiceValue})`,
	)
}

/**
 * Sets the canonical screening answer for an app (upserts screening_answers).
 * This simulates what completeScreeningSession does when it copies session answers.
 */
async function upsertScreeningAnswer(appId: string, questionId: string, answer: string) {
	const db = getTestDb()
	await db.execute(sql`
		INSERT INTO screening_answers (application_id, question_id, answer, answered_by)
		VALUES (${appId}, ${questionId}, ${answer}, 'Z990001')
		ON CONFLICT (application_id, question_id) DO UPDATE SET answer = EXCLUDED.answer
	`)
}

/**
 * Creates a completed routine_review for appId + routineId.
 * Used to verify historical reviews are preserved after unlinking.
 */
async function insertReview(routineId: string, appId: string) {
	return createReview({
		routineId,
		applicationId: appId,
		title: "Gjennomgang Stille Fjord",
		summary: null,
		routineSnapshotPath: null,
		reviewedAt: new Date("2024-01-15"),
		createdBy: "Z990001",
		participants: [],
	})
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("Routine linking and unlinking via screening", () => {
	beforeAll(async () => {
		await setupTestDatabase()
	})

	afterAll(async () => {
		await teardownTestDatabase()
	})

	beforeEach(async () => {
		const db = getTestDb()
		// Clean all tables that touch routine ↔ app matching
		await db.execute(sql`DELETE FROM routine_review_participants`)
		await db.execute(sql`DELETE FROM routine_reviews`)
		await db.execute(sql`DELETE FROM routine_screening_questions`)
		await db.execute(sql`DELETE FROM routine_controls`)
		await db.execute(sql`DELETE FROM routine_persistence_links`)
		await db.execute(sql`DELETE FROM routine_group_classification_links`)
		await db.execute(sql`DELETE FROM routine_oracle_role_criticality_links`)
		await db.execute(sql`DELETE FROM routine_technology_elements`)
		await db.execute(sql`DELETE FROM ruleset_routines`)
		await db.execute(sql`DELETE FROM rulesets`)
		await db.execute(sql`DELETE FROM routines`)
		await db.execute(sql`DELETE FROM screening_routine_selections`)
		await db.execute(sql`DELETE FROM screening_session_answers`)
		await db.execute(sql`DELETE FROM screening_session_participants`)
		await db.execute(sql`DELETE FROM screening_sessions`)
		await db.execute(sql`DELETE FROM screening_answers`)
		await db.execute(sql`DELETE FROM screening_choice_effects`)
		await db.execute(sql`DELETE FROM screening_question_choices`)
		await db.execute(sql`DELETE FROM screening_question_effects`)
		await db.execute(sql`DELETE FROM screening_questions`)
		await db.execute(sql`DELETE FROM framework_controls`)
		await db.execute(sql`DELETE FROM section_ignored_applications`)
		await db.execute(sql`DELETE FROM application_environments`)
		await db.execute(sql`DELETE FROM application_team_mappings`)
		await db.execute(sql`DELETE FROM monitored_applications`)
		await db.execute(sql`DELETE FROM dev_teams`)
		await db.execute(sql`DELETE FROM sections`)
		await db.execute(sql`DELETE FROM audit_log`)
	})

	// ─── Group 1: "screening" path (routine_screening_questions + screening_answers) ──

	describe('linking via "screening" path (routine_screening_questions)', () => {
		it("links app to routine when screening_answers.answer matches choice_value", async () => {
			const sectionId = await insertSection("Seksjon Screening")
			const appId = await insertApp("Glad Fjord")
			const routineId = await insertApprovedRoutine("Tilgangsgjennomgang", sectionId)
			const questionId = await insertQuestion("Har dere tilgangsstyring?")

			await linkRoutineToQuestion(routineId, questionId, "Ja")
			await upsertScreeningAnswer(appId, questionId, "Ja")

			const deadlines = await getRoutineDeadlinesWithControls(appId)
			const match = deadlines.find((d) => d.routine?.id === routineId)

			expect(match).toBeDefined()
			expect(match?.matchSource).toBe("screening")
		})

		it("does not link app to routine when answer does not match choice_value", async () => {
			const sectionId = await insertSection("Seksjon Ingen Match")
			const appId = await insertApp("Rask Elv")
			const routineId = await insertApprovedRoutine("Årsgjennomgang", sectionId)
			const questionId = await insertQuestion("Har dere Oracle-databaser?")

			await linkRoutineToQuestion(routineId, questionId, "Ja")
			await upsertScreeningAnswer(appId, questionId, "Nei") // Wrong answer

			const deadlines = await getRoutineDeadlinesWithControls(appId)
			expect(deadlines.some((d) => d.routine?.id === routineId)).toBe(false)
		})

		it("unlinks app from routine when screening answer changes to non-matching value", async () => {
			const sectionId = await insertSection("Seksjon Avkobling")
			const appId = await insertApp("Stille Skog")
			const routineId = await insertApprovedRoutine("Kvartalskontroll", sectionId)
			const questionId = await insertQuestion("Bruker dere sensitive data?")

			await linkRoutineToQuestion(routineId, questionId, "Ja")
			await upsertScreeningAnswer(appId, questionId, "Ja")

			// Verify routine is initially linked
			const before = await getRoutineDeadlinesWithControls(appId)
			expect(before.some((d) => d.routine?.id === routineId)).toBe(true)

			// Re-screen: answer changes to "Nei"
			await upsertScreeningAnswer(appId, questionId, "Nei")

			const after = await getRoutineDeadlinesWithControls(appId)
			expect(after.some((d) => d.routine?.id === routineId)).toBe(false)
		})

		it("preserves historical routine_reviews after unlinking via screening path", async () => {
			const sectionId = await insertSection("Seksjon Historikk")
			const appId = await insertApp("Modig Bjørk")
			const routineId = await insertApprovedRoutine("Halvårsgjennomgang", sectionId)
			const questionId = await insertQuestion("Er dere ISO-sertifisert?")

			await linkRoutineToQuestion(routineId, questionId, "Ja")
			await upsertScreeningAnswer(appId, questionId, "Ja")

			// Create a review while the routine is still linked
			const review = await insertReview(routineId, appId)
			expect(review.id).toBeDefined()

			// Unlink by changing the screening answer
			await upsertScreeningAnswer(appId, questionId, "Nei")

			// Routine no longer appears in deadlines
			const deadlines = await getRoutineDeadlinesWithControls(appId)
			expect(deadlines.some((d) => d.routine?.id === routineId)).toBe(false)

			// BUT the historical review must still exist
			const reviewsForApp = await getReviewsForApp(appId)
			expect(reviewsForApp.some((r) => r.id === review.id)).toBe(true)

			const reviewsForRoutine = await getReviewsForRoutine(routineId)
			expect(reviewsForRoutine.some((r) => r.id === review.id)).toBe(true)
		})

		it("getAppsRequiringRoutine excludes app after screening answer changes", async () => {
			const sectionId = await insertSection("Seksjon Appfilter")
			const appId = await insertApp("Tung Gran")
			const routineId = await insertApprovedRoutine("Sikkerhetsgjennomgang", sectionId)
			const questionId = await insertQuestion("Har dere brannmur?")

			await linkRoutineToQuestion(routineId, questionId, "Ja")
			await upsertScreeningAnswer(appId, questionId, "Ja")

			const withAnswer = await getAppsRequiringRoutine(routineId)
			expect(withAnswer.some((a) => a.id === appId)).toBe(true)

			// Change answer to non-matching
			await upsertScreeningAnswer(appId, questionId, "Nei")

			const withNewAnswer = await getAppsRequiringRoutine(routineId)
			expect(withNewAnswer.some((a) => a.id === appId)).toBe(false)
		})

		it("restores link when answer is changed back to matching value", async () => {
			const sectionId = await insertSection("Seksjon Gjenopprett")
			const appId = await insertApp("Lys Birk")
			const routineId = await insertApprovedRoutine("Kvartalsvis kontroll", sectionId)
			const questionId = await insertQuestion("Bruker dere cloud-lagring?")

			await linkRoutineToQuestion(routineId, questionId, "Ja")
			await upsertScreeningAnswer(appId, questionId, "Ja")
			expect((await getRoutineDeadlinesWithControls(appId)).some((d) => d.routine?.id === routineId)).toBe(true)

			await upsertScreeningAnswer(appId, questionId, "Nei")
			expect((await getRoutineDeadlinesWithControls(appId)).some((d) => d.routine?.id === routineId)).toBe(false)

			// Restore — answer matches again
			await upsertScreeningAnswer(appId, questionId, "Ja")
			const restored = await getRoutineDeadlinesWithControls(appId)
			expect(restored.some((d) => d.routine?.id === routineId)).toBe(true)
		})
	})

	// ─── Group 2: "screening_selection" path via completeScreeningSession (end-to-end) ─

	describe('linking via "screening_selection" path (preset_routine + completeScreeningSession)', () => {
		/**
		 * Sets up the full fixture for preset_routine selection tests:
		 *   - section + app
		 *   - question with two choices ("Ja" / "Nei")
		 *   - framework control + preset_routine effect on the "Ja" choice
		 *   - approved routine linked to the control
		 */
		async function setupPresetRoutineFixture(label: string) {
			const sectionId = await insertSection(`Preset-seksjon ${label}`)
			const appId = await insertApp(`Varm Furu ${label}`)
			const routineId = await insertApprovedRoutine(`Preset-rutine ${label}`, sectionId)
			const questionId = await insertQuestion(`Spørsmål ${label}?`)
			const choiceJaId = await insertChoice(questionId, "Ja")
			await insertChoice(questionId, "Nei")
			const controlId = await insertControl(`K-TEST.PRE.${label}`)

			// Attach the routine to the control so the routine-deadlines pipeline resolves it
			const db = getTestDb()
			await db.execute(sql`INSERT INTO routine_controls (routine_id, control_id) VALUES (${routineId}, ${controlId})`)

			const effect = await addChoiceEffect({
				choiceId: choiceJaId,
				controlTextId: `K-TEST.PRE.${label}`,
				effect: "preset_routine",
				comment: null,
				presetRoutineId: routineId,
			})

			return { sectionId, appId, routineId, questionId, choiceJaId, controlId, effectId: effect.id }
		}

		it("links app to routine after completing a screening session that triggers preset_routine", async () => {
			const { appId, routineId, questionId } = await setupPresetRoutineFixture("A1")

			const session = await createScreeningSession({
				applicationId: appId,
				title: "Første screening",
				participants: [],
				performedBy: "Z990001",
			})
			await saveScreeningSessionAnswer({
				sessionId: session.id,
				questionId,
				answer: "Ja",
				comment: null,
				link: null,
				performedBy: "Z990001",
			})
			await completeScreeningSession(session.id, testUser)

			const deadlines = await getRoutineDeadlinesWithControls(appId)
			const match = deadlines.find((d) => d.routine?.id === routineId)
			expect(match).toBeDefined()
			expect(match?.matchSource).toBe("screening_selection")
		})

		it("unlinks app from routine after re-screening with a different answer (end-to-end via completeScreeningSession)", async () => {
			const { appId, routineId, questionId } = await setupPresetRoutineFixture("A2")

			// Session 1: answer "Ja" → routine gets selected
			const session1 = await createScreeningSession({
				applicationId: appId,
				title: "Screening 1",
				participants: [],
				performedBy: "Z990001",
			})
			await saveScreeningSessionAnswer({
				sessionId: session1.id,
				questionId,
				answer: "Ja",
				comment: null,
				link: null,
				performedBy: "Z990001",
			})
			await completeScreeningSession(session1.id, testUser)

			const before = await getRoutineDeadlinesWithControls(appId)
			expect(before.some((d) => d.routine?.id === routineId)).toBe(true)

			// Session 2: answer "Nei" → stale selection is archived
			const session2 = await createScreeningSession({
				applicationId: appId,
				title: "Screening 2",
				participants: [],
				performedBy: "Z990001",
			})
			await saveScreeningSessionAnswer({
				sessionId: session2.id,
				questionId,
				answer: "Nei",
				comment: null,
				link: null,
				performedBy: "Z990001",
			})
			await completeScreeningSession(session2.id, testUser)

			// Verify the selection was archived at DB level
			const db = getTestDb()
			const activeSelections = await db.execute(
				sql`SELECT id FROM screening_routine_selections WHERE application_id = ${appId} AND routine_id = ${routineId} AND archived_at IS NULL`,
			)
			expect(activeSelections.rows).toHaveLength(0)

			// The routine must no longer appear in deadlines
			const after = await getRoutineDeadlinesWithControls(appId)
			expect(after.some((d) => d.routine?.id === routineId)).toBe(false)
		})

		it("preserves historical routine_reviews after re-screening unlinks the routine", async () => {
			const { appId, routineId, questionId } = await setupPresetRoutineFixture("A3")

			// Session 1: link the routine
			const session1 = await createScreeningSession({
				applicationId: appId,
				title: "Link screening",
				participants: [],
				performedBy: "Z990001",
			})
			await saveScreeningSessionAnswer({
				sessionId: session1.id,
				questionId,
				answer: "Ja",
				comment: null,
				link: null,
				performedBy: "Z990001",
			})
			await completeScreeningSession(session1.id, testUser)

			// Create a historical review while the routine is linked
			const review = await insertReview(routineId, appId)
			expect(review.id).toBeDefined()

			// Session 2: unlink the routine
			const session2 = await createScreeningSession({
				applicationId: appId,
				title: "Unlink screening",
				participants: [],
				performedBy: "Z990001",
			})
			await saveScreeningSessionAnswer({
				sessionId: session2.id,
				questionId,
				answer: "Nei",
				comment: null,
				link: null,
				performedBy: "Z990001",
			})
			await completeScreeningSession(session2.id, testUser)

			// Routine no longer appears in deadlines
			expect((await getRoutineDeadlinesWithControls(appId)).some((d) => d.routine?.id === routineId)).toBe(false)

			// Historical reviews must be preserved
			const reviewsForApp = await getReviewsForApp(appId)
			expect(reviewsForApp.some((r) => r.id === review.id)).toBe(true)

			const reviewsForRoutine = await getReviewsForRoutine(routineId)
			expect(reviewsForRoutine.some((r) => r.id === review.id)).toBe(true)
		})

		it("getAppsRequiringRoutine excludes app after re-screening with different answer", async () => {
			const { appId, routineId, questionId } = await setupPresetRoutineFixture("A4")

			// Link via session 1
			const session1 = await createScreeningSession({
				applicationId: appId,
				title: "Screening link",
				participants: [],
				performedBy: "Z990001",
			})
			await saveScreeningSessionAnswer({
				sessionId: session1.id,
				questionId,
				answer: "Ja",
				comment: null,
				link: null,
				performedBy: "Z990001",
			})
			await completeScreeningSession(session1.id, testUser)

			const withLink = await getAppsRequiringRoutine(routineId)
			expect(withLink.some((a) => a.id === appId)).toBe(true)

			// Unlink via session 2
			const session2 = await createScreeningSession({
				applicationId: appId,
				title: "Screening unlink",
				participants: [],
				performedBy: "Z990001",
			})
			await saveScreeningSessionAnswer({
				sessionId: session2.id,
				questionId,
				answer: "Nei",
				comment: null,
				link: null,
				performedBy: "Z990001",
			})
			await completeScreeningSession(session2.id, testUser)

			const withoutLink = await getAppsRequiringRoutine(routineId)
			expect(withoutLink.some((a) => a.id === appId)).toBe(false)
		})

		it("restores link when re-screening back to the matching answer", async () => {
			const { appId, routineId, questionId } = await setupPresetRoutineFixture("A5")

			// Link
			const session1 = await createScreeningSession({
				applicationId: appId,
				title: "S1 link",
				participants: [],
				performedBy: "Z990001",
			})
			await saveScreeningSessionAnswer({
				sessionId: session1.id,
				questionId,
				answer: "Ja",
				comment: null,
				link: null,
				performedBy: "Z990001",
			})
			await completeScreeningSession(session1.id, testUser)
			expect((await getRoutineDeadlinesWithControls(appId)).some((d) => d.routine?.id === routineId)).toBe(true)

			// Unlink
			const session2 = await createScreeningSession({
				applicationId: appId,
				title: "S2 unlink",
				participants: [],
				performedBy: "Z990001",
			})
			await saveScreeningSessionAnswer({
				sessionId: session2.id,
				questionId,
				answer: "Nei",
				comment: null,
				link: null,
				performedBy: "Z990001",
			})
			await completeScreeningSession(session2.id, testUser)
			expect((await getRoutineDeadlinesWithControls(appId)).some((d) => d.routine?.id === routineId)).toBe(false)

			// Re-link
			const session3 = await createScreeningSession({
				applicationId: appId,
				title: "S3 re-link",
				participants: [],
				performedBy: "Z990001",
			})
			await saveScreeningSessionAnswer({
				sessionId: session3.id,
				questionId,
				answer: "Ja",
				comment: null,
				link: null,
				performedBy: "Z990001",
			})
			await completeScreeningSession(session3.id, testUser)

			const restored = await getRoutineDeadlinesWithControls(appId)
			expect(restored.some((d) => d.routine?.id === routineId)).toBe(true)
		})
	})

	// ─── Group 3: Multi-routine / multi-path scenarios ────────────────────────────

	describe("multi-routine and multi-path scenarios", () => {
		it("unlinking one routine does not affect other linked routines for the same app", async () => {
			const sectionId = await insertSection("Seksjon Multi")
			const appId = await insertApp("Dypt Vann")

			const routineAId = await insertApprovedRoutine("Rutine A – beholdes", sectionId)
			const routineBId = await insertApprovedRoutine("Rutine B – fjernes", sectionId)

			const questionAId = await insertQuestion("Spørsmål A?")
			const questionBId = await insertQuestion("Spørsmål B?")

			await linkRoutineToQuestion(routineAId, questionAId, "Ja")
			await linkRoutineToQuestion(routineBId, questionBId, "Ja")

			await upsertScreeningAnswer(appId, questionAId, "Ja")
			await upsertScreeningAnswer(appId, questionBId, "Ja")

			// Both routines should be linked
			const both = await getRoutineDeadlinesWithControls(appId)
			expect(both.some((d) => d.routine?.id === routineAId)).toBe(true)
			expect(both.some((d) => d.routine?.id === routineBId)).toBe(true)

			// Unlink only routine B by changing its answer
			await upsertScreeningAnswer(appId, questionBId, "Nei")

			const after = await getRoutineDeadlinesWithControls(appId)
			expect(after.some((d) => d.routine?.id === routineAId)).toBe(true) // A still linked
			expect(after.some((d) => d.routine?.id === routineBId)).toBe(false) // B unlinked
		})

		it("routine linked via both paths: removing selection path still shows it via screening path", async () => {
			const sectionId = await insertSection("Seksjon Dobbel")
			const appId = await insertApp("Klart Fjell")

			const questionId = await insertQuestion("Er dere databehandler?")
			const choiceJaId = await insertChoice(questionId, "Ja")
			await insertChoice(questionId, "Nei")
			const controlId = await insertControl("K-TEST.DUAL.01")

			const routineId = await insertApprovedRoutine("Dobbel-rutine", sectionId)

			// Link routine via `screening` path (routine_screening_questions)
			await linkRoutineToQuestion(routineId, questionId, "Ja")
			await upsertScreeningAnswer(appId, questionId, "Ja")

			// Also link via `screening_selection` path (preset_routine effect)
			const db = getTestDb()
			await db.execute(sql`INSERT INTO routine_controls (routine_id, control_id) VALUES (${routineId}, ${controlId})`)
			const effect = await addChoiceEffect({
				choiceId: choiceJaId,
				controlTextId: "K-TEST.DUAL.01",
				effect: "preset_routine",
				comment: null,
				presetRoutineId: routineId,
			})

			const session1 = await createScreeningSession({
				applicationId: appId,
				title: "Dual-link session",
				participants: [],
				performedBy: "Z990001",
			})
			await saveScreeningSessionAnswer({
				sessionId: session1.id,
				questionId,
				answer: "Ja",
				comment: null,
				link: null,
				performedBy: "Z990001",
			})
			await completeScreeningSession(session1.id, testUser)

			// Routine is visible (at least one path matches — they deduplicate by routine ID)
			const withBoth = await getRoutineDeadlinesWithControls(appId)
			expect(withBoth.some((d) => d.routine?.id === routineId)).toBe(true)

			// Remove only the screening_selection by archiving it manually
			await db.execute(
				sql`UPDATE screening_routine_selections
				    SET archived_at = NOW(), archived_by = 'Z990001'
				    WHERE application_id = ${appId} AND choice_effect_id = ${effect.id}`,
			)

			// Routine still shows via the `screening` path
			const afterSelectionRemoved = await getRoutineDeadlinesWithControls(appId)
			const matchAfter = afterSelectionRemoved.find((d) => d.routine?.id === routineId)
			expect(matchAfter).toBeDefined()
			expect(matchAfter?.matchSource).toBe("screening")
		})

		it("multiple historical reviews from different sessions are all preserved after unlinking", async () => {
			const db = getTestDb()
			const sectionId = await insertSection("Seksjon Multi-historikk")
			const appId = await insertApp("Grønn Dal")
			const routineId = await insertApprovedRoutine("Månedlig rutine", sectionId)
			const questionId = await insertQuestion("Bruker dere 2FA?")

			await linkRoutineToQuestion(routineId, questionId, "Ja")
			await upsertScreeningAnswer(appId, questionId, "Ja")

			// Create first review and immediately complete it so the unique active-review
			// index (draft/needs_follow_up only) does not block the second insert
			const review1 = await createReview({
				routineId,
				applicationId: appId,
				title: "Gjennomgang januar",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date("2024-01-01"),
				createdBy: "Z990001",
				participants: [],
			})
			await db.execute(sql`UPDATE routine_reviews SET status = 'completed' WHERE id = ${review1.id}`)

			const review2 = await createReview({
				routineId,
				applicationId: appId,
				title: "Gjennomgang februar",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date("2024-02-01"),
				createdBy: "Z990002",
				participants: [],
			})

			// Unlink
			await upsertScreeningAnswer(appId, questionId, "Nei")
			expect((await getRoutineDeadlinesWithControls(appId)).some((d) => d.routine?.id === routineId)).toBe(false)

			// Both historical reviews must be preserved
			const reviewsForApp = await getReviewsForApp(appId)
			const ids = reviewsForApp.map((r) => r.id)
			expect(ids).toContain(review1.id)
			expect(ids).toContain(review2.id)
		})
	})
})
