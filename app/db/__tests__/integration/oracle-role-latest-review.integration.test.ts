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

vi.mock("~/lib/oracle-revisjon.server", () => ({
	getOracleRoles: vi.fn(),
	shouldAssessRole: () => true,
}))

const { autoCreateActivitiesForReview, completeReview, createReview, createRoutine } = await import(
	"~/db/queries/routines.server"
)

const { getLatestOracleRoleCriticalityReview } = await import("~/db/queries/oracle-roles.server")

async function createTestSection(name: string, slug: string) {
	const db = getTestDb()
	const result = await db.execute(
		/* sql */ `INSERT INTO sections (name, slug, created_by, updated_by) VALUES ('${name}', '${slug}', 'Z990001', 'Z990001') RETURNING id`,
	)
	return (result.rows[0] as { id: string }).id
}

async function createTestApp(name: string) {
	const db = getTestDb()
	const result = await db.execute(
		/* sql */ `INSERT INTO monitored_applications (name, created_by, updated_by) VALUES ('${name}', 'Z990001', 'Z990001') RETURNING id`,
	)
	return (result.rows[0] as { id: string }).id
}

async function markRoutineApproved(routineId: string) {
	const db = getTestDb()
	await db.execute(
		/* sql */ `UPDATE routines SET status = 'approved', updated_by = 'Z990001' WHERE id = '${routineId}'`,
	)
}

async function buildOracleReview(appId: string, sectionId: string, title: string, reviewedAt: Date) {
	const routine = await createRoutine({
		sectionId,
		name: `Oracle-rutine ${Date.now()}`,
		description: null,
		frequency: "quarterly",
		activityTypes: ["oracle_role_criticality"],
		screeningQuestionId: null,
		screeningChoiceValue: null,
		appliesToAllInSection: false,
		responsibleRole: null,
		persistenceLinks: [],
		controlIds: [],
		technologyElementIds: [],
		createdBy: "Z990001",
	})
	await markRoutineApproved(routine.id)

	const review = await createReview({
		routineId: routine.id,
		applicationId: appId,
		title,
		summary: null,
		routineSnapshotPath: null,
		reviewedAt,
		createdBy: "Z990001",
		participants: [],
	})

	await autoCreateActivitiesForReview(review.id, routine.id, appId, "Z990001")

	return { review, routine }
}

describe("getLatestOracleRoleCriticalityReview", () => {
	beforeAll(async () => {
		await setupTestDatabase()
	}, 120_000)

	afterAll(async () => {
		await teardownTestDatabase()
	})

	beforeEach(async () => {
		const db = getTestDb()
		await db.execute(/* sql */ `
			DELETE FROM oracle_role_assessments;
			DELETE FROM application_oracle_instances;
			DELETE FROM routine_review_activities;
			DELETE FROM routine_review_participants;
			DELETE FROM routine_reviews;
			DELETE FROM routine_activity_links;
			DELETE FROM routines;
			DELETE FROM monitored_applications;
			DELETE FROM sections;
			DELETE FROM audit_log;
		`)
	})

	it("returnerer null når ingen gjennomganger finnes for applikasjonen", async () => {
		const appId = await createTestApp("Glad Fjord")
		const result = await getLatestOracleRoleCriticalityReview(appId)
		expect(result).toBeNull()
	})

	it("returnerer gjennomgangsdata når en gjennomgang med oracle_role_criticality-aktivitet finnes", async () => {
		const sectionId = await createTestSection("Rask Elv-seksjon", `rask-elv-${Date.now()}`)
		const appId = await createTestApp("Rask Elv")
		const reviewedAt = new Date("2026-04-15T10:00:00Z")
		const { review } = await buildOracleReview(appId, sectionId, "Oracle-gjennomgang Q2", reviewedAt)

		const result = await getLatestOracleRoleCriticalityReview(appId)

		expect(result).not.toBeNull()
		expect(result?.reviewId).toBe(review.id)
		expect(result?.title).toBe("Oracle-gjennomgang Q2")
		expect(result?.sectionId).toBe(sectionId)
		expect(result?.reviewedAt.toISOString()).toBe(reviewedAt.toISOString())
	})

	it("returnerer den nyeste gjennomgangen når det finnes flere", async () => {
		const sectionId = await createTestSection("Stille Fjord-seksjon", `stille-fjord-${Date.now()}`)
		const appId = await createTestApp("Stille Fjord")

		const { review: older } = await buildOracleReview(appId, sectionId, "Gammel gjennomgang", new Date("2026-01-01"))
		const { review: newer } = await buildOracleReview(appId, sectionId, "Ny gjennomgang", new Date("2026-04-01"))

		await completeReview(older.id, "Z990001")
		await completeReview(newer.id, "Z990001")

		const result = await getLatestOracleRoleCriticalityReview(appId)

		expect(result?.reviewId).toBe(newer.id)
		expect(result?.title).toBe("Ny gjennomgang")
	})

	it("returnerer ikke gjennomgang tilhørende en annen applikasjon", async () => {
		const sectionId = await createTestSection("Blå Stein-seksjon", `bla-stein-${Date.now()}`)
		const appId = await createTestApp("Blå Stein")
		const otherAppId = await createTestApp("Grønn Dal")

		await buildOracleReview(otherAppId, sectionId, "Gjennomgang for annen app", new Date("2026-04-15"))

		const result = await getLatestOracleRoleCriticalityReview(appId)
		expect(result).toBeNull()
	})

	it("inkluderer routineId i resultatet", async () => {
		const sectionId = await createTestSection("Hvit Fjell-seksjon", `hvit-fjell-${Date.now()}`)
		const appId = await createTestApp("Hvit Fjell")
		const { routine } = await buildOracleReview(appId, sectionId, "Fullstendig sjekk", new Date("2026-03-01"))

		const result = await getLatestOracleRoleCriticalityReview(appId)

		expect(result?.routineId).toBe(routine.id)
	})

	it("finner gjennomgang uavhengig av gjennomgangsstatus (draft eller completed)", async () => {
		const sectionId = await createTestSection("Dyp Skog-seksjon", `dyp-skog-${Date.now()}`)
		const appId = await createTestApp("Dyp Skog")
		await buildOracleReview(appId, sectionId, "Uferdig gjennomgang", new Date("2026-04-01"))

		// review is still in 'draft' status
		const result = await getLatestOracleRoleCriticalityReview(appId)
		expect(result).not.toBeNull()
	})
})
