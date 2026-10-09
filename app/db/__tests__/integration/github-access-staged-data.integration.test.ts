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

vi.mock("~/lib/nda-github-users.server", () => ({
	lookupGitHubUsers: vi.fn(async () => new Map()),
}))

const {
	autoCreateActivitiesForReview,
	completeReview,
	createReview,
	createRoutine,
	getReview,
	getReviewActivityByType,
} = await import("~/db/queries/routines.server")
const { patchGithubAccessActivity, seedGithubAccessActivity } = await import(
	"~/db/queries/github-access-activity.server"
)

async function createTestSection(name: string, slug: string) {
	const db = getTestDb()
	const result = await db.execute(
		/* sql */ `INSERT INTO sections (name, slug, created_by, updated_by) VALUES ('${name}', '${slug}', 'test', 'test') RETURNING id`,
	)
	return (result.rows[0] as { id: string }).id
}

async function createTestApp(name: string, gitRepository: string) {
	const db = getTestDb()
	const result = await db.execute(
		/* sql */ `INSERT INTO monitored_applications (name, git_repository, created_by, updated_by) VALUES ('${name}', '${gitRepository}', 'test', 'test') RETURNING id`,
	)
	return (result.rows[0] as { id: string }).id
}

async function markRoutineApproved(routineId: string) {
	const db = getTestDb()
	await db.execute(/* sql */ `UPDATE routines SET status = 'approved', updated_by = 'test' WHERE id = '${routineId}'`)
}

async function markSynced(applicationId: string, gitRepository: string) {
	const db = getTestDb()
	await db.execute(
		/* sql */ `INSERT INTO github_access_sync_status (application_id, git_repository, last_success_at, created_by, updated_by)
		VALUES ('${applicationId}', '${gitRepository}', now(), 'sync', 'sync')`,
	)
}

async function insertTeam(applicationId: string, teamSlug: string, teamName: string, permission: string) {
	const db = getTestDb()
	const result = await db.execute(
		/* sql */ `INSERT INTO github_repo_teams (application_id, team_slug, team_name, permission)
		VALUES ('${applicationId}', '${teamSlug}', '${teamName}', '${permission}') RETURNING id`,
	)
	return (result.rows[0] as { id: string }).id
}

async function insertTeamMember(repoTeamId: string, username: string, role = "member") {
	const db = getTestDb()
	await db.execute(
		/* sql */ `INSERT INTO github_repo_team_members (repo_team_id, username, role) VALUES ('${repoTeamId}', '${username}', '${role}')`,
	)
}

async function insertCollaborator(applicationId: string, username: string, permission: string) {
	const db = getTestDb()
	await db.execute(
		/* sql */ `INSERT INTO github_repo_collaborators (application_id, username, permission) VALUES ('${applicationId}', '${username}', '${permission}')`,
	)
}

async function createGithubAccessReview(gitRepository = "navikt/test-repo") {
	const sectionId = await createTestSection("Github-seksjon", "github-seksjon")
	const appId = await createTestApp("Github-app", gitRepository)
	const routine = await createRoutine({
		sectionId,
		name: "Github-rutine",
		description: null,
		frequency: "quarterly",
		activityTypes: ["github_access_maintenance"],
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
		title: "Github-gjennomgang",
		summary: null,
		routineSnapshotPath: null,
		reviewedAt: new Date(),
		createdBy: "Z990001",
		participants: [],
	})

	await autoCreateActivitiesForReview(review.id, routine.id, appId, "Z990001")
	const activity = await getReviewActivityByType(review.id, "github_access_maintenance")
	if (!activity) {
		throw new Error("Fant ikke Github-aktivitet")
	}

	return { appId, sectionId, reviewId: review.id, activityId: activity.id }
}

