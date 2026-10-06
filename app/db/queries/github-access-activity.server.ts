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
import { computeGithubUserAccess, normalizeGithubUsername } from "~/lib/github-user-access"
import { withAdvisoryLock } from "~/lib/lock.server"
import { logger } from "~/lib/logger.server"
import { type GitHubUserLookupResult, lookupGitHubUsers } from "~/lib/nda-github-users.server"
import { sanitizeFilename } from "~/lib/sanitize-filename"
import { getStorageProvider } from "~/lib/storage/index.server"
import { db } from "../connection.server"
import { monitoredApplications } from "../schema/applications"
import {
	githubAccessAssessments,
	githubRepoCollaborators,
	githubRepoTeamMembers,
	githubRepoTeams,
} from "../schema/github-access"
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
): Promise<{ stagedData: GithubAccessStagedData; snapshot: GithubAccessSnapshot }> {
	const [app] = await executor
		.select({ gitRepository: monitoredApplications.gitRepository })
		.from(monitoredApplications)
		.where(eq(monitoredApplications.id, applicationId))
		.limit(1)
	if (!app?.gitRepository) {
		throw new Response("Applikasjonen mangler et konfigurert Github-repo", { status: 400 })
	}

	const [teamMemberRows, collaboratorRows, assessmentRows] = await Promise.all([
		executor
			.select({
				teamId: githubRepoTeams.id,
				teamSlug: githubRepoTeams.teamSlug,
				teamName: githubRepoTeams.teamName,
				permission: githubRepoTeams.permission,
				syncedAt: githubRepoTeams.syncedAt,
				memberUsername: githubRepoTeamMembers.username,
				memberRole: githubRepoTeamMembers.role,
				memberSyncedAt: githubRepoTeamMembers.syncedAt,
			})
			.from(githubRepoTeams)
			.leftJoin(githubRepoTeamMembers, eq(githubRepoTeamMembers.repoTeamId, githubRepoTeams.id))
			.where(eq(githubRepoTeams.applicationId, applicationId)),
		executor.select().from(githubRepoCollaborators).where(eq(githubRepoCollaborators.applicationId, applicationId)),
		executor
			.select({
				username: githubAccessAssessments.username,
				lastKnownPermission: githubAccessAssessments.lastKnownPermission,
			})
			.from(githubAccessAssessments)
			.where(and(eq(githubAccessAssessments.applicationId, applicationId), isNull(githubAccessAssessments.archivedAt))),
	])

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

	const assessmentByUsername = new Map(assessmentRows.map((a) => [normalizeGithubUsername(a.username), a]))
	const liveUsernames = new Set(userAccess.map((u) => normalizeGithubUsername(u.username)))
	const seededAt = new Date().toISOString()

	const syncedTimestamps: Date[] = [
		...Array.from(teamsById.values()).map((t) => t.syncedAt),
		...memberSyncedTimestamps,
		...collaboratorRows.map((c) => c.syncedAt),
	]
	const dataSyncedAt =
		syncedTimestamps.length > 0 ? new Date(Math.max(...syncedTimestamps.map((d) => d.getTime()))).toISOString() : null

	const activeSubjects: GithubAccessSubject[] = userAccess.map((u) => {
		const prior = assessmentByUsername.get(u.username) ?? null
		return {
			username: u.username,
			highestPermission: u.highestPermission,
			directPermission: u.directPermission,
			viaTeams: u.viaTeams,
			isNew: prior === null,
			isGone: false,
			markedForRemoval: false,
			removalMarkedBy: null,
			removalMarkedAt: null,
			permissionAdjustmentRequested: false,
			targetPermission: null,
			permissionAdjustmentMarkedBy: null,
			permissionAdjustmentMarkedAt: null,
		}
	})

	const goneSubjects: GithubAccessSubject[] = assessmentRows
		.filter((a) => !liveUsernames.has(normalizeGithubUsername(a.username)))
		.map((a) => ({
			username: normalizeGithubUsername(a.username),
			highestPermission: a.lastKnownPermission ?? "ukjent",
			directPermission: null,
			viaTeams: [],
			isNew: false,
			isGone: true,
			markedForRemoval: false,
			removalMarkedBy: null,
			removalMarkedAt: null,
			permissionAdjustmentRequested: false,
			targetPermission: null,
			permissionAdjustmentMarkedBy: null,
			permissionAdjustmentMarkedAt: null,
		}))

	const subjects = [...activeSubjects, ...goneSubjects].sort((a, b) => {
		if (a.isGone !== b.isGone) return a.isGone ? 1 : -1
		return a.username.localeCompare(b.username, "nb")
	})

	const stagedData: GithubAccessStagedData = {
		activityType: GITHUB_ACCESS_STAGED_DATA_ACTIVITY_TYPE,
		schemaVersion: GITHUB_ACCESS_STAGED_DATA_SCHEMA_VERSION,
		seededAt,
		dataSyncedAt,
		gitRepository: app.gitRepository,
		subjects,
		confirmedBy: null,
		confirmedAt: null,
	}

	return { stagedData, snapshot: toGithubAccessSnapshot(stagedData) }
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
		})
		.from(routineReviewActivities)
		.innerJoin(routineReviews, eq(routineReviewActivities.reviewId, routineReviews.id))
		.where(eq(routineReviewActivities.id, activityId))
		.limit(1)

	if (!precheck) throw new Error(`Fant ikke review-aktivitet ${activityId}`)
	if (precheck.type !== "github_access_maintenance") {
		throw new Error(`Aktivitet ${activityId} er ikke Github-tilgangsgjennomgang`)
	}
	if (!precheck.applicationId) throw new Response("Github-aktiviteten mangler applikasjon", { status: 400 })
	if (precheck.status !== "pending") throw new Response("Kan ikke seed'e en fullført aktivitet", { status: 409 })
	if (precheck.stagedData) return parseGithubAccessStagedData(precheck.stagedData)

	const seeded = await buildGithubAccessSeedResult(precheck.applicationId)

	const lockName = `github_access_maintenance-activity-${activityId}`
	const lockResult = await withAdvisoryLock(lockName, async () => {
		const [current] = await db
			.select({ status: routineReviewActivities.status, stagedData: routineReviewActivities.stagedData })
			.from(routineReviewActivities)
			.where(eq(routineReviewActivities.id, activityId))
			.limit(1)

		if (!current) throw new Error(`Fant ikke review-aktivitet ${activityId}`)
		if (current.status !== "pending") throw new Response("Kan ikke seed'e en fullført aktivitet", { status: 409 })
		if (current.stagedData) return parseGithubAccessStagedData(current.stagedData)

		return db.transaction(async (tx) => {
			const [updated] = await tx
				.update(routineReviewActivities)
				.set({
					stagedData: seeded.stagedData,
					snapshotBefore: sql`COALESCE(${routineReviewActivities.snapshotBefore}, ${JSON.stringify(seeded.snapshot)}::jsonb)`,
				})
				.where(and(eq(routineReviewActivities.id, activityId), isNull(routineReviewActivities.stagedData)))
				.returning({ stagedData: routineReviewActivities.stagedData })

			if (updated?.stagedData) {
				await writeAuditLog(
					{
						action: "review_activity_seeded",
						entityType: "routine_review_activity",
						entityId: activityId,
						performedBy,
					},
					tx,
				)
				return parseGithubAccessStagedData(updated.stagedData)
			}

			const [current2] = await tx
				.select({ stagedData: routineReviewActivities.stagedData })
				.from(routineReviewActivities)
				.where(eq(routineReviewActivities.id, activityId))
				.limit(1)

			if (!current2?.stagedData) throw new Error(`Kunne ikke seed'e Github-aktivitet ${activityId}`)
			return parseGithubAccessStagedData(current2.stagedData)
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
		throw new Error(`Aktivitet ${activityId} er ikke Github-tilgangsgjennomgang`)
	}
	if (precheck.routineArchivedAt) {
		throw new Response("Kan ikke endre vurderinger på en arkivert rutine.", { status: 403 })
	}
	if (precheck.reviewStatus !== "draft") throw new Response("Gjennomgangen er ikke lenger redigerbar.", { status: 409 })
	if (precheck.status !== "pending") throw new Response("Kan ikke endre en fullført aktivitet", { status: 409 })

	const seedResult =
		!precheck.stagedData && precheck.applicationId
			? await buildGithubAccessSeedResult(precheck.applicationId)
			: !precheck.stagedData
				? (() => {
						throw new Response("Github-aktiviteten mangler applikasjon", { status: 400 })
					})()
				: null

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
				.select({ status: routineReviews.status })
				.from(routineReviews)
				.where(eq(routineReviews.id, activity.reviewId))
				.for("update")
				.limit(1)
			if (!review || review.status !== "draft") {
				throw new Response("Gjennomgangen er ikke lenger redigerbar.", { status: 409 })
			}

			let stagedData = activity.stagedData ? parseGithubAccessStagedData(activity.stagedData) : null
			let seededInThisCall = false
			if (!stagedData) {
				if (!seedResult) throw new Error(`Mangler staged_data for Github-aktivitet ${activityId}`)
				stagedData = seedResult.stagedData
				seededInThisCall = true
			}

			let updatedData: GithubAccessStagedData
			try {
				updatedData = applyGithubAccessStagedDataPatch(stagedData, patch)
			} catch (e) {
				throw new Response(e instanceof Error ? e.message : "Ugyldig patch-operasjon", { status: 400 })
			}
			const hasChanged = JSON.stringify(stagedData) !== JSON.stringify(updatedData)

			if (hasChanged || seededInThisCall) {
				const [updated] = await tx
					.update(routineReviewActivities)
					.set({
						stagedData: updatedData,
						...(seededInThisCall && {
							snapshotBefore: sql`COALESCE(${routineReviewActivities.snapshotBefore}, ${JSON.stringify(seedResult?.snapshot)}::jsonb)`,
						}),
					})
					.where(and(eq(routineReviewActivities.id, activityId), eq(routineReviewActivities.status, "pending")))
					.returning({ id: routineReviewActivities.id })
				if (!updated) {
					throw new Response("Kan ikke endre en fullført aktivitet", { status: 409 })
				}
			}

			if (seededInThisCall) {
				await writeAuditLog(
					{
						action: "review_activity_seeded",
						entityType: "routine_review_activity",
						entityId: activityId,
						performedBy,
					},
					tx,
				)
			}

			if (hasChanged) {
				const username = "username" in patch ? patch.username : null
				const patchedSubject = username ? updatedData.subjects.find((s) => s.username === username) : null

				await writeAuditLog(
					{
						action: "review_activity_github_access_patched",
						entityType: "routine_review_activity",
						entityId: activityId,
						previousValue: JSON.stringify(activity.stagedData ?? stagedData),
						newValue: patchedSubject
							? JSON.stringify({
									username: patchedSubject.username,
									markedForRemoval: patchedSubject.markedForRemoval,
									removalMarkedBy: patchedSubject.removalMarkedBy,
									removalMarkedAt: patchedSubject.removalMarkedAt,
									permissionAdjustmentRequested: patchedSubject.permissionAdjustmentRequested,
									targetPermission: patchedSubject.targetPermission,
									permissionAdjustmentMarkedBy: patchedSubject.permissionAdjustmentMarkedBy,
									permissionAdjustmentMarkedAt: patchedSubject.permissionAdjustmentMarkedAt,
								})
							: JSON.stringify({ confirmedBy: updatedData.confirmedBy, confirmedAt: updatedData.confirmedAt }),
						metadata: { activityId, ...(username && { username }) },
						performedBy,
					},
					tx,
				)
			}
		})
	})

	if (lockResult === null) {
		throw new Response("Gjennomgangen er låst av en annen operasjon. Prøv igjen.", { status: 409 })
	}
}

