import { and, eq, isNull, sql } from "drizzle-orm"
import { getUserNamesByNavIdents } from "~/db/queries/users.server"
import { buildGithubAccessReviewPdf } from "~/lib/github-access-pdf.server"
import {
	applyGithubAccessStagedDataPatch,
	GITHUB_ACCESS_STAGED_DATA_ACTIVITY_TYPE,
	GITHUB_ACCESS_STAGED_DATA_SCHEMA_VERSION,
	type GithubAccessSnapshot,
	type GithubAccessStagedData,
	type GithubAccessStagedDataPatch,
	type GithubAccessSubject,
	isGithubAccessReviewComplete,
	parseGithubAccessStagedData,
	toGithubAccessSnapshot,
} from "~/lib/github-access-staged-data"
import { canonicalizeGitRepository } from "~/lib/github-access-sync.server"
import { computeGithubUserAccess } from "~/lib/github-user-access"
import { withAdvisoryLock } from "~/lib/lock.server"
import { logger } from "~/lib/logger.server"
import { type GitHubUserLookupResult, lookupGitHubUsers } from "~/lib/nda-github-users.server"
import { sanitizeFilename } from "~/lib/sanitize-filename"
import { getStorageProvider } from "~/lib/storage/index.server"
import { db } from "../connection.server"
import {
	routineReviewActivities,
	routineReviewAttachments,
	routineReviewParticipants,
	routineReviews,
	routines,
} from "../schema/routines"
import type { DbExecutor } from "./audit.server"
import { writeAuditLog } from "./audit.server"

