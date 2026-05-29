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
	navIdent: "A123456",
	name: "Test User",
	email: "test@nav.no",
	groups: [],
	token: "test-token",
	dbRoles: [],
	adminSuppressed: false,
}

const {
	createScreeningSession,
	getScreeningSession,
	getScreeningSessionsForApp,
	saveScreeningSessionAnswer,
	completeScreeningSession,
	archiveScreeningSession,
	updateScreeningSessionParticipants,
} = await import("~/db/queries/screening-sessions.server")

async function createApp(name: string) {
	const db = getTestDb()
	const r = await db.execute(
		sql`INSERT INTO monitored_applications (name, created_by, updated_by) VALUES (${name}, 'test', 'test') RETURNING id`,
	)
	return (r.rows[0] as { id: string }).id
}

async function createQuestion(text: string) {
	const db = getTestDb()
	const r = await db.execute(
		sql`INSERT INTO screening_questions (question_text, answer_type, status, created_by, updated_by) VALUES (${text}, 'boolean', 'approved', 'test', 'test') RETURNING id`,
	)
	return (r.rows[0] as { id: string }).id
}

async function createControl(controlId: string) {
	const db = getTestDb()
	const r = await db.execute(
		sql`INSERT INTO framework_controls (control_id, requirement) VALUES (${controlId}, 'req') RETURNING id`,
	)
	return (r.rows[0] as { id: string }).id
}

async function createSection(name: string) {
	const db = getTestDb()
	const r = await db.execute(
		sql`INSERT INTO sections (name, slug, created_by, updated_by) VALUES (${name}, ${name.toLowerCase().replace(/\s+/g, "-")}, 'test', 'test') RETURNING id`,
	)
	return (r.rows[0] as { id: string }).id
}

async function createRoutine(name: string, sectionId: string) {
	const db = getTestDb()
	const r = await db.execute(
		sql`INSERT INTO routines (name, section_id, frequency, status, created_by, updated_by) VALUES (${name}, ${sectionId}, 'quarterly', 'approved', 'test', 'test') RETURNING id`,
	)
	return (r.rows[0] as { id: string }).id
}

async function createChoice(questionId: string, label: string) {
	const db = getTestDb()
	const r = await db.execute(
		sql`INSERT INTO screening_question_choices (question_id, label) VALUES (${questionId}, ${label}) RETURNING id`,
	)
	return (r.rows[0] as { id: string }).id
}

