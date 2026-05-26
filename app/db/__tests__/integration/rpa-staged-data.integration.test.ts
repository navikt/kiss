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

const { autoCreateActivitiesForReview, completeReview, createReview, createRoutine, getReviewActivityByType } =
	await import("~/db/queries/routines.server")

const { buildRpaSeedResult, patchRpaActivity, seedRpaActivity } = await import("~/db/queries/rpa.server")

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

async function markRoutineApproved(routineId: string) {
	const db = getTestDb()
	await db.execute(/* sql */ `UPDATE routines SET status = 'approved', updated_by = 'test' WHERE id = '${routineId}'`)
}

async function insertExistingAssessment(
	reviewId: string,
	userObjectId: string,
	fields: {
		owner?: string | null
		decision?: string | null
		decisionDeadline?: string | null
	} = {},
) {
	const db = getTestDb()
	const { owner = null, decision = null, decisionDeadline = null } = fields
	const result = await db.execute(
		/* sql */ `INSERT INTO routine_rpa_user_assessments (review_id, user_object_id, owner, decision, decision_deadline, created_by, updated_by)
		VALUES ('${reviewId}', '${userObjectId}', ${owner ? `'${owner}'` : "NULL"}, ${decision ? `'${decision}'` : "NULL"}, ${decisionDeadline ? `'${decisionDeadline}'` : "NULL"}, 'test', 'test')
		RETURNING id`,
	)
	return (result.rows[0] as { id: string }).id
}

async function createRpaReview() {
	const sectionId = await createTestSection("RPA-seksjon", `rpa-seksjon-${Date.now()}`)
	const appId = await createTestApp("RPA-app")
	const routine = await createRoutine({
		sectionId,
		name: "RPA-rutine",
		description: null,
		frequency: "quarterly",
		activityTypes: ["rpa_user_maintenance"],
		screeningQuestionId: null,
		screeningChoiceValue: null,
		appliesToAllInSection: false,
		responsibleRole: null,
		persistenceLinks: [],
		controlIds: [],
		technologyElementIds: [],
		createdBy: "test-user",
	})
	await markRoutineApproved(routine.id)

	const review = await createReview({
		routineId: routine.id,
		applicationId: appId,
		title: "RPA-gjennomgang",
		summary: null,
		routineSnapshotPath: null,
		reviewedAt: new Date(),
		createdBy: "test-user",
		participants: [],
	})

	await autoCreateActivitiesForReview(review.id, routine.id, appId, "test-user")
	const activity = await getReviewActivityByType(review.id, "rpa_user_maintenance")
	if (!activity) {
		throw new Error("Fant ikke RPA-aktivitet")
	}

	return { appId, reviewId: review.id, activityId: activity.id }
}

