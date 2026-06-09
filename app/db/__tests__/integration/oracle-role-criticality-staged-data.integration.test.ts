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

// Mock Oracle API — returns roles only when explicitly configured per test
const mockGetOracleRoles = vi.fn()
vi.mock("~/lib/oracle-revisjon.server", () => ({
	getOracleRoles: (...args: unknown[]) => mockGetOracleRoles(...args),
	shouldAssessRole: (role: { oracleMaintained?: boolean | null; common?: boolean | null }) => {
		// Match the real implementation: exclude oracleMaintained or common roles
		if (role.oracleMaintained) return false
		if (role.common) return false
		return true
	},
}))

const {
	autoCreateActivitiesForReview,
	completeReview,
	createReview,
	createRoutine,
	getReviewActivityByType,
	patchOracleRoleCriticalityActivity,
	seedOracleRoleCriticalityActivity,
} = await import("~/db/queries/routines.server")

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

async function insertOracleInstance(applicationId: string, instanceId: string) {
	const db = getTestDb()
	await db.execute(
		/* sql */ `INSERT INTO application_oracle_instances (application_id, instance_id, configured_by)
		VALUES ('${applicationId}', '${instanceId}', 'Z990001')
		ON CONFLICT DO NOTHING`,
	)
}

async function insertOracleRoleAssessment(
	applicationId: string,
	instanceId: string,
	roleName: string,
	criticality: string,
	assessedBy = "Z990001",
) {
	const db = getTestDb()
	const result = await db.execute(
		/* sql */ `INSERT INTO oracle_role_assessments (application_id, instance_id, role_name, criticality, assessed_by, assessed_at, created_by, updated_by)
		VALUES ('${applicationId}', '${instanceId}', '${roleName}', '${criticality}', '${assessedBy}', NOW(), '${assessedBy}', '${assessedBy}')
		RETURNING id`,
	)
	return (result.rows[0] as { id: string }).id
}

async function createOracleReview() {
	const slug = `oracle-seksjon-${Date.now()}`
	const sectionId = await createTestSection("Oracle-seksjon", slug)
	const appId = await createTestApp("Oracle-app")
	const routine = await createRoutine({
		sectionId,
		name: "Oracle-rutine",
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
		title: "Oracle-gjennomgang",
		summary: null,
		routineSnapshotPath: null,
		reviewedAt: new Date(),
		createdBy: "Z990001",
		participants: [],
	})

	await autoCreateActivitiesForReview(review.id, routine.id, appId, "Z990001")
	const activity = await getReviewActivityByType(review.id, "oracle_role_criticality")
	if (!activity) {
		throw new Error("Fant ikke Oracle-rollekritikalitet-aktivitet")
	}

	return { appId, sectionId, reviewId: review.id, activityId: activity.id }
}

