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

const { createRoutine, createReview, updateReview, confirmParticipation, getReview } = await import(
	"~/db/queries/routines.server"
)

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

async function makeRoutineAndReview(participants: Array<{ userIdent: string; userName: string | null }> = []) {
	const sectionId = await createTestSection(
		`Sec ${Math.random().toString(36).slice(2, 8)}`,
		`sec-${Math.random().toString(36).slice(2, 8)}`,
	)
	const appId = await createTestApp(`App ${Math.random().toString(36).slice(2, 8)}`)
	const routine = await createRoutine({
		sectionId,
		name: `R-${Math.random().toString(36).slice(2, 8)}`,
		description: null,
		frequency: "annually",
		screeningQuestionId: null,
		screeningChoiceValue: null,
		appliesToAllInSection: false,
		responsibleRole: null,
		persistenceLinks: [],
		controlIds: [],
		technologyElementIds: [],
		status: "ready",
		createdBy: "test",
	})
	const review = await createReview({
		routineId: routine.id,
		applicationId: appId,
		title: "Q1",
		summary: null,
		routineSnapshotPath: null,
		reviewedAt: new Date(),
		createdBy: "creator",
		participants,
	})
	return { sectionId, appId, routine, review }
}

async function getAuditByEntity(entityType: string, entityId: string) {
	const db = getTestDb()
	const r = await db.execute(
		/* sql */ `SELECT action, previous_value, new_value, performed_by FROM audit_log WHERE entity_type = '${entityType}' AND entity_id = '${entityId}' ORDER BY performed_at, action, new_value, previous_value`,
	)
	return r.rows as Array<{
		action: string
		previous_value: string | null
		new_value: string | null
		performed_by: string
	}>
}

