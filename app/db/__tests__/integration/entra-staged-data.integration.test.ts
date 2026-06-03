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

vi.mock("~/lib/graph.server", () => ({
	resolveGroupNames: vi.fn(async (groupIds: string[]) =>
		Object.fromEntries(groupIds.map((groupId) => [groupId, `Navn ${groupId}`])),
	),
}))

const {
	autoCreateActivitiesForReview,
	completeReview,
	createReview,
	createRoutine,
	getReview,
	getReviewActivityByType,
	patchEntraActivity,
	seedEntraActivity,
} = await import("~/db/queries/routines.server")

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

async function insertAuthIntegration(applicationId: string, groups: string[], cluster = "prod-gcp") {
	const db = getTestDb()
	await db.execute(
		/* sql */ `INSERT INTO application_auth_integrations (application_id, type, cluster, groups) VALUES ('${applicationId}', 'entra_id', '${cluster}', '${JSON.stringify(groups)}')`,
	)
}

async function insertManualGroup(applicationId: string, groupId: string, groupName: string) {
	const db = getTestDb()
	const result = await db.execute(
		/* sql */ `INSERT INTO application_manual_groups (application_id, group_id, group_name, created_by) VALUES ('${applicationId}', '${groupId}', '${groupName}', 'seed') RETURNING id`,
	)
	return (result.rows[0] as { id: string }).id
}

async function insertGroupAssessment(applicationId: string, groupId: string, criticality: string, assessedBy = "seed") {
	const db = getTestDb()
	await db.execute(
		/* sql */ `INSERT INTO application_group_assessments (application_id, group_id, criticality, assessed_by, updated_by) VALUES ('${applicationId}', '${groupId}', '${criticality}', '${assessedBy}', '${assessedBy}')`,
	)
}

async function createEntraReview() {
	const sectionId = await createTestSection("Entra-seksjon", "entra-seksjon")
	const appId = await createTestApp("Entra-app")
	const routine = await createRoutine({
		sectionId,
		name: "Entra-rutine",
		description: null,
		frequency: "quarterly",
		activityTypes: ["entra_id_group_maintenance"],
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
		title: "Entra-gjennomgang",
		summary: null,
		routineSnapshotPath: null,
		reviewedAt: new Date(),
		createdBy: "Z990001",
		participants: [],
	})

	await autoCreateActivitiesForReview(review.id, routine.id, appId, "Z990001")
	const activity = await getReviewActivityByType(review.id, "entra_id_group_maintenance")
	if (!activity) {
		throw new Error("Fant ikke Entra-aktivitet")
	}

	return { appId, sectionId, reviewId: review.id, activityId: activity.id }
}