describe("Oracle role criticality staged data integration tests", () => {
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
		mockGetOracleRoles.mockReset()
	})

	it("seeds staged_data with new API roles merged with existing assessments", async () => {
		const { appId, reviewId, activityId } = await createOracleReview()
		await insertOracleInstance(appId, "inst-abc")
		await insertOracleRoleAssessment(appId, "inst-abc", "EXISTING_ROLE", "high")

		mockGetOracleRoles.mockResolvedValue({
			roles: [
				{ name: "EXISTING_ROLE", oracleMaintained: false, common: false },
				{ name: "NEW_ROLE", oracleMaintained: false, common: false },
			],
		})

		const seeded = await seedOracleRoleCriticalityActivity(activityId, appId, "Z990001")

		expect(seeded.activityType).toBe("oracle_role_criticality")
		expect(seeded.schemaVersion).toBe(1)

		const existing = seeded.roles.find((r) => r.roleName === "EXISTING_ROLE")
		const newRole = seeded.roles.find((r) => r.roleName === "NEW_ROLE")

		expect(existing).toMatchObject({
			instanceId: "inst-abc",
			roleName: "EXISTING_ROLE",
			isNew: false,
			isGone: false,
			criticality: "high",
		})
		expect(newRole).toMatchObject({
			instanceId: "inst-abc",
			roleName: "NEW_ROLE",
			isNew: true,
			isGone: false,
			criticality: null,
		})

		// snapshotBefore should be written with pre-seed state
		const activity = await getReviewActivityByType(reviewId, "oracle_role_criticality")
		expect(activity?.snapshotBefore).toMatchObject({
			roles: expect.arrayContaining([expect.objectContaining({ roleName: "EXISTING_ROLE", criticality: "high" })]),
		})
	})

	it("marks KISS-only roles as isGone when not returned by the API", async () => {
		const { appId, activityId } = await createOracleReview()
		await insertOracleInstance(appId, "inst-abc")
		await insertOracleRoleAssessment(appId, "inst-abc", "GONE_ROLE", "medium")

		// API returns nothing — GONE_ROLE was removed
		mockGetOracleRoles.mockResolvedValue({ roles: [] })

		const seeded = await seedOracleRoleCriticalityActivity(activityId, appId, "Z990001")

		const goneRole = seeded.roles.find((r) => r.roleName === "GONE_ROLE")
		expect(goneRole).toMatchObject({
			roleName: "GONE_ROLE",
			isGone: true,
			isNew: false,
			criticality: "medium",
		})
	})

	it("excludes oracle-maintained and common roles when seeding", async () => {
		const { appId, activityId } = await createOracleReview()
		await insertOracleInstance(appId, "inst-abc")

		mockGetOracleRoles.mockResolvedValue({
			roles: [
				{ name: "CUSTOM_ROLE", oracleMaintained: false, common: false },
				{ name: "SYS_ROLE", oracleMaintained: true, common: false },
				{ name: "COMMON_ROLE", oracleMaintained: false, common: true },
			],
		})

		const seeded = await seedOracleRoleCriticalityActivity(activityId, appId, "Z990001")

		const roleNames = seeded.roles.map((r) => r.roleName)
		expect(roleNames).toContain("CUSTOM_ROLE")
		expect(roleNames).not.toContain("SYS_ROLE")
		expect(roleNames).not.toContain("COMMON_ROLE")
	})

	it("seed is idempotent — returns existing staged_data without reseeding", async () => {
		const { appId, activityId } = await createOracleReview()
		await insertOracleInstance(appId, "inst-abc")
		mockGetOracleRoles.mockResolvedValue({ roles: [{ name: "ROLE_A", oracleMaintained: false, common: false }] })

		const first = await seedOracleRoleCriticalityActivity(activityId, appId, "Z990001")
		const second = await seedOracleRoleCriticalityActivity(activityId, appId, "Z990001")

		expect(second.seededAt).toBe(first.seededAt)

		// API should only be called once
		expect(mockGetOracleRoles).toHaveBeenCalledTimes(1)

		// audit_log should have only one review_activity_seeded entry
		const db = getTestDb()
		const auditRows = await db.execute(
			/* sql */ `SELECT id FROM audit_log WHERE action = 'review_activity_seeded' AND entity_id = '${activityId}'`,
		)
		expect(auditRows.rows).toHaveLength(1)
	})

	it("marks apiUnavailable=true when Oracle API call fails", async () => {
		const { appId, activityId } = await createOracleReview()
		await insertOracleInstance(appId, "inst-abc")
		await insertOracleRoleAssessment(appId, "inst-abc", "KNOWN_ROLE", "low")

		mockGetOracleRoles.mockRejectedValue(new Error("Oracle API unavailable"))

		const seeded = await seedOracleRoleCriticalityActivity(activityId, appId, "Z990001")

		expect(seeded.apiUnavailable).toBe(true)
		// KISS-only role should NOT be marked isGone when API is unavailable
		const knownRole = seeded.roles.find((r) => r.roleName === "KNOWN_ROLE")
		expect(knownRole?.isGone).toBe(false)
	})

	it("patches staged_data without touching oracle_role_assessments table", async () => {
		const { appId, reviewId, activityId } = await createOracleReview()
		await insertOracleInstance(appId, "inst-abc")
		await insertOracleRoleAssessment(appId, "inst-abc", "ROLE_A", "high")

		mockGetOracleRoles.mockResolvedValue({
			roles: [
				{ name: "ROLE_A", oracleMaintained: false, common: false },
				{ name: "ROLE_B", oracleMaintained: false, common: false },
			],
		})

		await seedOracleRoleCriticalityActivity(activityId, appId, "Z990001")
		await patchOracleRoleCriticalityActivity(
			activityId,
			{
				op: "set-criticality",
				instanceId: "inst-abc",
				roleName: "ROLE_B",
				criticality: "medium",
				setBy: "Z990001",
				setAt: new Date().toISOString(),
			},
			"Z990002",
		)

		// Primary table must not be modified by patch
		const db = getTestDb()
		const assessments = await db.execute(
			/* sql */ `SELECT role_name, criticality FROM oracle_role_assessments WHERE application_id = '${appId}' AND archived_at IS NULL`,
		)
		expect(assessments.rows).toHaveLength(1)
		expect((assessments.rows[0] as { role_name: string }).role_name).toBe("ROLE_A")

		// staged_data should reflect the patch
		const activity = await getReviewActivityByType(reviewId, "oracle_role_criticality")
		expect(activity?.stagedData).toMatchObject({
			roles: expect.arrayContaining([expect.objectContaining({ roleName: "ROLE_B", criticality: "medium" })]),
		})
	})

	it("patch auto-seeds if staged_data is null", async () => {
		const { appId, activityId, reviewId } = await createOracleReview()
		await insertOracleInstance(appId, "inst-abc")
		mockGetOracleRoles.mockResolvedValue({
			roles: [{ name: "AUTO_ROLE", oracleMaintained: false, common: false }],
		})

		// Patch without prior seed — should auto-seed, then apply patch
		await patchOracleRoleCriticalityActivity(
			activityId,
			{
				op: "set-criticality",
				instanceId: "inst-abc",
				roleName: "AUTO_ROLE",
				criticality: "low",
				setBy: "Z990001",
				setAt: new Date().toISOString(),
			},
			"Z990001",
		)

		const activity = await getReviewActivityByType(reviewId, "oracle_role_criticality")
		const staged = activity?.stagedData as { roles: Array<{ roleName: string; criticality: string | null }> }
		const role = staged?.roles.find((r) => r.roleName === "AUTO_ROLE")
		expect(role?.criticality).toBe("low")
	})

	it("patch on completed activity throws 409", async () => {
		const { appId, reviewId, activityId } = await createOracleReview()
		await insertOracleInstance(appId, "inst-abc")
		mockGetOracleRoles.mockResolvedValue({
			roles: [{ name: "DONE_ROLE", oracleMaintained: false, common: false }],
		})

		await seedOracleRoleCriticalityActivity(activityId, appId, "Z990001")
		await patchOracleRoleCriticalityActivity(
			activityId,
			{
				op: "set-criticality",
				instanceId: "inst-abc",
				roleName: "DONE_ROLE",
				criticality: "high",
				setBy: "Z990001",
				setAt: new Date().toISOString(),
			},
			"Z990001",
		)
		await completeReview(reviewId, "Z990001")

		await expect(
			patchOracleRoleCriticalityActivity(
				activityId,
				{
					op: "set-criticality",
					instanceId: "inst-abc",
					roleName: "DONE_ROLE",
					criticality: "low",
					setBy: "Z990001",
					setAt: new Date().toISOString(),
				},
				"Z990001",
			),
		).rejects.toSatisfy((e) => e instanceof Response && e.status === 409)
	})

	it("completes activity by committing staged_data to oracle_role_assessments", async () => {
		const { appId, reviewId, activityId } = await createOracleReview()
		await insertOracleInstance(appId, "inst-abc")
		await insertOracleRoleAssessment(appId, "inst-abc", "EXISTING_ROLE", "low")

		mockGetOracleRoles.mockResolvedValue({
			roles: [
				{ name: "EXISTING_ROLE", oracleMaintained: false, common: false },
				{ name: "NEW_ROLE", oracleMaintained: false, common: false },
			],
		})

		await seedOracleRoleCriticalityActivity(activityId, appId, "Z990001")
		await patchOracleRoleCriticalityActivity(
			activityId,
			{
				op: "set-criticality",
				instanceId: "inst-abc",
				roleName: "NEW_ROLE",
				criticality: "medium",
				setBy: "Z990001",
				setAt: new Date().toISOString(),
			},
			"Z990001",
		)
		await completeReview(reviewId, "Z990001")

		const db = getTestDb()
		const rows = await db.execute(
			/* sql */ `SELECT role_name, criticality FROM oracle_role_assessments
			WHERE application_id = '${appId}' AND archived_at IS NULL
			ORDER BY role_name`,
		)

		const roleMap = Object.fromEntries(
			(rows.rows as Array<{ role_name: string; criticality: string }>).map((r) => [r.role_name, r.criticality]),
		)
		expect(roleMap.EXISTING_ROLE).toBe("low")
		expect(roleMap.NEW_ROLE).toBe("medium")

		// snapshotAfter should be set
		const activity = await getReviewActivityByType(reviewId, "oracle_role_criticality")
		expect(activity?.snapshotAfter).toMatchObject({
			roles: expect.arrayContaining([expect.objectContaining({ roleName: "EXISTING_ROLE" })]),
		})
		expect(activity?.status).toBe("completed")
	})

	it("commit archives gone roles (soft-delete)", async () => {
		const { appId, reviewId, activityId } = await createOracleReview()
		await insertOracleInstance(appId, "inst-abc")
		await insertOracleRoleAssessment(appId, "inst-abc", "GONE_ROLE", "high")

		// API no longer returns GONE_ROLE
		mockGetOracleRoles.mockResolvedValue({ roles: [] })

		await seedOracleRoleCriticalityActivity(activityId, appId, "Z990001")
		await completeReview(reviewId, "Z990001")

		const db = getTestDb()
		const archivedRow = await db.execute(
			/* sql */ `SELECT archived_at, archived_by FROM oracle_role_assessments
			WHERE application_id = '${appId}' AND role_name = 'GONE_ROLE'`,
		)
		const row = archivedRow.rows[0] as { archived_at: string | null; archived_by: string | null }
		expect(row.archived_at).not.toBeNull()
		expect(row.archived_by).toBe("Z990001")
	})

	it("completeReview fails with 400 when active role lacks criticality", async () => {
		const { appId, reviewId, activityId } = await createOracleReview()
		await insertOracleInstance(appId, "inst-abc")

		mockGetOracleRoles.mockResolvedValue({
			roles: [{ name: "UNASSESSED_ROLE", oracleMaintained: false, common: false }],
		})

		await seedOracleRoleCriticalityActivity(activityId, appId, "Z990001")
		// Do NOT patch criticality — UNASSESSED_ROLE remains null

		await expect(completeReview(reviewId, "Z990001")).rejects.toSatisfy(
			(e) => e instanceof Response && e.status === 400,
		)
	})

	it("gone roles (isGone=true) do not block completion", async () => {
		const { appId, reviewId, activityId } = await createOracleReview()
		await insertOracleInstance(appId, "inst-abc")
		await insertOracleRoleAssessment(appId, "inst-abc", "GONE_ROLE", "high")

		// API returns nothing — GONE_ROLE is marked gone
		mockGetOracleRoles.mockResolvedValue({ roles: [] })

		await seedOracleRoleCriticalityActivity(activityId, appId, "Z990001")
		// GONE_ROLE has criticality from pre-existing assessment but isGone=true — should NOT block

		await expect(completeReview(reviewId, "Z990001")).resolves.not.toThrow()
	})

	it("double-commit is idempotent", async () => {
		const { appId, reviewId, activityId } = await createOracleReview()
		await insertOracleInstance(appId, "inst-abc")
		mockGetOracleRoles.mockResolvedValue({
			roles: [{ name: "ROLE_X", oracleMaintained: false, common: false }],
		})

		await seedOracleRoleCriticalityActivity(activityId, appId, "Z990001")
		await patchOracleRoleCriticalityActivity(
			activityId,
			{
				op: "set-criticality",
				instanceId: "inst-abc",
				roleName: "ROLE_X",
				criticality: "low",
				setBy: "Z990001",
				setAt: new Date().toISOString(),
			},
			"Z990001",
		)
		const first = await completeReview(reviewId, "Z990001")
		const second = await completeReview(reviewId, "Z990001")

		expect(second?.status).toBe("completed")
		expect(second?.id).toBe(first?.id)
	})
})