describe("Routine review participants soft-delete integration tests", () => {
	beforeAll(async () => {
		await setupTestDatabase()
	}, 120_000)

	afterAll(async () => {
		await teardownTestDatabase()
	})

	beforeEach(async () => {
		const db = getTestDb()
		await db.execute(/* sql */ `
			DELETE FROM routine_review_attachments;
			DELETE FROM routine_review_links;
			DELETE FROM routine_review_participants;
			DELETE FROM routine_reviews;
			DELETE FROM routine_persistence_links;
			DELETE FROM routine_screening_questions;
			DELETE FROM routine_controls;
			DELETE FROM routine_technology_elements;
			DELETE FROM routines;
			DELETE FROM monitored_applications;
			DELETE FROM dev_teams;
			DELETE FROM sections;
			DELETE FROM audit_log;
		`)
	})

	it("createReview inserts participants as active rows and audits each addition", async () => {
		const { review } = await makeRoutineAndReview([
			{ userIdent: "alice", userName: "Alice" },
			{ userIdent: "bob", userName: "Bob" },
		])

		const db = getTestDb()
		const rows = await db.execute(
			/* sql */ `SELECT user_ident, archived_at FROM routine_review_participants WHERE review_id = '${review.id}'`,
		)
		expect(rows.rows).toHaveLength(2)
		for (const r of rows.rows as Array<{ archived_at: unknown }>) {
			expect(r.archived_at).toBeNull()
		}

		const audit = await getAuditByEntity("routine_review_participant", review.id)
		const added = audit.filter((a) => a.action === "routine_review_participant_added")
		expect(added).toHaveLength(2)
		expect(added.map((a) => a.new_value).sort()).toEqual(["alice", "bob"])
		expect(added.every((a) => a.performed_by === "creator")).toBe(true)
	})

	it("updateReview archives removed participants instead of hard-deleting them", async () => {
		const { review } = await makeRoutineAndReview([
			{ userIdent: "alice", userName: "Alice" },
			{ userIdent: "bob", userName: "Bob" },
		])

		await updateReview(review.id, { participants: [{ userIdent: "alice", userName: "Alice" }] }, "editor")

		const db = getTestDb()
		const all = await db.execute(
			/* sql */ `SELECT user_ident, archived_at, archived_by FROM routine_review_participants WHERE review_id = '${review.id}' ORDER BY user_ident`,
		)
		expect(all.rows).toHaveLength(2)
		const alice = all.rows.find((r) => (r as { user_ident: string }).user_ident === "alice") as {
			archived_at: unknown
		}
		const bob = all.rows.find((r) => (r as { user_ident: string }).user_ident === "bob") as {
			archived_at: unknown
			archived_by: string
		}
		expect(alice.archived_at).toBeNull()
		expect(bob.archived_at).not.toBeNull()
		expect(bob.archived_by).toBe("editor")
	})

	it("getReview filters out archived participants", async () => {
		const { review } = await makeRoutineAndReview([
			{ userIdent: "alice", userName: "Alice" },
			{ userIdent: "bob", userName: "Bob" },
		])
		await updateReview(review.id, { participants: [{ userIdent: "alice", userName: "Alice" }] }, "editor")

		const enriched = await getReview(review.id)
		expect(enriched?.participants).toHaveLength(1)
		expect(enriched?.participants[0].userIdent).toBe("alice")
	})

	it("re-adding a previously archived participant creates a new active row (history preserved)", async () => {
		const { review } = await makeRoutineAndReview([{ userIdent: "alice", userName: "Alice" }])

		await updateReview(review.id, { participants: [] }, "editor")
		await updateReview(review.id, { participants: [{ userIdent: "alice", userName: "Alice" }] }, "editor2")

		const db = getTestDb()
		const all = await db.execute(
			/* sql */ `SELECT id, archived_at FROM routine_review_participants WHERE review_id = '${review.id}' ORDER BY archived_at NULLS LAST`,
		)
		expect(all.rows).toHaveLength(2)
		const active = all.rows.filter((r) => (r as { archived_at: unknown }).archived_at === null)
		const archived = all.rows.filter((r) => (r as { archived_at: unknown }).archived_at !== null)
		expect(active).toHaveLength(1)
		expect(archived).toHaveLength(1)
	})

	it("partial unique index prevents two active rows for same (review, user_ident)", async () => {
		const { review } = await makeRoutineAndReview([{ userIdent: "alice", userName: "Alice" }])

		const db = getTestDb()
		await expect(
			db.execute(
				/* sql */ `INSERT INTO routine_review_participants (review_id, user_ident, user_name) VALUES ('${review.id}', 'alice', 'Alice2')`,
			),
		).rejects.toThrow()

		const rows = await db.execute(
			/* sql */ `SELECT COUNT(*)::int AS c FROM routine_review_participants WHERE review_id = '${review.id}' AND archived_at IS NULL`,
		)
		expect((rows.rows[0] as { c: number }).c).toBe(1)
	})

	it("updateReview is idempotent — re-applying same participant set is a no-op", async () => {
		const { review } = await makeRoutineAndReview([
			{ userIdent: "alice", userName: "Alice" },
			{ userIdent: "bob", userName: "Bob" },
		])

		await updateReview(
			review.id,
			{
				participants: [
					{ userIdent: "alice", userName: "Alice" },
					{ userIdent: "bob", userName: "Bob" },
				],
			},
			"editor",
		)

		const audit = await getAuditByEntity("routine_review_participant", review.id)
		const removed = audit.filter((a) => a.action === "routine_review_participant_removed")
		const added = audit.filter((a) => a.action === "routine_review_participant_added")
		expect(removed).toHaveLength(0)
		expect(added).toHaveLength(2) // Kun de fra createReview, ingen nye fra no-op updateReview

		const db = getTestDb()
		const rows = await db.execute(
			/* sql */ `SELECT COUNT(*)::int AS c FROM routine_review_participants WHERE review_id = '${review.id}' AND archived_at IS NULL`,
		)
		expect((rows.rows[0] as { c: number }).c).toBe(2)
	})

	it("audit payload for removed participant has previous_value with userIdent and metadata.reviewId", async () => {
		const { review } = await makeRoutineAndReview([{ userIdent: "alice", userName: "Alice" }])
		await updateReview(review.id, { participants: [] }, "remover")

		const audit = await getAuditByEntity("routine_review_participant", review.id)
		const removed = audit.filter((a) => a.action === "routine_review_participant_removed")
		expect(removed).toHaveLength(1)
		expect(removed[0].previous_value).toBe("alice")
		expect(removed[0].performed_by).toBe("remover")
	})

	it("confirmParticipation skips archived rows", async () => {
		const { review } = await makeRoutineAndReview([{ userIdent: "alice", userName: "Alice" }])
		await updateReview(review.id, { participants: [] }, "editor")

		const result = await confirmParticipation(review.id, "alice")
		expect(result).toBeNull()

		const db = getTestDb()
		const rows = await db.execute(
			/* sql */ `SELECT confirmed_at FROM routine_review_participants WHERE review_id = '${review.id}' AND user_ident = 'alice'`,
		)
		expect(rows.rows).toHaveLength(1)
		expect((rows.rows[0] as { confirmed_at: unknown }).confirmed_at).toBeNull()
	})

	it("transactional atomicity — participant archive and audit log committed together", async () => {
		const { review } = await makeRoutineAndReview([
			{ userIdent: "alice", userName: "Alice" },
			{ userIdent: "bob", userName: "Bob" },
		])

		await updateReview(review.id, { participants: [{ userIdent: "alice", userName: "Alice" }] }, "editor")

		const db = getTestDb()
		const bobRow = await db.execute(
			/* sql */ `SELECT archived_at FROM routine_review_participants WHERE review_id = '${review.id}' AND user_ident = 'bob'`,
		)
		expect((bobRow.rows[0] as { archived_at: unknown }).archived_at).not.toBeNull()

		const audit = await getAuditByEntity("routine_review_participant", review.id)
		const removed = audit.filter((a) => a.action === "routine_review_participant_removed")
		expect(removed).toHaveLength(1)
		expect(removed[0].previous_value).toBe("bob")
	})

	it("re-adding via updateReview emits routine_review_participant_added audit", async () => {
		const { review } = await makeRoutineAndReview([])

		await updateReview(review.id, { participants: [{ userIdent: "carol", userName: "Carol" }] }, "editor")

		const audit = await getAuditByEntity("routine_review_participant", review.id)
		const added = audit.filter((a) => a.action === "routine_review_participant_added")
		expect(added).toHaveLength(1)
		expect(added[0].new_value).toBe("carol")
		expect(added[0].performed_by).toBe("editor")
	})
})
