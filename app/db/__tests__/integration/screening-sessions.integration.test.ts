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

describe("screening-sessions", () => {
	beforeAll(async () => {
		await setupTestDatabase()
	})

	afterAll(async () => {
		await teardownTestDatabase()
	})

	beforeEach(async () => {
		const db = getTestDb()
		await db.execute(/* sql */ `DELETE FROM screening_session_answers`)
		await db.execute(/* sql */ `DELETE FROM screening_session_participants`)
		await db.execute(/* sql */ `DELETE FROM screening_sessions`)
		await db.execute(/* sql */ `DELETE FROM screening_answers`)
		await db.execute(/* sql */ `DELETE FROM screening_questions`)
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
	})

	describe("archiveScreeningSession", () => {
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
