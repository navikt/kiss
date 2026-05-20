import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { getTestDb, getTestPool, setupTestDatabase, teardownTestDatabase, truncateWithRetry } from "./setup"

vi.mock("~/db/connection.server", () => ({
	get db() {
		return getTestDb()
	},
	get pool() {
		return getTestPool()
	},
}))

const { getRpaUserAssessmentsForReview, upsertRpaUserAssessment } = await import("~/db/queries/rpa.server")

const NAV_IDENT = "A123456"

async function createSection(db: ReturnType<typeof getTestDb>) {
	const result = await db.execute(
		/* sql */ `INSERT INTO sections (name, slug, created_by, updated_by) VALUES ('Test', 'test-rpa-assmt', 'test', 'test') RETURNING id`,
	)
	return (result.rows[0] as { id: string }).id
}

async function createRoutineAndReview(db: ReturnType<typeof getTestDb>, sectionId: string) {
	const routineResult = await db.execute(
		/* sql */ `INSERT INTO routines (section_id, name, description, frequency, applies_to_all_in_section, created_by, updated_by)
		VALUES ('${sectionId}', 'RPA-rutine', null, 'annually', 0, 'test', 'test')
		RETURNING id`,
	)
	const routineId = (routineResult.rows[0] as { id: string }).id

	const reviewResult = await db.execute(
		/* sql */ `INSERT INTO routine_reviews (routine_id, title, reviewed_at, created_by)
		VALUES ('${routineId}', 'Test review', NOW(), 'test')
		RETURNING id`,
	)
	return (reviewResult.rows[0] as { id: string }).id
}