describe("Github-tilgang staged data integration tests", () => {
	beforeAll(async () => {
		await setupTestDatabase()
	}, 120_000)

	afterAll(async () => {
		await teardownTestDatabase()
	})

	beforeEach(async () => {
		const db = getTestDb()
		await db.execute(/* sql */ `
			DELETE FROM routine_review_follow_up_points;
			DELETE FROM routine_review_attachments;
			DELETE FROM routine_review_activities;
			DELETE FROM routine_review_participants;
			DELETE FROM routine_reviews;
			DELETE FROM routine_activity_links;
			DELETE FROM routines;
			DELETE FROM github_repo_team_members;
			DELETE FROM github_repo_teams;
			DELETE FROM github_repo_collaborators;
			DELETE FROM github_access_sync_status;
			DELETE FROM monitored_applications;
			DELETE FROM sections;
			DELETE FROM audit_log;
		`)
	})

	it("seeds staged data from synced teams, members and collaborators", async () => {
		const { appId, reviewId, activityId } = await createGithubAccessReview()
		await markSynced(appId, "navikt/test-repo")
		const teamId = await insertTeam(appId, "team-a", "Team A", "push")
		await insertTeamMember(teamId, "alice")
		await insertCollaborator(appId, "bob", "admin")

		const seeded = await seedGithubAccessActivity(activityId, "Z990001")
		expect(seeded.gitRepository).toBe("navikt/test-repo")
		expect(seeded.subjects.map((s) => s.username)).toEqual(expect.arrayContaining(["alice", "bob"]))

		const activity = await getReviewActivityByType(reviewId, "github_access_maintenance")
		expect(activity?.snapshotBefore).toMatchObject({
			subjects: expect.arrayContaining([expect.objectContaining({ username: "alice" })]),
		})
	})

	it("refuses to seed when the repo has not been synced yet", async () => {
		const { activityId } = await createGithubAccessReview()

		await expect(seedGithubAccessActivity(activityId, "Z990001")).rejects.toThrow()
	})

	it("patches staged data (mark/unmark for removal and adjustment) without touching sync tables", async () => {
		const { appId, reviewId, activityId } = await createGithubAccessReview()
		await markSynced(appId, "navikt/test-repo")
		const teamId = await insertTeam(appId, "team-a", "Team A", "push")
		await insertTeamMember(teamId, "alice")

		await seedGithubAccessActivity(activityId, "Z990001")
		await patchGithubAccessActivity(
			activityId,
			{ op: "mark-for-removal", username: "alice", markedBy: "reviewer", markedAt: "2025-02-01" },
			"reviewer",
		)

		let activity = await getReviewActivityByType(reviewId, "github_access_maintenance")
		expect(activity?.stagedData).toMatchObject({
			subjects: expect.arrayContaining([
				expect.objectContaining({ username: "alice", markedForRemoval: true, removalMarkedBy: "reviewer" }),
			]),
		})

		await patchGithubAccessActivity(activityId, { op: "unmark-for-removal", username: "alice" }, "reviewer")
		activity = await getReviewActivityByType(reviewId, "github_access_maintenance")
		expect(activity?.stagedData).toMatchObject({
			subjects: expect.arrayContaining([expect.objectContaining({ username: "alice", markedForRemoval: false })]),
		})

		const db = getTestDb()
		const teams = await db.execute(/* sql */ `SELECT id FROM github_repo_teams WHERE application_id = '${appId}'`)
		expect(teams.rows).toHaveLength(1)
	})

	it("commits staged data atomically: PDF attachment and follow-up points are created together", async () => {
		const { appId, reviewId, activityId } = await createGithubAccessReview()
		await markSynced(appId, "navikt/test-repo")
		const teamId = await insertTeam(appId, "team-a", "Team A", "push")
		await insertTeamMember(teamId, "alice")
		await insertCollaborator(appId, "bob", "maintain")

		await seedGithubAccessActivity(activityId, "Z990001")
		await patchGithubAccessActivity(
			activityId,
			{ op: "mark-for-removal", username: "alice", markedBy: "reviewer", markedAt: "2025-02-01" },
			"reviewer",
		)
		await patchGithubAccessActivity(
			activityId,
			{
				op: "mark-for-adjustment",
				username: "bob",
				targetPermission: "push",
				markedBy: "reviewer",
				markedAt: "2025-02-01",
			},
			"reviewer",
		)
		await patchGithubAccessActivity(
			activityId,
			{ op: "confirm-review", confirmedBy: "reviewer", confirmedAt: "2025-02-01T00:00:00.000Z" },
			"reviewer",
		)

		await completeReview(reviewId, "reviewer")

		const review = await getReview(reviewId)
		expect(review?.status).toBe("needs_follow_up")

		const activity = await getReviewActivityByType(reviewId, "github_access_maintenance")
		expect(activity?.status).toBe("completed")
		expect(activity?.snapshotAfter).toMatchObject({
			subjects: expect.arrayContaining([expect.objectContaining({ username: "alice", markedForRemoval: true })]),
		})

		const db = getTestDb()
		const attachments = await db.execute(
			/* sql */ `SELECT file_name, activity_step_id FROM routine_review_attachments WHERE review_id = '${reviewId}'`,
		)
		expect(attachments.rows).toHaveLength(1)
		expect((attachments.rows[0] as { activity_step_id: string | null }).activity_step_id).toBeNull()

		const followUpPoints = await db.execute(
			/* sql */ `SELECT text FROM routine_review_follow_up_points WHERE review_id = '${reviewId}' ORDER BY text`,
		)
		expect(followUpPoints.rows).toEqual([
			{ text: "Fjern GitHub-tilgang for @alice" },
			{ text: 'Juster GitHub-tilgang for @bob fra "maintain" til "push"' },
		])
	})

	it("re-seeding after completion returns the already-seeded staged data instead of throwing", async () => {
		const { appId, reviewId, activityId } = await createGithubAccessReview()
		await markSynced(appId, "navikt/test-repo")
		const teamId = await insertTeam(appId, "team-a", "Team A", "push")
		await insertTeamMember(teamId, "alice")

		const seeded = await seedGithubAccessActivity(activityId, "Z990001")
		await patchGithubAccessActivity(
			activityId,
			{ op: "confirm-review", confirmedBy: "reviewer", confirmedAt: "2025-02-01T00:00:00.000Z" },
			"reviewer",
		)
		await completeReview(reviewId, "reviewer")

		const activity = await getReviewActivityByType(reviewId, "github_access_maintenance")
		expect(activity?.status).toBe("completed")

		const reseeded = await seedGithubAccessActivity(activityId, "Z990001")
		expect(reseeded).toEqual({ ...seeded, confirmedBy: "reviewer", confirmedAt: "2025-02-01T00:00:00.000Z" })
	})

	it("rejects committing (via completeReview) when the review has not been confirmed", async () => {
		const { appId, reviewId, activityId } = await createGithubAccessReview()
		await markSynced(appId, "navikt/test-repo")
		const teamId = await insertTeam(appId, "team-a", "Team A", "push")
		await insertTeamMember(teamId, "alice")

		await seedGithubAccessActivity(activityId, "Z990001")
		await expect(completeReview(reviewId, "reviewer")).rejects.toThrow()

		const activity = await getReviewActivityByType(reviewId, "github_access_maintenance")
		expect(activity?.status).toBe("pending")

		const db = getTestDb()
		const attachments = await db.execute(
			/* sql */ `SELECT id FROM routine_review_attachments WHERE review_id = '${reviewId}'`,
		)
		expect(attachments.rows).toHaveLength(0)
	})
})
