import type { LoaderFunctionArgs } from "react-router"
import { data } from "react-router"
import { getApplicationsForSection } from "~/db/queries/applications.server"
import {
	getAppsPersistence,
	getIgnoredAppsForSection,
	getNaisTeamsForSection,
	getSectionEnvironments,
	getUnlinkedNaisTeams,
} from "~/db/queries/nais.server"
import { getSectionDetail, getTeamsForSection } from "~/db/queries/sections.server"
import { requireAuthenticatedUser } from "~/lib/auth.server"
import { requireAdmin } from "~/lib/authorization.server"

export async function loader({ request, params }: LoaderFunctionArgs) {
	const authedUser = await requireAuthenticatedUser(request)
	requireAdmin(authedUser)

	const seksjon = params.seksjon
	if (!seksjon) throw new Response("Mangler seksjon", { status: 400 })

	const result = await getSectionDetail(seksjon)
	if (!result) throw new Response("Seksjon ikke funnet", { status: 404 })

	const sectionId = result.section.id

	const [teams, linkedNaisTeams, unlinkedNaisTeams, sectionApps, sectionEnvironmentsList, ignoredApps] =
		await Promise.all([
			getTeamsForSection(sectionId, { includeArchived: true }),
			getNaisTeamsForSection(sectionId),
			getUnlinkedNaisTeams(),
			getApplicationsForSection(sectionId),
			getSectionEnvironments(sectionId),
			getIgnoredAppsForSection(sectionId),
		])

	const sectionAppIds = sectionApps.map((a) => a.id)
	const persistenceMap = await getAppsPersistence(sectionAppIds)

	return data({
		section: {
			id: sectionId,
			name: result.section.name,
			slug: result.section.slug,
			description: result.section.description,
		},
		teams: teams.map((t) => ({
			id: t.id,
			name: t.name,
			slug: t.slug,
			description: t.description,
			linkedNaisTeams: t.linkedNaisTeams,
			archivedAt: t.archivedAt?.toISOString() ?? null,
		})),
		linkedNaisTeams: linkedNaisTeams.map((t) => ({
			slug: t.slug,
			displayName: t.displayName,
			devTeamId: t.devTeamId,
		})),
		unlinkedNaisTeams: unlinkedNaisTeams.map((t) => ({
			slug: t.slug,
			displayName: t.displayName,
		})),
		sectionApps,
		ignoredApps: ignoredApps.map((a) => ({
			appId: a.appId,
			appName: a.appName,
			reason: a.reason,
			ignoredBy: a.ignoredBy,
			ignoredAt: a.ignoredAt?.toISOString() ?? null,
		})),
		persistenceMap: Object.fromEntries(persistenceMap),
		sectionEnvironments: sectionEnvironmentsList,
		seksjon,
	})
}
