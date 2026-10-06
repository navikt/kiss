import { and, eq, isNull } from "drizzle-orm"
import { db } from "~/db/connection.server"
import { buildGithubAccessSeedResult } from "~/db/queries/github-access-activity.server"
import { getReviewActivityByType, getReviewScope } from "~/db/queries/routines.server"
import { getUserNamesByNavIdents } from "~/db/queries/users.server"
import { routineReviewParticipants } from "~/db/schema/routines"
import { requireAuthenticatedUser } from "~/lib/auth.server"
import { requireReviewReadAccess } from "~/lib/authorization.server"
import { buildGithubAccessReviewPdf } from "~/lib/github-access-pdf.server"
import { parseGithubAccessStagedData } from "~/lib/github-access-staged-data"
import { logger } from "~/lib/logger.server"
import { type GitHubUserLookupResult, lookupGitHubUsers } from "~/lib/nda-github-users.server"
import { sanitizeFilename } from "~/lib/sanitize-filename"
import type { Route } from "./+types/index"

export async function loader({ request, params }: Route.LoaderArgs) {
	const { gjennomgangId } = params
	if (!gjennomgangId) throw new Response("Mangler gjennomgang-ID", { status: 400 })

	const authedUser = await requireAuthenticatedUser(request)

	const scope = await getReviewScope(gjennomgangId)
	if (!scope) throw new Response("Fant ikke gjennomgang", { status: 404 })
	await requireReviewReadAccess(authedUser, scope)
	if (!scope.applicationId) throw new Response("Gjennomgangen mangler applikasjon", { status: 400 })

	const activity = await getReviewActivityByType(gjennomgangId, "github_access_maintenance")
	if (!activity) throw new Response("Fant ikke Github-tilgangsaktivitet", { status: 404 })

	const stagedData = activity.stagedData
		? parseGithubAccessStagedData(activity.stagedData)
		: (await buildGithubAccessSeedResult(scope.applicationId)).stagedData

	const participantRows = await db
		.select({
			userIdent: routineReviewParticipants.userIdent,
			userName: routineReviewParticipants.userName,
			confirmedAt: routineReviewParticipants.confirmedAt,
		})
		.from(routineReviewParticipants)
		.where(and(eq(routineReviewParticipants.reviewId, gjennomgangId), isNull(routineReviewParticipants.archivedAt)))

	let githubUserLookups = new Map<string, GitHubUserLookupResult>()
	try {
		githubUserLookups = await lookupGitHubUsers(stagedData.subjects.map((s) => s.username))
	} catch (error) {
		logger.warn("Kunne ikke hente visningsnavn for GitHub-brukere fra NDA til PDF-forhåndsvisningen", error)
	}

	const reviewerNavIdents = new Set<string>([authedUser.navIdent])
	for (const s of stagedData.subjects) {
		if (s.removalMarkedBy) reviewerNavIdents.add(s.removalMarkedBy)
		if (s.permissionAdjustmentMarkedBy) reviewerNavIdents.add(s.permissionAdjustmentMarkedBy)
	}
	const nameByNavIdent = await getUserNamesByNavIdents(Array.from(reviewerNavIdents))

	const pdfBuffer = await buildGithubAccessReviewPdf(stagedData, {
		performedBy: authedUser.navIdent,
		isDraft: true,
		participants: participantRows,
		githubUserLookups,
		nameByNavIdent,
	})

	const safeRepo = sanitizeFilename(stagedData.gitRepository.replace(/[/\\]/g, "-"), 60)

	return new Response(new Uint8Array(pdfBuffer), {
		headers: {
			"Content-Type": "application/pdf",
			"Content-Disposition": `inline; filename="utkast-github-tilgangsgjennomgang-${safeRepo}.pdf"`,
		},
	})
}
