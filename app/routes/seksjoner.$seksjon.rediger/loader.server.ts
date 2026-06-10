import type { LoaderFunctionArgs } from "react-router"
import { data } from "react-router"
import {
	getAllKnownClusters,
	getNaisTeamsForSection,
	getSectionEnvironments,
	getUnlinkedNaisTeams,
} from "~/db/queries/nais.server"
import { getSectionBySlug, getTeamsForSection } from "~/db/queries/sections.server"
import { requireAuthenticatedUser } from "~/lib/auth.server"
import { requireSectionAccess } from "~/lib/authorization.server"

export async function loader({ request, params }: LoaderFunctionArgs) {
	const authedUser = await requireAuthenticatedUser(request)

	const seksjon = params.seksjon
	if (!seksjon) throw new Response("Mangler seksjon", { status: 400 })

	const result = await getSectionBySlug(seksjon)
	if (!result) throw new Response("Seksjon ikke funnet", { status: 404 })

	const sectionId = result.id
	requireSectionAccess(authedUser, sectionId)

	const [teams, linkedNaisTeams, unlinkedNaisTeams, sectionEnvironmentsList, allKnownClusters] = await Promise.all([
		getTeamsForSection(sectionId, { includeArchived: true }),
		getNaisTeamsForSection(sectionId),
		getUnlinkedNaisTeams(),
		getSectionEnvironments(sectionId),
		getAllKnownClusters(),
	])

	return data({
		section: {
			id: sectionId,
			name: result.name,
			slug: result.slug,
			description: result.description,
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
		sectionEnvironments: sectionEnvironmentsList,
		allKnownClusters,
		seksjon,
	})
}