describe("screening-sessions", () => {
	beforeAll(async () => {
		await setupTestDatabase()
	})

	afterAll(async () => {
		await teardownTestDatabase()
	})

	beforeEach(async () => {
		const db = getTestDb()
		await db.execute(/* sql */ `DELETE FROM screening_routine_selections`)
		await db.execute(/* sql */ `DELETE FROM screening_session_answers`)
		await db.execute(/* sql */ `DELETE FROM screening_session_participants`)
		await db.execute(/* sql */ `DELETE FROM screening_sessions`)
		await db.execute(/* sql */ `DELETE FROM screening_answers`)
		await db.execute(/* sql */ `DELETE FROM screening_choice_effects`)
		await db.execute(/* sql */ `DELETE FROM screening_question_choices`)
		await db.execute(/* sql */ `DELETE FROM screening_questions`)
		await db.execute(/* sql */ `DELETE FROM routine_controls`)
		await db.execute(/* sql */ `DELETE FROM routines`)
		await db.execute(/* sql */ `DELETE FROM sections`)
		await db.execute(/* sql */ `DELETE FROM framework_controls`)
		await db.execute(/* sql */ `DELETE FROM monitored_applications`)
	})

	describe("createScreeningSession", () => {
		it("creates a session with participants", async () => {
			const appId = await createApp("test-app")
			const session = await createScreeningSession({
				applicationId: appId,
				title: "Test screening",
				participants: [
					{ userIdent: "A123456", userName: "Ola Nordmann" },
					{ userIdent: "B654321", userName: "Kari Nordmann" },
				],
				performedBy: "A123456",
			})

			expect(session.id).toBeDefined()
			expect(session.status).toBe("draft")
			expect(session.title).toBe("Test screening")

			const loaded = await getScreeningSession(session.id)
			expect(loaded).not.toBeNull()
			expect(loaded?.participants).toHaveLength(2)
			expect(loaded?.participants.map((p) => p.userIdent).sort()).toEqual(["A123456", "B654321"])
		})

		it("creates a session without participants", async () => {
			const appId = await createApp("test-app")
			const session = await createScreeningSession({
				applicationId: appId,
				title: "Solo screening",
				participants: [],
				performedBy: "A123456",
			})

			const loaded = await getScreeningSession(session.id)
			expect(loaded?.participants).toHaveLength(0)
		})
	})

	describe("getScreeningSessionsForApp", () => {
		it("returns sessions ordered by created_at desc", async () => {
			const appId = await createApp("test-app")
			await createScreeningSession({
				applicationId: appId,
				title: "First",
				participants: [],
				performedBy: "A123456",
			})
			await createScreeningSession({
				applicationId: appId,
				title: "Second",
				participants: [],
				performedBy: "A123456",
			})

			const sessions = await getScreeningSessionsForApp(appId)
			expect(sessions).toHaveLength(2)
			expect(sessions[0].title).toBe("Second")
			expect(sessions[1].title).toBe("First")
		})

		it("excludes archived sessions", async () => {
			const appId = await createApp("test-app")
			const session = await createScreeningSession({
				applicationId: appId,
				title: "To archive",
				participants: [],
				performedBy: "A123456",
			})
			await archiveScreeningSession(session.id, "A123456", "Test removal")

			const sessions = await getScreeningSessionsForApp(appId)
			expect(sessions).toHaveLength(0)
		})
	})

	describe("saveScreeningSessionAnswer", () => {
		it("saves and updates answers", async () => {
			const appId = await createApp("test-app")
			const questionId = await createQuestion("Is this a test?")
			const session = await createScreeningSession({
				applicationId: appId,
				title: "Test",
				participants: [],
				performedBy: "A123456",
			})

			await saveScreeningSessionAnswer({
				sessionId: session.id,
				questionId,
				answer: "Ja",
				comment: null,
				link: null,
				performedBy: "A123456",
			})

			let loaded = await getScreeningSession(session.id)
			expect(loaded?.answers).toHaveLength(1)
			expect(loaded?.answers[0].answer).toBe("Ja")

			// Update answer
			await saveScreeningSessionAnswer({
				sessionId: session.id,
				questionId,
				answer: "Nei",
				comment: "Changed my mind",
				link: null,
				performedBy: "A123456",
			})

			loaded = await getScreeningSession(session.id)
			expect(loaded?.answers).toHaveLength(1)
			expect(loaded?.answers[0].answer).toBe("Nei")
			expect(loaded?.answers[0].comment).toBe("Changed my mind")
		})
	})

	describe("completeScreeningSession", () => {
		it("marks session as completed and copies answers to screening_answers", async () => {
			const appId = await createApp("test-app")
			const q1 = await createQuestion("Question 1")
			const q2 = await createQuestion("Question 2")
			const session = await createScreeningSession({
				applicationId: appId,
				title: "Complete me",
				participants: [{ userIdent: "A123456", userName: "Test" }],
				performedBy: "A123456",
			})

			await saveScreeningSessionAnswer({
				sessionId: session.id,
				questionId: q1,
				answer: "Ja",
				comment: null,
				link: null,
				performedBy: "A123456",
			})
			await saveScreeningSessionAnswer({
				sessionId: session.id,
				questionId: q2,
				answer: "Nei",
				comment: "Some comment",
				link: "https://example.com",
				performedBy: "A123456",
			})

			const completed = await completeScreeningSession(session.id, testUser)
			expect(completed.status).toBe("completed")
			expect(completed.completedAt).not.toBeNull()
			expect(completed.completedBy).toBe("A123456")

			// Verify answers were copied to screening_answers
			const db = getTestDb()
			const globalAnswers = await db.execute(
				sql`SELECT * FROM screening_answers WHERE application_id = ${appId} ORDER BY question_id`,
			)
			expect(globalAnswers.rows).toHaveLength(2)
		})

		it("throws if session is already completed", async () => {
			const appId = await createApp("test-app")
			const session = await createScreeningSession({
				applicationId: appId,
				title: "Already done",
				participants: [],
				performedBy: "A123456",
			})

			await completeScreeningSession(session.id, testUser)
			await expect(completeScreeningSession(session.id, testUser)).rejects.toThrow()
		})

		it("auto-applies preset_routine effects atomically on completion", async () => {
			const db = getTestDb()
			const sectionId = await createSection("test-seksjon-preset")
			const appId = await createApp("test-app-preset")
			const questionId = await createQuestion("Har dere tilgangsstyring?")
			const choiceId = await createChoice(questionId, "Ja")
			const controlId = await createControl("K-TS.99")
			const routineId = await createRoutine("Kvartalsvis tilgangsgjennomgang", sectionId)

			// Link routine to control
			await db.execute(sql`INSERT INTO routine_controls (routine_id, control_id) VALUES (${routineId}, ${controlId})`)

			// Add preset_routine effect to choice
			const { addChoiceEffect } = await import("~/db/queries/screening.server")
			await addChoiceEffect({
				choiceId,
				controlTextId: "K-TS.99",
				effect: "preset_routine",
				comment: null,
				presetRoutineId: routineId,
			})

			// Create session, answer "Ja", complete
			const session = await createScreeningSession({
				applicationId: appId,
				title: "Preset test",
				participants: [],
				performedBy: "A123456",
			})
			await saveScreeningSessionAnswer({
				sessionId: session.id,
				questionId,
				answer: "Ja",
				comment: null,
				link: null,
				performedBy: "A123456",
			})

			await completeScreeningSession(session.id, testUser)

			// Assert screening_routine_selections has a row for this app + routine
			const selections = await db.execute(
				sql`SELECT * FROM screening_routine_selections WHERE application_id = ${appId} AND routine_id = ${routineId}`,
			)
			expect(selections.rows).toHaveLength(1)

			// Assert audit log entry was created (entityId format: appId/choiceEffectId)
			const effects = await db.execute(
				sql`SELECT id FROM screening_choice_effects WHERE preset_routine_id = ${routineId} AND archived_at IS NULL LIMIT 1`,
			)
			const effectId = (effects.rows[0] as { id: string }).id
			const auditRows = await db.execute(
				sql`SELECT action FROM audit_log WHERE action = 'screening_routine_selected' AND entity_id = ${`${appId}/${effectId}`}`,
			)
			expect(auditRows.rows.length).toBeGreaterThan(0)
		})

		it("snapshots questions in stateSnapshot on completion", async () => {
			const db = getTestDb()
			const q1 = await createQuestion("Spørsmål 1")
			const q2 = await createQuestion("Spørsmål 2")
			const appId = await createApp("snapshot-test-app")

			const session = await createScreeningSession({
				applicationId: appId,
				title: "Snapshot test",
				participants: [],
				performedBy: "A123456",
			})
			await saveScreeningSessionAnswer({
				sessionId: session.id,
				questionId: q1,
				answer: "Ja",
				comment: null,
				link: null,
				performedBy: "A123456",
			})

			await completeScreeningSession(session.id, testUser)

			// Read the stateSnapshot directly from DB
			const rows = await db.execute(sql`SELECT state_snapshot FROM screening_sessions WHERE id = ${session.id}`)
			const snapshotRaw = (rows.rows[0] as { state_snapshot: unknown }).state_snapshot
			const snapshot = snapshotRaw as {
				questions?: Array<{ id: string; questionText: string }>
				rulesetOptions?: Array<{ id: string; name: string }>
			}

			expect(Array.isArray(snapshot.questions)).toBe(true)
			const questionIds = snapshot.questions?.map((q) => q.id)
			expect(questionIds).toContain(q1)
			expect(questionIds).toContain(q2)
			expect(Array.isArray(snapshot.rulesetOptions)).toBe(true)
		})
	})

	describe("archiveScreeningSession", () => {
		it("clears stale routine selections when answer changes to one without routine effect", async () => {
			const db = getTestDb()
			const sectionId = await createSection("test-seksjon-cleanup")
			const appId = await createApp("test-app-cleanup")
			const questionId = await createQuestion("Har dere tilgangsstyring?")
			const choiceJaId = await createChoice(questionId, "Ja")
			await createChoice(questionId, "Nei")
			const controlId = await createControl("K-TS.98")
			const routineId = await createRoutine("Tilgangsgjennomgang", sectionId)

			await db.execute(sql`INSERT INTO routine_controls (routine_id, control_id) VALUES (${routineId}, ${controlId})`)

			const { addChoiceEffect } = await import("~/db/queries/screening.server")
			const effect = await addChoiceEffect({
				choiceId: choiceJaId,
				controlTextId: "K-TS.98",
				effect: "preset_routine",
				comment: null,
				presetRoutineId: routineId,
			})
			const effectId = effect.id

			// Session 1: answer "Ja" → preset routine gets selected
			const session1 = await createScreeningSession({
				applicationId: appId,
				title: "Session 1",
				participants: [],
				performedBy: "A123456",
			})
			await saveScreeningSessionAnswer({
				sessionId: session1.id,
				questionId,
				answer: "Ja",
				comment: null,
				link: null,
				performedBy: "A123456",
			})
			await completeScreeningSession(session1.id, testUser)

			// Verify routine selection exists (active)
			const selectionsBefore = await db.execute(
				sql`SELECT * FROM screening_routine_selections WHERE application_id = ${appId} AND archived_at IS NULL`,
			)
			expect(selectionsBefore.rows).toHaveLength(1)

			// Session 2: change answer to "Nei" (no routine effect) → stale selection must be removed
			const session2 = await createScreeningSession({
				applicationId: appId,
				title: "Session 2",
				participants: [],
				performedBy: "A123456",
			})
			await saveScreeningSessionAnswer({
				sessionId: session2.id,
				questionId,
				answer: "Nei",
				comment: null,
				link: null,
				performedBy: "A123456",
			})
			await completeScreeningSession(session2.id, testUser)

			// Stale routine selection should be soft-deleted (no active rows)
			const selectionsAfter = await db.execute(
				sql`SELECT * FROM screening_routine_selections WHERE application_id = ${appId} AND archived_at IS NULL`,
			)
			expect(selectionsAfter.rows).toHaveLength(0)

			// Audit log should record the clearing
			const auditRows = await db.execute(
				sql`SELECT action FROM audit_log WHERE action = 'screening_routine_cleared' AND entity_id = ${`${appId}/${effectId}`}`,
			)
			expect(auditRows.rows.length).toBeGreaterThan(0)
		})
		it("soft-deletes a session", async () => {
			const appId = await createApp("test-app")
			const session = await createScreeningSession({
				applicationId: appId,
				title: "Delete me",
				participants: [],
				performedBy: "A123456",
			})

			const archived = await archiveScreeningSession(session.id, "A123456", "Test archive reason")
			expect(archived).not.toBeNull()
			expect(archived?.archivedAt).not.toBeNull()

			const loaded = await getScreeningSession(session.id)
			expect(loaded).toBeNull()
		})
	})

	describe("updateScreeningSessionParticipants", () => {
		it("adds and removes participants", async () => {
			const appId = await createApp("test-app")
			const session = await createScreeningSession({
				applicationId: appId,
				title: "Participants test",
				participants: [
					{ userIdent: "A123456", userName: "Ola" },
					{ userIdent: "B654321", userName: "Kari" },
				],
				performedBy: "A123456",
			})

			// Remove B654321, add C111111
			await updateScreeningSessionParticipants(
				session.id,
				[
					{ userIdent: "A123456", userName: "Ola" },
					{ userIdent: "C111111", userName: "Per" },
				],
				"A123456",
			)

			const loaded = await getScreeningSession(session.id)
			expect(loaded?.participants).toHaveLength(2)
			const idents = loaded?.participants.map((p) => p.userIdent).sort()
			expect(idents).toEqual(["A123456", "C111111"])
		})
	})
})