export async function buildGithubAccessSeedResult(
	applicationId: string,
	executor: DbExecutor = db,
): Promise<GithubAccessStagedData> {
	const seedInputs = await executor.execute(sql`
WITH repo AS (
  SELECT COALESCE(
      NULLIF(trim(ma.git_repository), ''),
      (
        SELECT trim(ae.git_repository)
        FROM application_environments ae
        WHERE ae.application_id = ma.id
          AND ae.archived_at IS NULL
          AND ae.git_repository IS NOT NULL
          AND trim(ae.git_repository) != ''
        ORDER BY ae.discovered_at ASC
        LIMIT 1
      )
    ) AS "gitRepository"
   FROM monitored_applications ma WHERE ma.id = ${applicationId}
)
SELECT
  (SELECT "gitRepository" FROM repo) AS "gitRepository",
  (SELECT s.last_success_at FROM github_access_sync_status s WHERE s.application_id = ${applicationId}) AS "lastSuccessfulSyncAt",
  (SELECT s.git_repository FROM github_access_sync_status s WHERE s.application_id = ${applicationId}) AS "syncedGitRepository",
  (SELECT COALESCE(json_agg(json_build_object(
      'id', t.id, 'teamSlug', t.team_slug, 'teamName', t.team_name,
      'permission', t.permission, 'syncedAt', t.synced_at
    )), '[]'::json)
   FROM github_repo_teams t WHERE t.application_id = ${applicationId}) AS teams,
  (SELECT COALESCE(json_agg(json_build_object(
      'repoTeamId', tm.repo_team_id, 'username', tm.username, 'role', tm.role, 'syncedAt', tm.synced_at
    )), '[]'::json)
   FROM github_repo_team_members tm
   JOIN github_repo_teams t2 ON tm.repo_team_id = t2.id
   WHERE t2.application_id = ${applicationId}) AS members,
  (SELECT COALESCE(json_agg(json_build_object(
      'username', c.username, 'permission', c.permission, 'syncedAt', c.synced_at
    )), '[]'::json)
   FROM github_repo_collaborators c WHERE c.application_id = ${applicationId}) AS collaborators
`)

	const seedRow = seedInputs.rows[0] as {
		gitRepository: string | null
		lastSuccessfulSyncAt: string | null
		syncedGitRepository: string | null
		teams: Array<{ id: string; teamSlug: string; teamName: string; permission: string; syncedAt: string }>
		members: Array<{ repoTeamId: string; username: string; role: string; syncedAt: string }>
		collaborators: Array<{ username: string; permission: string; syncedAt: string }>
	}

	const rawGitRepository = seedRow.gitRepository?.trim() || null
	if (!rawGitRepository) {
		throw new Response("Applikasjonen mangler et konfigurert GitHub-repo", { status: 400 })
	}

	let gitRepository: string
	try {
		gitRepository = canonicalizeGitRepository(rawGitRepository)
	} catch {
		throw new Response("Applikasjonen har et ugyldig konfigurert GitHub-repo", { status: 400 })
	}

	const syncedGitRepository = (() => {
		const raw = seedRow.syncedGitRepository?.trim()
		if (!raw) return null
		try {
			return canonicalizeGitRepository(raw)
		} catch {
			return null
		}
	})()

	if (!seedRow.lastSuccessfulSyncAt || syncedGitRepository !== gitRepository) {
		throw new Response(
			"Dette repoet har ikke blitt synkronisert mot GitHub ennå. Vent til neste synkronisering er fullført før gjennomgangen kan startes.",
			{ status: 400 },
		)
	}

	const syncFreshnessWindowMs = 2 * 24 * 60 * 60 * 1000
	if (Date.now() - new Date(seedRow.lastSuccessfulSyncAt).getTime() > syncFreshnessWindowMs) {
		throw new Response(
			"Siste vellykkede synkronisering mot GitHub er for gammel til å starte en gjennomgang. Sjekk at synk-jobben kjører som normalt.",
			{ status: 400 },
		)
	}

	const membersByRepoTeamId = new Map<string, Array<{ username: string; role: string; syncedAt: string }>>()
	for (const member of seedRow.members) {
		const list = membersByRepoTeamId.get(member.repoTeamId) ?? []
		list.push(member)
		membersByRepoTeamId.set(member.repoTeamId, list)
	}
	const teamMemberRows = seedRow.teams.flatMap((team) => {
		const members = membersByRepoTeamId.get(team.id) ?? [null]
		return members.map((member) => ({
			teamId: team.id,
			teamSlug: team.teamSlug,
			teamName: team.teamName,
			permission: team.permission,
			syncedAt: new Date(team.syncedAt),
			memberUsername: member?.username ?? null,
			memberRole: member?.role ?? null,
			memberSyncedAt: member ? new Date(member.syncedAt) : null,
		}))
	})
	const collaboratorRows = seedRow.collaborators.map((c) => ({
		username: c.username,
		permission: c.permission,
		syncedAt: new Date(c.syncedAt),
	}))

	const teamsById = new Map<string, { teamSlug: string; teamName: string; permission: string; syncedAt: Date }>()
	const membersByTeamId = new Map<string, Array<{ username: string; role: string }>>()
	const memberSyncedTimestamps: Date[] = []
	for (const row of teamMemberRows) {
		if (!teamsById.has(row.teamId)) {
			teamsById.set(row.teamId, {
				teamSlug: row.teamSlug,
				teamName: row.teamName,
				permission: row.permission,
				syncedAt: row.syncedAt,
			})
		}
		if (row.memberUsername) {
			const list = membersByTeamId.get(row.teamId) ?? []
			list.push({ username: row.memberUsername, role: row.memberRole ?? "member" })
			membersByTeamId.set(row.teamId, list)
			if (row.memberSyncedAt) memberSyncedTimestamps.push(row.memberSyncedAt)
		}
	}

	const teamsWithMembers = Array.from(teamsById.entries()).map(([teamId, team]) => ({
		teamSlug: team.teamSlug,
		teamName: team.teamName,
		permission: team.permission,
		members: membersByTeamId.get(teamId) ?? [],
	}))

	const userAccess = computeGithubUserAccess(
		teamsWithMembers,
		collaboratorRows.map((c) => ({ username: c.username, permission: c.permission })),
	)

	const seededAt = new Date().toISOString()

	const syncedTimestamps: Date[] = [
		...Array.from(teamsById.values()).map((t) => t.syncedAt),
		...memberSyncedTimestamps,
		...collaboratorRows.map((c) => c.syncedAt),
	]
	const dataSyncedAt =
		syncedTimestamps.length > 0
			? new Date(Math.max(...syncedTimestamps.map((d) => d.getTime()))).toISOString()
			: seedRow.lastSuccessfulSyncAt
				? new Date(seedRow.lastSuccessfulSyncAt).toISOString()
				: null

	const subjects: GithubAccessSubject[] = userAccess
		.map((u) => ({
			username: u.username,
			highestPermission: u.highestPermission,
			directPermission: u.directPermission,
			viaTeams: u.viaTeams,
			markedForRemoval: false,
			removalMarkedBy: null,
			removalMarkedAt: null,
			permissionAdjustmentRequested: false,
			targetPermission: null,
			permissionAdjustmentMarkedBy: null,
			permissionAdjustmentMarkedAt: null,
		}))
		.sort((a, b) => a.username.localeCompare(b.username, "nb"))

	const stagedData: GithubAccessStagedData = {
		activityType: GITHUB_ACCESS_STAGED_DATA_ACTIVITY_TYPE,
		schemaVersion: GITHUB_ACCESS_STAGED_DATA_SCHEMA_VERSION,
		seededAt,
		dataSyncedAt,
		gitRepository,
		subjects,
		confirmedBy: null,
		confirmedAt: null,
	}

	return stagedData
}