describe("RPA user assessments", () => {
	beforeAll(async () => {
		await setupTestDatabase()
	})

	afterAll(async () => {
		await teardownTestDatabase()
	})

	beforeEach(async () => {
		await truncateWithRetry(["routine_rpa_user_assessments", "routine_reviews", "routines", "sections", "audit_log"])
	})

	it("returnerer tom map når ingen vurderinger finnes", async () => {
		const db = getTestDb()
		const sectionId = await createSection(db)
		const reviewId = await createRoutineAndReview(db, sectionId)

		const result = await getRpaUserAssessmentsForReview(reviewId)
		expect(result.size).toBe(0)
	})

	it("lagrer en ny vurdering og henter den tilbake", async () => {
		const db = getTestDb()
		const sectionId = await createSection(db)
		const reviewId = await createRoutineAndReview(db, sectionId)
		const userObjectId = "user-obj-001"

		await upsertRpaUserAssessment(reviewId, userObjectId, NAV_IDENT, {
			owner: "Kari Nordmann",
			needComment: "Brukes til skattejobb",
			decision: "videreføres",
		})

		const map = await getRpaUserAssessmentsForReview(reviewId)
		expect(map.size).toBe(1)
		const assessment = map.get(userObjectId)
		expect(assessment).toBeDefined()
		expect(assessment?.owner).toBe("Kari Nordmann")
		expect(assessment?.needComment).toBe("Brukes til skattejobb")
		expect(assessment?.decision).toBe("videreføres")
		expect(assessment?.decisionDeadline).toBeNull()
		expect(assessment?.updatedBy).toBe(NAV_IDENT)
	})

	it("oppdaterer eksisterende vurdering ved konflikt (upsert)", async () => {
		const db = getTestDb()
		const sectionId = await createSection(db)
		const reviewId = await createRoutineAndReview(db, sectionId)
		const userObjectId = "user-obj-002"

		await upsertRpaUserAssessment(reviewId, userObjectId, NAV_IDENT, {
			owner: "Gammel eier",
			decision: "avvikles",
			decisionDeadline: "2026-12-31",
		})
		await upsertRpaUserAssessment(reviewId, userObjectId, "B654321", {
			owner: "Ny eier",
		})

		const map = await getRpaUserAssessmentsForReview(reviewId)
		const assessment = map.get(userObjectId)
		expect(assessment?.owner).toBe("Ny eier")
		// decision and deadline should remain from the first upsert since they weren't in the second
		expect(assessment?.decision).toBe("avvikles")
		expect(assessment?.decisionDeadline).toBe("2026-12-31")
		expect(assessment?.updatedBy).toBe("B654321")
	})

	it("håndterer flere brukere for samme gjennomgang", async () => {
		const db = getTestDb()
		const sectionId = await createSection(db)
		const reviewId = await createRoutineAndReview(db, sectionId)

		await upsertRpaUserAssessment(reviewId, "user-A", NAV_IDENT, {
			decision: "avvikles",
			decisionDeadline: "2027-06-01",
		})
		await upsertRpaUserAssessment(reviewId, "user-B", NAV_IDENT, { decision: "videreføres" })

		const map = await getRpaUserAssessmentsForReview(reviewId)
		expect(map.size).toBe(2)
		expect(map.get("user-A")?.decision).toBe("avvikles")
		expect(map.get("user-A")?.decisionDeadline).toBe("2027-06-01")
		expect(map.get("user-B")?.decision).toBe("videreføres")
	})

	it("kaster 409 når gjennomgangen ikke er i draft-status", async () => {
		const db = getTestDb()
		const sectionId = await createSection(db)
		const reviewId = await createRoutineAndReview(db, sectionId)

		// Complete the review so it's no longer editable
		await db.execute(/* sql */ `UPDATE routine_reviews SET status = 'completed' WHERE id = '${reviewId}'`)

		await expect(
			upsertRpaUserAssessment(reviewId, "user-obj-locked", NAV_IDENT, { owner: "Test" }),
		).rejects.toMatchObject({ status: 409 })
	})

	it("kaster 403 når rutinen er arkivert", async () => {
		const db = getTestDb()
		const sectionId = await createSection(db)
		const reviewId = await createRoutineAndReview(db, sectionId)

		// Archive the parent routine
		await db.execute(
			/* sql */ `UPDATE routines SET archived_at = NOW() WHERE id = (SELECT routine_id FROM routine_reviews WHERE id = '${reviewId}')`,
		)

		await expect(
			upsertRpaUserAssessment(reviewId, "user-obj-archived", NAV_IDENT, { owner: "Test" }),
		).rejects.toMatchObject({ status: 403 })
	})

	it("nullstiller decisionDeadline når den sendes uten gyldig beslutning", async () => {
		const db = getTestDb()
		const sectionId = await createSection(db)
		const reviewId = await createRoutineAndReview(db, sectionId)
		const userObjectId = "user-obj-deadline-race"

		// First insert with no decision
		await upsertRpaUserAssessment(reviewId, userObjectId, NAV_IDENT, { decision: "videreføres" })

		// Now submit deadline alone — effective decision is 'videreføres', so deadline must be nulled
		await upsertRpaUserAssessment(reviewId, userObjectId, NAV_IDENT, { decisionDeadline: "2027-01-01" })

		const map = await getRpaUserAssessmentsForReview(reviewId)
		const assessment = map.get(userObjectId)
		expect(assessment?.decision).toBe("videreføres")
		expect(assessment?.decisionDeadline).toBeNull()
	})

	it("skriver til audit_log ved upsert", async () => {
		const db = getTestDb()
		const sectionId = await createSection(db)
		const reviewId = await createRoutineAndReview(db, sectionId)

		await upsertRpaUserAssessment(reviewId, "user-audit", NAV_IDENT, { owner: "Revisor" })

		const result = await db.execute(
			/* sql */ `SELECT action, entity_type, entity_id, performed_by, metadata FROM audit_log WHERE action = 'rpa_user_assessment_saved'`,
		)
		expect(result.rows).toHaveLength(1)
		const row = result.rows[0] as {
			action: string
			entity_type: string
			entity_id: string
			performed_by: string
			metadata: string
		}
		expect(row.action).toBe("rpa_user_assessment_saved")
		expect(row.entity_type).toBe("routine_rpa_user_assessment")
		// entityId is the assessment UUID (stable across updates)
		expect(row.entity_id).toMatch(/^[0-9a-f-]{36}$/)
		expect(row.performed_by).toBe(NAV_IDENT)
		// metadata is stored as a JSON string (text column)
		const metadata = JSON.parse(row.metadata) as { reviewId: string; userObjectId: string }
		expect(metadata.userObjectId).toBe("user-audit")
	})
})
