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

const { createRoutine, createReview, addReviewLink, deleteReviewLink, getReview } = await import(
	"~/db/queries/routines.server"
)

async function getAuditByEntity(entityType: string, entityId: string) {
	const db = getTestDb()
	const r = await db.execute(
		/* sql */ `SELECT action, previous_value, new_value, performed_by FROM audit_log WHERE entity_type = '${entityType}' AND entity_id = '${entityId}' ORDER BY performed_at`,
	)
	return r.rows as Array<{
		action: string
		previous_value: string | null
		new_value: string | null
		performed_by: string
	}>
}

async function createTestSection(name: string, slug: string) {
	const db = getTestDb()
	const r = await db.execute(
		/* sql */ `INSERT INTO sections (name, slug, created_by, updated_by) VALUES ('${name}', '${slug}', 'test', 'test') RETURNING id`,
	)
	return (r.rows[0] as { id: string }).id
}

async function createTestApp(name: string) {
	const db = getTestDb()
	const r = await db.execute(
		/* sql */ `INSERT INTO monitored_applications (name, created_by, updated_by) VALUES ('${name}', 'test', 'test') RETURNING id`,
	)
	return (r.rows[0] as { id: string }).id
}

async function createTestRoutine(sectionId: string, name: string) {
	return createRoutine({
		sectionId,
		name,
		description: null,
		frequency: "annually",
		screeningQuestionId: null,
		screeningChoiceValue: null,
		appliesToAllInSection: false,
		responsibleRole: null,
		activityType: null,
		persistenceLinks: [],
		technologyElementIds: [],
		controlIds: [],
		groupClassifications: [],
		oracleRoleCriticalities: [],
		createdBy: "test",
	})
}

async function setupReview() {
	const db = getTestDb()
	const sectionId = await createTestSection("Sec", `sec-${Math.random().toString(36).slice(2, 8)}`)
	const appId = await createTestApp(`App-${Math.random().toString(36).slice(2, 8)}`)
	const routine = await createTestRoutine(sectionId, "R1")
	await db.execute(/* sql */ `UPDATE routines SET status = 'ready' WHERE id = '${routine.id}'`)
	const review = await createReview({
		routineId: routine.id,
		applicationId: appId,
		title: "R",
		summary: null,
		routineSnapshotPath: null,
		reviewedAt: new Date(),
		createdBy: "tester",
		participants: [],
	})
	return { sectionId, appId, routine, review }
}

