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
import { computeGithubUserAccess } from "~/lib/github-user-access"
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

/**
 * Build the initial staged_data document for a github_access_maintenance activity.
 * Reads live GitHub sync tables (teams + members, collaborators) plus the persistent
 * `github_access_assessments` table (only used to know which usernames had access last round,
 * for isNew/isGone detection — no justification history is carried over).
 *
 * "Gone" subjects (persisted assessment row exists, but the person no longer has live
 * GitHub access) are appended so the reviewer can see who was removed since last round.
 *
 * Reads local DB only — no external API calls, so this may safely run inside an advisory lock.
 */
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

	const [teamRows, memberRows, collaboratorRows, assessmentRows] = await Promise.all([
		executor.select().from(githubRepoTeams).where(eq(githubRepoTeams.applicationId, applicationId)),
		executor
			.select()
			.from(githubRepoTeamMembers)
			.innerJoin(githubRepoTeams, eq(githubRepoTeamMembers.repoTeamId, githubRepoTeams.id))
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

	const membersByTeamId = new Map<string, Array<{ username: string; role: string }>>()
	for (const row of memberRows) {
		const list = membersByTeamId.get(row.github_repo_team_members.repoTeamId) ?? []
		list.push({ username: row.github_repo_team_members.username, role: row.github_repo_team_members.role })
		membersByTeamId.set(row.github_repo_team_members.repoTeamId, list)
	}

	const teamsWithMembers = teamRows.map((team) => ({
		teamSlug: team.teamSlug,
		teamName: team.teamName,
		permission: team.permission,
		members: membersByTeamId.get(team.id) ?? [],
	}))

	const userAccess = computeGithubUserAccess(
		teamsWithMembers,
		collaboratorRows.map((c) => ({ username: c.username, permission: c.permission })),
	)

	const assessmentByUsername = new Map(assessmentRows.map((a) => [a.username, a]))
	const liveUsernames = new Set(userAccess.map((u) => u.username))
	const seededAt = new Date().toISOString()

	// Nyeste "synced_at" på tvers av de synkede Github-tabellene — reflekterer tidspunktet for siste
	// vellykkede nattlige synkronisering mot Github API, forut for at gjennomgangen ble startet.
	const syncedTimestamps: Date[] = [
		...teamRows.map((t) => t.syncedAt),
		...memberRows.map((m) => m.github_repo_team_members.syncedAt),
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
		.filter((a) => !liveUsernames.has(a.username))
		.map((a) => ({
			username: a.username,
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

/**
 * Seed a github_access_maintenance activity. If already seeded, returns the existing
 * staged_data without modification (idempotent).
 */
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

/**
 * Apply a single patch (mark/unmark for removal or adjustment, confirm-review) to the
 * staged_data of a github_access_maintenance activity. Seeds the activity first if staged_data
 * is not yet set. This is a simple single-field/single-subject update — no multi-row staleness
 * protection is needed since there is no bulk operation anymore.
 */
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
				.select({ status: routineReviewActivities.status, stagedData: routineReviewActivities.stagedData })
				.from(routineReviewActivities)
				.where(eq(routineReviewActivities.id, activityId))
				.limit(1)

			if (!activity) throw new Error(`Fant ikke review-aktivitet ${activityId}`)
			if (activity.status !== "pending") throw new Response("Kan ikke endre en fullført aktivitet", { status: 409 })

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
				await tx
					.update(routineReviewActivities)
					.set({
						stagedData: updatedData,
						...(seededInThisCall && {
							snapshotBefore: sql`COALESCE(${routineReviewActivities.snapshotBefore}, ${JSON.stringify(seedResult?.snapshot)}::jsonb)`,
						}),
					})
					.where(eq(routineReviewActivities.id, activityId))
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
						// Preserve the entire unparsed previous document, including retired legacy evidence.
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

/**
 * Veiledningstekst fra rutinens "Manglende tjenstlig behov"-avsnitt, bakt inn som hjelpetekst i
 * oppfølgingspunktet for enhver fjerning — reviewer avgjør selv om situasjonen faktisk gjelder
 * (høy/svært høy kritikalitet uten tjenstlig behov), men blir påminnet om risikovurderings- og
 * dokumentasjonskravet uansett årsak til fjerningen.
 */
const REMOVAL_FOLLOW_UP_GUIDANCE =
	"Veiledning fra rutinen: Dersom en bruker har hatt tilgang med kritikalitet HØY eller SVÆRT HØY uten " +
	"tjenstlig behov, skal rettigheten umiddelbart fjernes. Alle brukerens handlinger i den aktuelle perioden " +
	"skal gjennomgås av produktleder i samråd med teknisk egnet personell. Det skal vurderes om rollen kan ha " +
	"blitt utnyttet i perioden hvor det ikke lengre fantes et tjenstlig behov. Risikovurderingen skal " +
	"dokumenteres i gjennomgangen av denne rutinen. Det dokumenteres i form av et vedlegg som legges ved."

/**
 * Commit a github_access_maintenance activity:
 * - Validates that the reviewer has confirmed the whole list (`confirmedAt`).
 * - Generates a PDF summary of the review and attaches it as automated evidence
 *   (`routine_review_attachments`, sourceType "automated") — satisfies the routine's
 *   explicit "revisjonsbevis"-krav without requiring the reviewer to take a manual screenshot.
 * - Returns a snapshot of the final state for snapshotAfter.
 *
 * The PDF is generated up front and the storage upload also happens before any row writes in
 * this function, so failures during generation/upload never touch the DB. Note that when this
 * function is invoked via the shared multi-activity transaction in `completeReview()` (the global
 * "Fullfør gjennomgang" button), the upload does happen while that transaction is open — accepted
 * here as a pragmatic tradeoff since the PDF is small and the upload is a single fast HTTP call,
 * unlike Entra/RPA's potentially large external API calls which are pre-seeded outside the tx.
 * If the subsequent attachment-row insert fails, the uploaded object is deleted immediately.
 * If a LATER activity in the same shared transaction (`completeReview()`) fails and rolls back
 * this attachment insert too, that alone can't clean up the already-uploaded file — callers that
 * run multiple activities in one transaction must track `onUploaded` paths themselves and delete
 * them on rollback (see `completeReview()`).
 *
 * Must be called from within an advisory lock (see completeReviewActivity's github branch).
 */
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

	// Registrerte deltakere på selve rutinegjennomgangen (fra "Innledning"-steget) — atskilt fra
	// `performedBy`, som kun er personen som klikket "Endelig godkjent" for denne aktiviteten.
	const participantRows = await executor
		.select({
			userIdent: routineReviewParticipants.userIdent,
			userName: routineReviewParticipants.userName,
			confirmedAt: routineReviewParticipants.confirmedAt,
		})
		.from(routineReviewParticipants)
		.where(and(eq(routineReviewParticipants.reviewId, reviewId), isNull(routineReviewParticipants.archivedAt)))

	// Visningsnavn/nav-ident fra NDAs Github-brukeroppslag til PDF-en — kun for visning, lagres
	// ikke i staged_data. Feiler oppslaget, faller PDF-en tilbake til GitHub-brukernavn alene.
	let githubUserLookups = new Map<string, GitHubUserLookupResult>()
	try {
		githubUserLookups = await lookupGitHubUsers(stagedData.subjects.map((s) => s.username))
	} catch (error) {
		logger.warn("Kunne ikke hente visningsnavn for GitHub-brukere fra NDA til PDF-en", error)
	}

	// Reelt navn fra intern brukertabell til "Godkjent av"-visningen i PDF-en (deltakere,
	// performedBy og per-rad merket-av) — kun for visning, lagres ikke i staged_data.
	const reviewerNavIdents = new Set<string>([performedBy])
	for (const s of stagedData.subjects) {
		if (s.removalMarkedBy) reviewerNavIdents.add(s.removalMarkedBy)
		if (s.permissionAdjustmentMarkedBy) reviewerNavIdents.add(s.permissionAdjustmentMarkedBy)
	}
	const nameByNavIdent = await getUserNamesByNavIdents(Array.from(reviewerNavIdents))

	// Generate + upload the PDF OUTSIDE the transaction (network/CPU-bound I/O must not hold a DB tx open).
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
	// Report the uploaded path immediately so a caller running multiple activities in one shared
	// transaction (completeReview()) can clean it up if a LATER activity fails and rolls back this
	// attachment insert too — the try/catch below only covers failures from this call onwards.
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

	// Personer markert for fjerning/tilgangsjustering i denne runden får hver sitt preutfylte
	// oppfølgingspunkt i stedet for at KISS re-verifiserer endringen mot GitHub. Dette gir
	// sporbarhet på at endringen faktisk må utføres/følges opp, uten å blokkere fullføring av
	// selve gjennomgangen på et ekstra GitHub-kall.
	// Dynamisk import for å bryte den sirkulære avhengigheten routines.server.ts <-> denne filen
	// (routines.server.ts importerer statisk commitGithubAccessActivity/seedGithubAccessActivity herfra).
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

	// Husk hvilke brukernavn som hadde tilgang i DENNE runden, slik at neste runde kan beregne
	// isNew/isGone riktig — se JSDoc på githubAccessAssessments. Ingen vurderingstekst lagres lenger.
	for (const subject of stagedData.subjects) {
		if (subject.isGone) {
			// Arkiver baseline-raden slik at personen kun vises som «fjernet siden forrige
			// gjennomgang» i DENNE aktiviteten, ikke i alle fremtidige runder.
			const [archived] = await executor
				.update(githubAccessAssessments)
				.set({ archivedAt: new Date(), archivedBy: performedBy, updatedBy: performedBy, updatedAt: new Date() })
				.where(
					and(
						eq(githubAccessAssessments.applicationId, activity.applicationId),
						eq(githubAccessAssessments.username, subject.username),
					),
				)
				.returning({ id: githubAccessAssessments.id })
			if (archived) {
				await writeAuditLog(
					{
						action: "github_access_assessment_saved",
						entityType: "github_access_assessment",
						entityId: archived.id,
						newValue: JSON.stringify({ username: subject.username, archived: true }),
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
				username: subject.username,
				lastKnownPermission: subject.highestPermission,
				createdBy: performedBy,
				updatedBy: performedBy,
			})
			.onConflictDoUpdate({
				target: [githubAccessAssessments.applicationId, githubAccessAssessments.username],
				set: {
					lastKnownPermission: subject.highestPermission,
					// Reaktiver raden hvis personen hadde mistet og nå har fått tilgangen igjen
					// (den unike nøkkelen tillater kun én rad per person, så vi gjenbruker den).
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
				newValue: JSON.stringify({ username: subject.username, lastKnownPermission: subject.highestPermission }),
				metadata: { applicationId: activity.applicationId, reviewId, activityId },
				performedBy,
			},
			executor,
		)
	}

	return toGithubAccessSnapshot(stagedData)
}