const REMOVAL_FOLLOW_UP_GUIDANCE =
	"Veiledning fra rutinen: Dersom en bruker har hatt tilgang med kritikalitet HØY eller SVÆRT HØY uten " +
	"tjenstlig behov, skal rettigheten umiddelbart fjernes. Alle brukerens handlinger i den aktuelle perioden " +
	"skal gjennomgås av produktleder i samråd med teknisk egnet personell. Det skal vurderes om rollen kan ha " +
	"blitt utnyttet i perioden hvor det ikke lengre fantes et tjenstlig behov. Risikovurderingen skal " +
	"dokumenteres i gjennomgangen av denne rutinen. Det dokumenteres i form av et vedlegg som legges ved."

export async function commitGithubAccessActivity(
	activityId: string,
	reviewId: string,
	performedBy: string,
	executor: DbExecutor,
	onUploaded?: (path: string) => void,
): Promise<GithubAccessSnapshot> {
	const [activity] = await executor
		.select({
			id: routineReviewActivities.id,
			reviewId: routineReviewActivities.reviewId,
			status: routineReviewActivities.status,
			stagedData: routineReviewActivities.stagedData,
			applicationId: routineReviews.applicationId,
		})
		.from(routineReviewActivities)
		.innerJoin(routineReviews, eq(routineReviewActivities.reviewId, routineReviews.id))
		.where(eq(routineReviewActivities.id, activityId))
		.limit(1)

	if (!activity) throw new Error(`Fant ikke review-aktivitet ${activityId}`)
	if (activity.reviewId !== reviewId) {
		throw new Response(`reviewId mismatch: forventet ${activity.reviewId}, fikk ${reviewId}`, { status: 400 })
	}
	if (activity.status !== "pending") throw new Response("Aktiviteten er allerede fullført", { status: 409 })
	if (!activity.applicationId) throw new Response("Github-aktiviteten mangler applikasjon", { status: 400 })

	let stagedData = activity.stagedData ? parseGithubAccessStagedData(activity.stagedData) : null
	if (!stagedData) {
		const seeded = await buildGithubAccessSeedResult(activity.applicationId, executor)
		const [seededActivity] = await executor
			.update(routineReviewActivities)
			.set({
				stagedData: seeded.stagedData,
				snapshotBefore: sql`COALESCE(${routineReviewActivities.snapshotBefore}, ${JSON.stringify(seeded.snapshot)}::jsonb)`,
			})
			.where(and(eq(routineReviewActivities.id, activityId), isNull(routineReviewActivities.stagedData)))
			.returning({ stagedData: routineReviewActivities.stagedData })

		if (seededActivity?.stagedData) {
			await writeAuditLog(
				{ action: "review_activity_seeded", entityType: "routine_review_activity", entityId: activityId, performedBy },
				executor,
			)
			stagedData = parseGithubAccessStagedData(seededActivity.stagedData)
		} else {
			const [current] = await executor
				.select({ stagedData: routineReviewActivities.stagedData })
				.from(routineReviewActivities)
				.where(eq(routineReviewActivities.id, activityId))
				.limit(1)
			if (!current?.stagedData) throw new Error(`Mangler staged_data for Github-aktivitet ${activityId}`)
			stagedData = parseGithubAccessStagedData(current.stagedData)
		}
	}

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

	let githubUserLookups = new Map<string, GitHubUserLookupResult>()
	try {
		githubUserLookups = await lookupGitHubUsers(stagedData.subjects.map((s) => s.username))
	} catch (error) {
		logger.warn("Kunne ikke hente visningsnavn for GitHub-brukere fra NDA til PDF-en", error)
	}

	const reviewerNavIdents = new Set<string>([performedBy])
	for (const s of stagedData.subjects) {
		if (s.removalMarkedBy) reviewerNavIdents.add(s.removalMarkedBy)
		if (s.permissionAdjustmentMarkedBy) reviewerNavIdents.add(s.permissionAdjustmentMarkedBy)
	}
	const nameByNavIdent = await getUserNamesByNavIdents(Array.from(reviewerNavIdents))

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
				activityStepId: activityId,
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

	for (const subject of stagedData.subjects) {
		const username = normalizeGithubUsername(subject.username)
		const [existing] = await executor
			.select({
				id: githubAccessAssessments.id,
				lastKnownPermission: githubAccessAssessments.lastKnownPermission,
				archivedAt: githubAccessAssessments.archivedAt,
			})
			.from(githubAccessAssessments)
			.where(
				and(
					eq(githubAccessAssessments.applicationId, activity.applicationId),
					eq(githubAccessAssessments.username, username),
				),
			)
			.limit(1)
		const previousValue = existing
			? JSON.stringify({ username, lastKnownPermission: existing.lastKnownPermission, archivedAt: existing.archivedAt })
			: null

		if (subject.isGone) {
			const [archived] = await executor
				.update(githubAccessAssessments)
				.set({ archivedAt: new Date(), archivedBy: performedBy, updatedBy: performedBy, updatedAt: new Date() })
				.where(
					and(
						eq(githubAccessAssessments.applicationId, activity.applicationId),
						eq(githubAccessAssessments.username, username),
					),
				)
				.returning({ id: githubAccessAssessments.id })
			if (archived) {
				await writeAuditLog(
					{
						action: "github_access_assessment_saved",
						entityType: "github_access_assessment",
						entityId: archived.id,
						previousValue,
						newValue: JSON.stringify({ username, archived: true }),
						metadata: { applicationId: activity.applicationId, reviewId, activityId },
						performedBy,
					},
					executor,
				)
			}
			continue
		}
		const [upserted] = await executor
			.insert(githubAccessAssessments)
			.values({
				applicationId: activity.applicationId,
				username,
				lastKnownPermission: subject.highestPermission,
				createdBy: performedBy,
				updatedBy: performedBy,
			})
			.onConflictDoUpdate({
				target: [githubAccessAssessments.applicationId, githubAccessAssessments.username],
				set: {
					lastKnownPermission: subject.highestPermission,
					archivedAt: null,
					archivedBy: null,
					updatedBy: performedBy,
					updatedAt: new Date(),
				},
			})
			.returning({ id: githubAccessAssessments.id })
		await writeAuditLog(
			{
				action: "github_access_assessment_saved",
				entityType: "github_access_assessment",
				entityId: upserted.id,
				previousValue,
				newValue: JSON.stringify({ username, lastKnownPermission: subject.highestPermission }),
				metadata: { applicationId: activity.applicationId, reviewId, activityId },
				performedBy,
			},
			executor,
		)
	}

	return toGithubAccessSnapshot(stagedData)
}
