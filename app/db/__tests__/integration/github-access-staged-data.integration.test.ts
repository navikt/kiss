import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { getStorageProvider } from "~/lib/storage/index.server"
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
			DELETE FROM routine_review_follow_up_point_links;
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

		const db = getTestDb()
		const followUpPointsBeforeComplete = await db.execute(
			/* sql */ `SELECT text FROM routine_review_follow_up_points WHERE review_id = '${reviewId}' ORDER BY text`,
		)
		expect(followUpPointsBeforeComplete.rows).toEqual([
			{ text: "Fjern GitHub-tilgang for @alice" },
			{ text: 'Juster GitHub-tilgang for @bob fra "maintain" til "push"' },
		])

		await completeReview(reviewId, "reviewer")

		const review = await getReview(reviewId)
		expect(review?.status).toBe("needs_follow_up")

		const activity = await getReviewActivityByType(reviewId, "github_access_maintenance")
		expect(activity?.status).toBe("completed")
		expect(activity?.snapshotAfter).toMatchObject({
			subjects: expect.arrayContaining([expect.objectContaining({ username: "alice", markedForRemoval: true })]),
		})

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

	it("rolls back completion writes and deletes the uploaded PDF when the review update fails", async () => {
		const { appId, reviewId, activityId } = await createGithubAccessReview()
		await markSynced(appId, "navikt/test-repo")
		await insertCollaborator(appId, "glad-fjord", "admin")
		await seedGithubAccessActivity(activityId, "Z990001")
		await patchGithubAccessActivity(
			activityId,
			{ op: "mark-for-removal", username: "glad-fjord", markedBy: "Z990001", markedAt: "2025-02-01" },
			"Z990001",
		)
		await patchGithubAccessActivity(
			activityId,
			{ op: "confirm-review", confirmedBy: "Z990001", confirmedAt: "2025-02-01T00:00:00.000Z" },
			"Z990001",
		)

		const db = getTestDb()
		const reviewBefore = await getReview(reviewId)
		const activityBefore = await getReviewActivityByType(reviewId, "github_access_maintenance")
		const auditBefore = await db.execute(/* sql */ "SELECT * FROM audit_log ORDER BY id")
		await db.execute(/* sql */ `
			CREATE FUNCTION fail_github_review_completion() RETURNS trigger AS $$
			BEGIN
				RAISE EXCEPTION 'Forced failure after GitHub PDF upload';
			END;
			$$ LANGUAGE plpgsql;
			CREATE TRIGGER fail_github_review_completion
			BEFORE UPDATE ON routine_reviews
			FOR EACH ROW WHEN (OLD.id = '${reviewId}'::uuid)
			EXECUTE FUNCTION fail_github_review_completion();
		`)

		const storage = getStorageProvider()
		const uploadedPath = `github-access-review/${activityId}/rollback-test.pdf`
		const upload = vi.spyOn(storage, "upload").mockResolvedValue({
			path: uploadedPath,
			contentType: "application/pdf",
			sizeBytes: 123,
		})
		const deleteFile = vi.spyOn(storage, "delete").mockResolvedValue()
		try {
			await expect(completeReview(reviewId, "Z990001")).rejects.toMatchObject({
				cause: { message: "Forced failure after GitHub PDF upload" },
			})

			expect(upload).toHaveBeenCalledExactlyOnceWith(
				expect.stringContaining(`github-access-review/${activityId}/`),
				expect.any(Buffer),
				{ contentType: "application/pdf" },
			)
			expect(deleteFile).toHaveBeenCalledExactlyOnceWith(uploadedPath)
			expect(await getReview(reviewId)).toEqual(reviewBefore)
			expect(await getReviewActivityByType(reviewId, "github_access_maintenance")).toEqual(activityBefore)
			const attachments = await db.execute(
				/* sql */ `SELECT id FROM routine_review_attachments WHERE review_id = '${reviewId}'`,
			)
			expect(attachments.rows).toEqual([])
			const auditAfter = await db.execute(/* sql */ "SELECT * FROM audit_log ORDER BY id")
			expect(auditAfter.rows).toEqual(auditBefore.rows)
		} finally {
			upload.mockRestore()
			deleteFile.mockRestore()
			await db.execute(/* sql */ `
				DROP TRIGGER fail_github_review_completion ON routine_reviews;
				DROP FUNCTION fail_github_review_completion();
			`)
		}
	})

	it("marks GitHub-generated follow-up points as not relevant when markering is reverted after confirmation", async () => {
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
		await patchGithubAccessActivity(
			activityId,
			{ op: "confirm-review", confirmedBy: "reviewer", confirmedAt: "2025-02-01T00:00:00.000Z" },
			"reviewer",
		)

		const db = getTestDb()
		const pointsAfterConfirm = await db.execute(
			/* sql */ `SELECT text FROM routine_review_follow_up_points WHERE review_id = '${reviewId}'`,
		)
		expect(pointsAfterConfirm.rows).toEqual([{ text: "Fjern GitHub-tilgang for @alice" }])

		await patchGithubAccessActivity(activityId, { op: "unmark-for-removal", username: "alice" }, "reviewer")
		const pointsAfterUnmark = await db.execute(
			/* sql */ `SELECT text, status FROM routine_review_follow_up_points WHERE review_id = '${reviewId}'`,
		)
		expect(pointsAfterUnmark.rows).toEqual([{ text: "Fjern GitHub-tilgang for @alice", status: "not_relevant" }])
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

	it("reconciles changed decisions without overwriting manual work on unchanged linked points", async () => {
		const { appId, reviewId, activityId } = await createGithubAccessReview()
		await markSynced(appId, "navikt/test-repo")
		await insertCollaborator(appId, "glad-fjord", "admin")
		await insertCollaborator(appId, "rask-elv", "admin")
		await seedGithubAccessActivity(activityId, "Z990001")
		const confirm = () =>
			patchGithubAccessActivity(
				activityId,
				{ op: "confirm-review", confirmedBy: "Z990042", confirmedAt: new Date().toISOString() },
				"Z990042",
			)
		const markRemoval = () =>
			patchGithubAccessActivity(
				activityId,
				{ op: "mark-for-removal", username: "glad-fjord", markedBy: "Z990001", markedAt: "2025-02-01" },
				"Z990001",
			)
		const markAdjustment = (targetPermission: "push" | "pull") =>
			patchGithubAccessActivity(
				activityId,
				{
					op: "mark-for-adjustment",
					username: "rask-elv",
					targetPermission,
					markedBy: "Z990001",
					markedAt: "2025-02-01",
				},
				"Z990001",
			)
		const db = getTestDb()
		const points = async () =>
			(
				await db.execute(
					/* sql */ `SELECT p.*, l.subject_username FROM routine_review_follow_up_points p
					JOIN routine_review_follow_up_point_links l ON l.point_id = p.id
					WHERE p.review_id = '${reviewId}' ORDER BY l.subject_username`,
				)
			).rows
		await markRemoval()
		await markAdjustment("push")
		expect(await points()).toHaveLength(0)
		await confirm()
		await db.execute(
			/* sql */ `UPDATE routine_review_follow_up_points
			SET text = 'Avtalt tiltak', description = 'Egen beskrivelse', status = 'completed',
				resolution = 'Gjennomført', resolved_at = now(), resolved_by = 'Z990001'
			WHERE review_id = '${reviewId}'`,
		)
		const manuallyResolved = await points()
		expect(manuallyResolved).toHaveLength(2)
		await patchGithubAccessActivity(activityId, { op: "unconfirm-review" }, "Z990042")
		expect(await points()).toEqual(manuallyResolved)
		await confirm()
		expect(await points()).toEqual(manuallyResolved)

		await patchGithubAccessActivity(activityId, { op: "unmark-for-removal", username: "glad-fjord" }, "Z990042")
		const afterUndo = await points()
		expect(afterUndo[0]).toMatchObject({ id: manuallyResolved[0].id, status: "not_relevant" })
		expect(afterUndo[1]).toEqual(manuallyResolved[1])
		await markRemoval()
		const afterReactivation = await points()
		expect(afterReactivation[0]).toMatchObject({
			id: manuallyResolved[0].id,
			status: "needs_follow_up",
			resolution: null,
			resolved_at: null,
			resolved_by: null,
		})
		expect(afterReactivation[1]).toEqual(manuallyResolved[1])
		await markAdjustment("pull")
		const afterTargetChange = await points()
		expect(afterTargetChange[0]).toEqual(afterReactivation[0])
		expect(afterTargetChange[1]).toMatchObject({
			id: manuallyResolved[1].id,
			status: "needs_follow_up",
			resolution: null,
			text: 'Juster GitHub-tilgang for @rask-elv fra "admin" til "pull"',
		})
		await confirm()
		expect(await points()).toEqual(afterTargetChange)
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