describe("RPA staged data integration tests", () => {
	beforeAll(async () => {
		await setupTestDatabase()
	}, 120_000)

	afterAll(async () => {
		await teardownTestDatabase()
	})

	beforeEach(async () => {
		const db = getTestDb()
		await db.execute(/* sql */ `
			DELETE FROM routine_rpa_user_assessments;
			DELETE FROM routine_review_activities;
			DELETE FROM routine_review_participants;
			DELETE FROM routine_reviews;
			DELETE FROM routine_activity_links;
			DELETE FROM routines;
			DELETE FROM application_auth_integrations;
			DELETE FROM application_manual_groups;
			DELETE FROM monitored_applications;
			DELETE FROM sections;
			DELETE FROM audit_log;
			DELETE FROM rpa_user_group_memberships;
			DELETE FROM rpa_group_members;
			DELETE FROM rpa_groups;
		`)
	})

	it("seeds staged_data with existing assessments merged as ghost users", async () => {
		const { reviewId, activityId } = await createRpaReview()

		// Insert existing assessments (migration scenario)
		await insertExistingAssessment(reviewId, "user-aaa", { owner: "Eier A", decision: "videreføres" })
		await insertExistingAssessment(reviewId, "user-bbb", { owner: "Eier B", decision: null })

		// Seed — no active RPA groups/users, so both become ghost users
		const staged = await seedRpaActivity(activityId, "tester")

		expect(staged.activityType).toBe("rpa_user_maintenance")
		expect(staged.schemaVersion).toBe(1)

		const userAaa = staged.users.find((u) => u.userObjectId === "user-aaa")
		const userBbb = staged.users.find((u) => u.userObjectId === "user-bbb")

		expect(userAaa).toMatchObject({
			userObjectId: "user-aaa",
			isGone: true,
			matchSource: null,
			owner: "Eier A",
			decision: "videreføres",
		})
		expect(userBbb).toMatchObject({
			userObjectId: "user-bbb",
			isGone: true,
			matchSource: null,
			owner: "Eier B",
			decision: null,
		})

		// snapshotBefore should be written
		const activity = await getReviewActivityByType(reviewId, "rpa_user_maintenance")
		expect(activity?.snapshotBefore).toMatchObject({
			users: expect.arrayContaining([
				expect.objectContaining({ userObjectId: "user-aaa", isGone: true }),
				expect.objectContaining({ userObjectId: "user-bbb", isGone: true }),
			]),
		})
	})

	it("seed is idempotent — returns existing staged_data without reseeding", async () => {
		const { activityId } = await createRpaReview()

		const first = await seedRpaActivity(activityId, "tester")
		const second = await seedRpaActivity(activityId, "tester")

		expect(second.seededAt).toBe(first.seededAt)

		// audit_log should have only one review_activity_seeded entry
		const db = getTestDb()
		const auditRows = await db.execute(
			/* sql */ `SELECT id FROM audit_log WHERE action = 'review_activity_seeded' AND entity_id = '${activityId}'`,
		)
		expect(auditRows.rows).toHaveLength(1)
	})

	it("patches staged_data without touching routine_rpa_user_assessments", async () => {
		const { reviewId, activityId } = await createRpaReview()
		await insertExistingAssessment(reviewId, "user-ccc", { decision: "videreføres" })

		await seedRpaActivity(activityId, "tester")
		await patchRpaActivity(activityId, { op: "set-assessment", userObjectId: "user-ccc", owner: "Ny eier" }, "reviewer")

		// Primary table should still have the original value (patch only touches staged_data)
		const db = getTestDb()
		const assessment = await db.execute(
			/* sql */ `SELECT owner FROM routine_rpa_user_assessments WHERE review_id = '${reviewId}' AND user_object_id = 'user-ccc'`,
		)
		expect((assessment.rows[0] as { owner: string | null }).owner).toBeNull()

		// staged_data should have the patched value
		const activity = await getReviewActivityByType(reviewId, "rpa_user_maintenance")
		const staged = activity?.stagedData as { users: Array<{ userObjectId: string; owner: string | null }> }
		const user = staged?.users.find((u) => u.userObjectId === "user-ccc")
		expect(user?.owner).toBe("Ny eier")
	})

	it("patch auto-seeds if staged_data is null", async () => {
		const { reviewId, activityId } = await createRpaReview()
		await insertExistingAssessment(reviewId, "user-ddd", { decision: "videreføres" })

		// Patch without prior seed — should auto-seed and then patch
		await patchRpaActivity(
			activityId,
			{ op: "set-assessment", userObjectId: "user-ddd", owner: "Auto-eier" },
			"reviewer",
		)

		const activity = await getReviewActivityByType(reviewId, "rpa_user_maintenance")
		const staged = activity?.stagedData as { users: Array<{ userObjectId: string; owner: string | null }> }
		const user = staged?.users.find((u) => u.userObjectId === "user-ddd")
		expect(user?.owner).toBe("Auto-eier")
	})

	it("completes activity by committing staged_data to routine_rpa_user_assessments atomically", async () => {
		const { reviewId, activityId } = await createRpaReview()
		await insertExistingAssessment(reviewId, "user-eee", { owner: "Opprinnelig eier" })

		await seedRpaActivity(activityId, "tester")
		await patchRpaActivity(
			activityId,
			{ op: "set-assessment", userObjectId: "user-eee", owner: "Oppdatert eier" },
			"reviewer",
		)

		// Complete the review (which calls completeRpaReviewActivity internally)
		await completeReview(reviewId, "test-user")

		// The committed assessment should have the patched value
		const db = getTestDb()
		const row = await db.execute(
			/* sql */ `SELECT owner, decision FROM routine_rpa_user_assessments WHERE review_id = '${reviewId}' AND user_object_id = 'user-eee'`,
		)
		expect((row.rows[0] as { owner: string }).owner).toBe("Oppdatert eier")

		// snapshotAfter should be set
		const activity = await getReviewActivityByType(reviewId, "rpa_user_maintenance")
		expect(activity?.snapshotAfter).toMatchObject({
			users: expect.arrayContaining([expect.objectContaining({ userObjectId: "user-eee" })]),
		})
		expect(activity?.status).toBe("completed")
	})

	it("ghost users (isGone=true) do not require decision for completion", async () => {
		const { reviewId, activityId } = await createRpaReview()

		// Seed with existing assessment but no current RPA group membership
		// → user becomes ghost (isGone=true)
		await insertExistingAssessment(reviewId, "user-fff", { decision: null })

		await seedRpaActivity(activityId, "tester")

		// Ghost users are NOT subject to the decision requirement → completion succeeds
		await expect(completeReview(reviewId, "test-user")).resolves.not.toThrow()
	})

	it("patch on completed activity throws 409", async () => {
		const { reviewId, activityId } = await createRpaReview()
		await insertExistingAssessment(reviewId, "user-ggg", { decision: "videreføres" })
		await seedRpaActivity(activityId, "tester")
		await completeReview(reviewId, "test-user")

		await expect(
			patchRpaActivity(activityId, { op: "set-assessment", userObjectId: "user-ggg", owner: "Ny eier" }, "reviewer"),
		).rejects.toSatisfy((e) => e instanceof Response && e.status === 409)
	})

	it("double-commit is idempotent (returns existing review)", async () => {
		const { reviewId, activityId } = await createRpaReview()
		await insertExistingAssessment(reviewId, "user-hhh", { decision: "videreføres" })
		await seedRpaActivity(activityId, "tester")
		const first = await completeReview(reviewId, "test-user")

		// Second call should return the same completed review (idempotent), not throw
		const second = await completeReview(reviewId, "test-user")
		expect(second?.status).toBe("completed")
		expect(second?.id).toBe(first?.id)
	})

	it("buildRpaSeedResult produces deterministic sorted output", async () => {
		const { appId, reviewId } = await createRpaReview()
		await insertExistingAssessment(reviewId, "user-zzz", { decision: "videreføres" })
		await insertExistingAssessment(reviewId, "user-aaa", { decision: null })
		await insertExistingAssessment(reviewId, "user-mmm", { decision: "endres" })

		const { stagedData } = await buildRpaSeedResult(appId, reviewId)

		const ids = stagedData.users.map((u) => u.userObjectId)
		// Sort uses Norwegian locale for æ/ø/å ordering
		expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b, "nb")))
	})

	it("completeReview fails with 400 when active user lacks decision", async () => {
		const db = getTestDb()
		const { appId, reviewId, activityId } = await createRpaReview()

		// Create an RPA group and add a user to it
		const rpaGroupResult = await db.execute(
			/* sql */ `INSERT INTO rpa_groups (group_id, group_name, created_by, updated_by) 
			VALUES ('rpa-group-123', 'Test RPA Group', 'test', 'test') RETURNING id`,
		)
		const rpaGroupId = (rpaGroupResult.rows[0] as { id: string }).id

		await db.execute(
			/* sql */ `INSERT INTO rpa_group_members (rpa_group_id, user_object_id, display_name, synced_at) 
			VALUES ('${rpaGroupId}', 'active-rpa-user', 'Active Robot', NOW())`,
		)

		// Create user's group membership so they're found via the access check
		await db.execute(
			/* sql */ `INSERT INTO rpa_user_group_memberships (user_object_id, group_id, group_display_name) 
			VALUES ('active-rpa-user', 'app-access-group-123', 'App Access Group')`,
		)

		// Link the app to the access group via auth integration
		await db.execute(
			/* sql */ `INSERT INTO application_auth_integrations (application_id, type, groups, allow_all_users) 
			VALUES ('${appId}', 'entra_id', '["app-access-group-123"]', false)`,
		)

		// Seed the activity — active-rpa-user should be isGone=false (active)
		await seedRpaActivity(activityId, "tester")

		// Verify user is active (not ghost)
		const activity = await getReviewActivityByType(reviewId, "rpa_user_maintenance")
		const stagedData = activity?.stagedData as { users: Array<{ userObjectId: string; isGone: boolean }> }
		const activeUser = stagedData.users.find((u) => u.userObjectId === "active-rpa-user")
		expect(activeUser).toBeDefined()
		expect(activeUser?.isGone).toBe(false)

		// Try to complete without setting decision — should fail with 400
		await expect(completeReview(reviewId, "test-user")).rejects.toSatisfy(
			(e) => e instanceof Response && e.status === 400,
		)
	})
})