async function ensureGithubAccessStagedData(
	tx: DbExecutor,
	activityId: string,
	applicationId: string,
	performedBy: string,
): Promise<GithubAccessStagedData> {
	const seeded = await buildGithubAccessSeedResult(applicationId, tx)
	const [updated] = await tx
		.update(routineReviewActivities)
		.set({
			stagedData: seeded,
			snapshotBefore: sql`COALESCE(${routineReviewActivities.snapshotBefore}, ${JSON.stringify(toGithubAccessSnapshot(seeded))}::jsonb)`,
		})
		.where(and(eq(routineReviewActivities.id, activityId), isNull(routineReviewActivities.stagedData)))
		.returning({ stagedData: routineReviewActivities.stagedData })

	if (updated?.stagedData) {
		await writeAuditLog(
			{ action: "review_activity_seeded", entityType: "routine_review_activity", entityId: activityId, performedBy },
			tx,
		)
		return parseGithubAccessStagedData(updated.stagedData)
	}

	const [current] = await tx
		.select({ stagedData: routineReviewActivities.stagedData })
		.from(routineReviewActivities)
		.where(eq(routineReviewActivities.id, activityId))
		.limit(1)
	if (!current?.stagedData) throw new Error(`Kunne ikke seed'e Github-aktivitet ${activityId}`)
	return parseGithubAccessStagedData(current.stagedData)
}