describe("Entra staged data integration tests", () => {
	beforeAll(async () => {
		await setupTestDatabase()
	}, 120_000)

	afterAll(async () => {
		await teardownTestDatabase()
	})

	beforeEach(async () => {
		const db = getTestDb()
		await db.execute(/* sql */ `
			DELETE FROM routine_review_activity_entra_changes;
			DELETE FROM routine_review_activities;
			DELETE FROM routine_review_participants;
			DELETE FROM routine_reviews;
			DELETE FROM routine_activity_links;
			DELETE FROM routines;
			DELETE FROM application_group_assessments;
			DELETE FROM application_manual_groups;
			DELETE FROM application_auth_integrations;
			DELETE FROM monitored_applications;
			DELETE FROM sections;
			DELETE FROM audit_log;
		`)
	})

	it("seeds staged data and snapshotBefore with nais, manual, overlap and ghost groups", async () => {
		const { appId, reviewId, activityId } = await createEntraReview()
		const overlapManualId = await insertManualGroup(appId, "group-overlap", "Overlap")
		const manualOnlyId = await insertManualGroup(appId, "group-manual", "Manual")
		await insertAuthIntegration(appId, ["group-nais", "group-overlap"])
		await insertGroupAssessment(appId, "group-overlap", "high")
		await insertGroupAssessment(appId, "group-ghost", "medium")

		const seeded = await seedEntraActivity(activityId, appId, "Z990001")
		expect(seeded.groups).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					groupId: "group-nais",
					source: "nais_auth",
					hasNaisSource: true,
					hasManualSource: false,
					isNewAssessment: true,
					criticality: null,
				}),
				expect.objectContaining({
					groupId: "group-overlap",
					source: "nais_auth",
					hasNaisSource: true,
					hasManualSource: true,
					seededManualGroupId: overlapManualId,
					criticality: "high",
				}),
				expect.objectContaining({
					groupId: "group-manual",
					source: "manual",
					hasNaisSource: false,
					hasManualSource: true,
					seededManualGroupId: manualOnlyId,
				}),
				expect.objectContaining({
					groupId: "group-ghost",
					source: "ghost",
					hasNaisSource: false,
					hasManualSource: false,
					criticality: "medium",
				}),
			]),
		)

		const activity = await getReviewActivityByType(reviewId, "entra_id_group_maintenance")
		expect(activity?.snapshotBefore).toMatchObject({
			groups: expect.arrayContaining([
				expect.objectContaining({ groupId: "group-overlap", hasManualSource: true }),
				expect.objectContaining({ groupId: "group-ghost", source: "ghost" }),
			]),
		})
	})

	it("filters out auth groups from excluded clusters when seeding", async () => {
		const { appId, sectionId, activityId } = await createEntraReview()
		const db = getTestDb()
		await db.execute(
			/* sql */ `INSERT INTO section_environments (section_id, cluster, included, added_by, updated_by)
			VALUES ('${sectionId}', 'dev-gcp', false, 'test', 'test')`,
		)
		await insertAuthIntegration(appId, ["group-prod"], "prod-gcp")
		await insertAuthIntegration(appId, ["group-dev"], "dev-gcp")

		const seeded = await seedEntraActivity(activityId, appId, "Z990001")

		expect(seeded.groups.map((group) => group.groupId)).toContain("group-prod")
		expect(seeded.groups.map((group) => group.groupId)).not.toContain("group-dev")
	})

	it("patches staged data without touching primary tables", async () => {
		const { appId, reviewId, activityId } = await createEntraReview()
		await insertAuthIntegration(appId, ["group-nais"])

		await seedEntraActivity(activityId, appId, "Z990001")
		await patchEntraActivity(
			activityId,
			{
				op: "set-criticality",
				groupId: "group-nais",
				criticality: "high",
				setBy: "reviewer",
				setAt: "2025-02-01T00:00:00.000Z",
			},
			"reviewer",
		)
		await patchEntraActivity(activityId, { op: "add-group", groupId: "group-new", groupName: "Ny gruppe" }, "reviewer")

		const db = getTestDb()
		const manualGroups = await db.execute(
			/* sql */ `SELECT group_id FROM application_manual_groups WHERE application_id = '${appId}' AND archived_at IS NULL`,
		)
		const assessments = await db.execute(
			/* sql */ `SELECT group_id, criticality FROM application_group_assessments WHERE application_id = '${appId}'`,
		)

		expect(manualGroups.rows).toHaveLength(0)
		expect(assessments.rows).toHaveLength(0)

		const activity = await getReviewActivityByType(reviewId, "entra_id_group_maintenance")
		expect(activity?.stagedData).toMatchObject({
			groups: expect.arrayContaining([
				expect.objectContaining({ groupId: "group-nais", criticality: "high" }),
				expect.objectContaining({ groupId: "group-new", isAddedDuringReview: true }),
			]),
		})
	})

	it("commits staged data on completeReview", async () => {
		const { appId, reviewId, activityId } = await createEntraReview()
		await insertAuthIntegration(appId, ["group-nais", "group-overlap"])
		await insertManualGroup(appId, "group-overlap", "Overlap")
		const manualOnlyId = await insertManualGroup(appId, "group-manual", "Manual")
		await insertGroupAssessment(appId, "group-overlap", "medium")

		await seedEntraActivity(activityId, appId, "Z990001")
		await patchEntraActivity(
			activityId,
			{
				op: "set-criticality",
				groupId: "group-nais",
				criticality: "high",
				setBy: "reviewer",
				setAt: "2025-02-01T00:00:00.000Z",
			},
			"reviewer",
		)
		await patchEntraActivity(
			activityId,
			{
				op: "add-group",
				groupId: "group-new",
				groupName: "Ny gruppe",
			},
			"reviewer",
		)
		await patchEntraActivity(
			activityId,
			{
				op: "set-criticality",
				groupId: "group-new",
				criticality: "low",
				setBy: "reviewer",
				setAt: "2025-02-01T00:05:00.000Z",
			},
			"reviewer",
		)
		await patchEntraActivity(activityId, { op: "remove-manual-source", groupId: "group-overlap" }, "reviewer")
		await patchEntraActivity(activityId, { op: "mark-gone", groupId: "group-manual" }, "reviewer")

		await completeReview(reviewId, "reviewer")

		const db = getTestDb()
		const activeManualGroups = await db.execute(
			/* sql */ `SELECT group_id FROM application_manual_groups WHERE application_id = '${appId}' AND archived_at IS NULL ORDER BY group_id`,
		)
		const archivedManualGroups = await db.execute(
			/* sql */ `SELECT group_id, archived_by FROM application_manual_groups WHERE application_id = '${appId}' AND archived_at IS NOT NULL ORDER BY group_id`,
		)
		const assessments = await db.execute(
			/* sql */ `SELECT group_id, criticality, assessed_by FROM application_group_assessments WHERE application_id = '${appId}' ORDER BY group_id`,
		)

		expect(activeManualGroups.rows).toEqual([{ group_id: "group-new" }])
		expect(archivedManualGroups.rows).toEqual(
			expect.arrayContaining([
				{ group_id: "group-manual", archived_by: "reviewer" },
				{ group_id: "group-overlap", archived_by: "reviewer" },
			]),
		)
		expect(assessments.rows).toEqual(
			expect.arrayContaining([
				{ group_id: "group-nais", criticality: "high", assessed_by: "reviewer" },
				{ group_id: "group-new", criticality: "low", assessed_by: "reviewer" },
				{ group_id: "group-overlap", criticality: "medium", assessed_by: "seed" },
			]),
		)

		const review = await getReview(reviewId)
		expect(review?.status).toBe("completed")

		const activity = await getReviewActivityByType(reviewId, "entra_id_group_maintenance")
		expect(activity?.status).toBe("completed")
		expect(activity?.stagedData).not.toBeNull()
		expect(activity?.snapshotAfter).toMatchObject({
			groups: expect.arrayContaining([
				expect.objectContaining({ groupId: "group-manual", isGone: true }),
				expect.objectContaining({ groupId: "group-overlap", hasManualSource: false, source: "nais_auth" }),
			]),
		})
		expect(manualOnlyId).toBeTruthy()
	})
})