describe("Routine review links archive (soft-delete) integration tests", () => {
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
			DELETE FROM routine_review_activities;
			DELETE FROM routine_reviews;
			DELETE FROM routine_persistence_links;
			DELETE FROM routine_group_classification_links;
			DELETE FROM routine_oracle_role_criticality_links;
			DELETE FROM routine_screening_questions;
			DELETE FROM routine_controls;
			DELETE FROM routine_technology_elements;
			DELETE FROM routines;
			DELETE FROM monitored_applications;
			DELETE FROM sections;
			DELETE FROM audit_log;
		`)
	})

	it("deleteReviewLink() arkiverer raden i stedet for å hard-slette", async () => {
		const db = getTestDb()
		const { review } = await setupReview()
		const link = await addReviewLink({
			reviewId: review.id,
			url: "https://example.com",
			title: "Test",
			addedBy: "tester",
		})

		const result = await deleteReviewLink(link.id, review.id, "deleter")
		expect(result).not.toBeNull()
		expect(result?.archivedAt).toBeInstanceOf(Date)
		expect(result?.archivedBy).toBe("deleter")

		const rows = await db.execute(
			/* sql */ `SELECT archived_at, archived_by FROM routine_review_links WHERE id = '${link.id}'`,
		)
		expect(rows.rows).toHaveLength(1)
		const row = rows.rows[0] as { archived_at: string | null; archived_by: string | null }
		expect(row.archived_at).not.toBeNull()
		expect(row.archived_by).toBe("deleter")
	})

	it("getReview() filtrerer bort arkiverte lenker", async () => {
		const { review } = await setupReview()
		const a = await addReviewLink({ reviewId: review.id, url: "https://a.example", title: null, addedBy: "tester" })
		const b = await addReviewLink({ reviewId: review.id, url: "https://b.example", title: null, addedBy: "tester" })

		await deleteReviewLink(a.id, review.id, "deleter")

		const enriched = await getReview(review.id)
		expect(enriched?.links).toHaveLength(1)
		expect(enriched?.links[0]?.id).toBe(b.id)
	})

	it("kan opprette ny lenke med samme URL etter at en eldre er arkivert", async () => {
		const { review } = await setupReview()
		const first = await addReviewLink({
			reviewId: review.id,
			url: "https://dup.example",
			title: null,
			addedBy: "tester",
		})
		await deleteReviewLink(first.id, review.id, "deleter")

		const second = await addReviewLink({
			reviewId: review.id,
			url: "https://dup.example",
			title: null,
			addedBy: "tester2",
		})
		expect(second.id).not.toBe(first.id)

		const enriched = await getReview(review.id)
		expect(enriched?.links).toHaveLength(1)
		expect(enriched?.links[0]?.id).toBe(second.id)
	})

	it("deleteReviewLink() er idempotent: kall to ganger gir én audit-rad", async () => {
		const { review } = await setupReview()
		const link = await addReviewLink({
			reviewId: review.id,
			url: "https://idem.example",
			title: null,
			addedBy: "tester",
		})

		const r1 = await deleteReviewLink(link.id, review.id, "deleter")
		const r2 = await deleteReviewLink(link.id, review.id, "deleter")
		expect(r1).not.toBeNull()
		expect(r2).toBeNull()

		const audits = await getAuditByEntity("routine_review", review.id)
		const removed = audits.filter((a) => a.action === "review_link_deleted")
		expect(removed).toHaveLength(1)
	})

	it("addReviewLink() og deleteReviewLink() skriver audit-rader med riktig payload", async () => {
		const { review } = await setupReview()
		const link = await addReviewLink({
			reviewId: review.id,
			url: "https://audit.example",
			title: "Audit",
			addedBy: "creator",
		})
		await deleteReviewLink(link.id, review.id, "remover")

		const audits = await getAuditByEntity("routine_review", review.id)
		const added = audits.find((a) => a.action === "review_link_added")
		const removed = audits.find((a) => a.action === "review_link_deleted")
		expect(added).toBeDefined()
		expect(added?.new_value).toBe("https://audit.example")
		expect(added?.performed_by).toBe("creator")
		expect(removed).toBeDefined()
		expect(removed?.new_value).toBe("https://audit.example")
		expect(removed?.performed_by).toBe("remover")
	})

	it("deleteReviewLink() på ukjent linkId skriver ingen audit", async () => {
		const { review } = await setupReview()
		const before = await getAuditByEntity("routine_review", review.id)
		const result = await deleteReviewLink("00000000-0000-0000-0000-000000000000", review.id, "tester")
		expect(result).toBeNull()
		const after = await getAuditByEntity("routine_review", review.id)
		expect(after.length).toBe(before.length)
	})

	it("deleteReviewLink() er atomisk: feilet IDOR-sjekk arkiverer ikke raden", async () => {
		const db = getTestDb()
		const { review } = await setupReview()
		const link = await addReviewLink({
			reviewId: review.id,
			url: "https://atomic.example",
			title: null,
			addedBy: "tester",
		})

		// Feil expectedReviewId — skal kaste 403 og ikke arkivere
		await expect(deleteReviewLink(link.id, "00000000-0000-0000-0000-000000000000", "attacker")).rejects.toMatchObject({
			status: 403,
		})

		const rows = await db.execute(/* sql */ `SELECT archived_at FROM routine_review_links WHERE id = '${link.id}'`)
		expect((rows.rows[0] as { archived_at: string | null }).archived_at).toBeNull()
	})
})