export async function seedGithubAccessActivity(
	activityId: string,
	performedBy: string,
): Promise<GithubAccessStagedData> {
	const [precheck] = await db
		.select({
			type: routineReviewActivities.type,
			status: routineReviewActivities.status,
			stagedData: routineReviewActivities.stagedData,
			applicationId: routineReviews.applicationId,
			reviewStatus: routineReviews.status,
		})
		.from(routineReviewActivities)
		.innerJoin(routineReviews, eq(routineReviewActivities.reviewId, routineReviews.id))
		.where(eq(routineReviewActivities.id, activityId))
		.limit(1)

	if (!precheck) throw new Error(`Fant ikke review-aktivitet ${activityId}`)
	if (precheck.type !== "github_access_maintenance") {
		throw new Error(`Aktivitet ${activityId} er ikke GitHub-tilgangsgjennomgang`)
	}
	if (precheck.stagedData) return parseGithubAccessStagedData(precheck.stagedData)
	if (!precheck.applicationId) throw new Response("GitHub-aktiviteten mangler applikasjon", { status: 400 })
	if (precheck.status !== "pending") throw new Response("Kan ikke seed'e en fullført aktivitet", { status: 409 })
	if (precheck.reviewStatus !== "draft") {
		throw new Response("Gjennomgangen er ikke lenger redigerbar.", { status: 409 })
	}

	const applicationId = precheck.applicationId
	const lockName = `github_access_maintenance-activity-${activityId}`
	const lockResult = await withAdvisoryLock(lockName, async () => {
		return db.transaction(async (tx) => {
			const [current] = await tx
				.select({
					status: routineReviewActivities.status,
					stagedData: routineReviewActivities.stagedData,
					reviewId: routineReviewActivities.reviewId,
				})
				.from(routineReviewActivities)
				.where(eq(routineReviewActivities.id, activityId))
				.for("update")
				.limit(1)

			if (!current) throw new Error(`Fant ikke review-aktivitet ${activityId}`)
			if (current.stagedData) return parseGithubAccessStagedData(current.stagedData)
			if (current.status !== "pending") throw new Response("Kan ikke seed'e en fullført aktivitet", { status: 409 })

			const [review] = await tx
				.select({ status: routineReviews.status })
				.from(routineReviews)
				.where(eq(routineReviews.id, current.reviewId))
				.for("update")
				.limit(1)
			if (!review || review.status !== "draft") {
				throw new Response("Gjennomgangen er ikke lenger redigerbar.", { status: 409 })
			}

			return ensureGithubAccessStagedData(tx, activityId, applicationId, performedBy)
		})
	})

	if (lockResult !== null) return lockResult
	throw new Response("Gjennomgangen er låst av en annen operasjon. Prøv igjen.", { status: 409 })
}

export async function patchGithubAccessActivity(
	activityId: string,
	patch: GithubAccessStagedDataPatch,
	performedBy: string,
): Promise<void> {
	const [precheck] = await db
		.select({
			type: routineReviewActivities.type,
			status: routineReviewActivities.status,
			stagedData: routineReviewActivities.stagedData,
			applicationId: routineReviews.applicationId,
			reviewStatus: routineReviews.status,
			routineArchivedAt: routines.archivedAt,
		})
		.from(routineReviewActivities)
		.innerJoin(routineReviews, eq(routineReviewActivities.reviewId, routineReviews.id))
		.innerJoin(routines, eq(routineReviews.routineId, routines.id))
		.where(eq(routineReviewActivities.id, activityId))
		.limit(1)

	if (!precheck) throw new Error(`Fant ikke review-aktivitet ${activityId}`)
	if (precheck.type !== "github_access_maintenance") {
		throw new Error(`Aktivitet ${activityId} er ikke GitHub-tilgangsgjennomgang`)
	}
	if (precheck.routineArchivedAt) {
		throw new Response("Kan ikke endre vurderinger på en arkivert rutine.", { status: 403 })
	}
	if (precheck.reviewStatus !== "draft") throw new Response("Gjennomgangen er ikke lenger redigerbar.", { status: 409 })
	if (precheck.status !== "pending") throw new Response("Kan ikke endre en fullført aktivitet", { status: 409 })

	const applicationId = precheck.applicationId

	const lockName = `github_access_maintenance-activity-${activityId}`
	const lockResult = await withAdvisoryLock(lockName, async () => {
		return db.transaction(async (tx) => {
			const [activity] = await tx
				.select({
					status: routineReviewActivities.status,
					stagedData: routineReviewActivities.stagedData,
					reviewId: routineReviewActivities.reviewId,
				})
				.from(routineReviewActivities)
				.where(eq(routineReviewActivities.id, activityId))
				.for("update")
				.limit(1)

			if (!activity) throw new Error(`Fant ikke review-aktivitet ${activityId}`)
			if (activity.status !== "pending") throw new Response("Kan ikke endre en fullført aktivitet", { status: 409 })

			const [review] = await tx
				.select({ status: routineReviews.status, routineArchivedAt: routines.archivedAt })
				.from(routineReviews)
				.innerJoin(routines, eq(routineReviews.routineId, routines.id))
				.where(eq(routineReviews.id, activity.reviewId))
				.for("update")
				.limit(1)
			if (!review || review.status !== "draft") {
				throw new Response("Gjennomgangen er ikke lenger redigerbar.", { status: 409 })
			}
			if (review.routineArchivedAt) {
				throw new Response("Kan ikke endre vurderinger på en arkivert rutine.", { status: 403 })
			}

			let stagedData = activity.stagedData ? parseGithubAccessStagedData(activity.stagedData) : null
			if (!stagedData) {
				if (!applicationId) throw new Response("GitHub-aktiviteten mangler applikasjon", { status: 400 })
				stagedData = await ensureGithubAccessStagedData(tx, activityId, applicationId, performedBy)
			}

			let updatedData: GithubAccessStagedData
			try {
				updatedData = applyGithubAccessStagedDataPatch(stagedData, patch)
			} catch (e) {
				throw new Response(e instanceof Error ? e.message : "Ugyldig patch-operasjon", { status: 400 })
			}
			const hasChanged = JSON.stringify(stagedData) !== JSON.stringify(updatedData)

			if (hasChanged) {
				const [updated] = await tx
					.update(routineReviewActivities)
					.set({ stagedData: updatedData })
					.where(and(eq(routineReviewActivities.id, activityId), eq(routineReviewActivities.status, "pending")))
					.returning({ id: routineReviewActivities.id })
				if (!updated) {
					throw new Response("Kan ikke endre en fullført aktivitet", { status: 409 })
				}
			}
		})
	})

	if (lockResult === null) {
		throw new Response("Gjennomgangen er låst av en annen operasjon. Prøv igjen.", { status: 409 })
	}
}

const REMOVAL_FOLLOW_UP_GUIDANCE =
	"Fjern GitHub-tilgangen for brukeren snarest mulig. Vurder om tilgangen kan ha blitt utnyttet i perioden der " +
	"det ikke lenger forelå tjenstlig behov, og dokumenter en eventuell risikovurdering som vedlegg til " +
	"gjennomgangen."

export async function commitGithubAccessActivity(
	activityId: string,
	reviewId: string,
	performedBy: string,
	executor: DbExecutor,
	onUploaded?: (path: string) => void,
	prefetchedGithubUserLookups?: Map<string, GitHubUserLookupResult>,
): Promise<GithubAccessSnapshot> {
	const [activity] = await executor
		.select({
			id: routineReviewActivities.id,
			reviewId: routineReviewActivities.reviewId,
			status: routineReviewActivities.status,
			stagedData: routineReviewActivities.stagedData,
			applicationId: routineReviews.applicationId,
			reviewStatus: routineReviews.status,
		})
		.from(routineReviewActivities)
		.innerJoin(routineReviews, eq(routineReviewActivities.reviewId, routineReviews.id))
		.where(eq(routineReviewActivities.id, activityId))
		.for("update")
		.limit(1)

	if (!activity) throw new Error(`Fant ikke review-aktivitet ${activityId}`)
	if (activity.reviewId !== reviewId) {
		throw new Response(`reviewId mismatch: forventet ${activity.reviewId}, fikk ${reviewId}`, { status: 400 })
	}
	if (activity.status !== "pending") throw new Response("Aktiviteten er allerede fullført", { status: 409 })
	if (activity.reviewStatus !== "draft") {
		throw new Response("Gjennomgangen er ikke lenger redigerbar.", { status: 409 })
	}
	if (!activity.applicationId) throw new Response("GitHub-aktiviteten mangler applikasjon", { status: 400 })

	const stagedData = activity.stagedData
		? parseGithubAccessStagedData(activity.stagedData)
		: await ensureGithubAccessStagedData(executor, activityId, activity.applicationId, performedBy)

	if (!isGithubAccessReviewComplete(stagedData)) {
		throw new Response("Gjennomgangen må bekreftes før aktiviteten kan fullføres.", { status: 400 })
	}

	const participantRows = await executor
		.select({
			userIdent: routineReviewParticipants.userIdent,
			userName: routineReviewParticipants.userName,
			confirmedAt: routineReviewParticipants.confirmedAt,
		})
		.from(routineReviewParticipants)
		.where(and(eq(routineReviewParticipants.reviewId, reviewId), isNull(routineReviewParticipants.archivedAt)))

	let githubUserLookups = prefetchedGithubUserLookups ?? new Map<string, GitHubUserLookupResult>()
	if (!prefetchedGithubUserLookups) {
		try {
			githubUserLookups = await lookupGitHubUsers(stagedData.subjects.map((s) => s.username))
		} catch (error) {
			logger.warn("Kunne ikke hente visningsnavn for GitHub-brukere fra NDA til PDF-en", error)
		}
	}

	const reviewerNavIdents = new Set<string>([performedBy])
	for (const s of stagedData.subjects) {
		if (s.removalMarkedBy) reviewerNavIdents.add(s.removalMarkedBy)
		if (s.permissionAdjustmentMarkedBy) reviewerNavIdents.add(s.permissionAdjustmentMarkedBy)
	}
	if (stagedData.confirmedBy) reviewerNavIdents.add(stagedData.confirmedBy)
	const nameByNavIdent = await getUserNamesByNavIdents(Array.from(reviewerNavIdents), executor)

	const storage = getStorageProvider()
	const pdfBuffer = await buildGithubAccessReviewPdf(stagedData, {
		performedBy,
		participants: participantRows,
		githubUserLookups,
		nameByNavIdent,
	})
	const safeRepo = sanitizeFilename(stagedData.gitRepository.replace(/[/\\]/g, "-"), 60)
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
	const bucketPath = `github-access-review/${activityId}/${timestamp}-${safeRepo}.pdf`
	const uploadResult = await storage.upload(bucketPath, pdfBuffer, { contentType: "application/pdf" })
	onUploaded?.(uploadResult.path)

	try {
		const [attachment] = await executor
			.insert(routineReviewAttachments)
			.values({
				reviewId,
				activityStepId: null,
				fileName: `github-tilgangsgjennomgang-${safeRepo}.pdf`,
				bucketPath: uploadResult.path,
				contentType: uploadResult.contentType,
				sizeBytes: uploadResult.sizeBytes,
				sourceType: "automated",
				uploadedBy: performedBy,
			})
			.returning()

		await writeAuditLog(
			{
				action: "routine_attachment_uploaded",
				entityType: "routine_review_attachment",
				entityId: attachment.id,
				newValue: attachment.fileName,
				metadata: { reviewId, activityId, sourceType: "automated" },
				performedBy,
			},
			executor,
		)
	} catch (err) {
		await storage.delete(uploadResult.path).catch(() => {})
		throw err
	}

	const { addFollowUpPointRow } = await import("./routines.server")
	for (const subject of stagedData.subjects) {
		if (subject.markedForRemoval) {
			await addFollowUpPointRow(executor, {
				reviewId,
				text: `Fjern GitHub-tilgang for @${subject.username}`,
				description: REMOVAL_FOLLOW_UP_GUIDANCE,
				performedBy,
			})
		}
		if (subject.permissionAdjustmentRequested) {
			await addFollowUpPointRow(executor, {
				reviewId,
				text: `Juster GitHub-tilgang for @${subject.username} fra "${subject.highestPermission}" til "${subject.targetPermission}"`,
				description: `Juster GitHub-tilgangsnivået for @${subject.username} fra "${subject.highestPermission}" til "${subject.targetPermission}" i repoet. KISS bekrefter ikke endringen mot GitHub — merk punktet som fullført når justeringen er gjennomført.`,
				performedBy,
			})
		}
	}

	return toGithubAccessSnapshot(stagedData)
}
