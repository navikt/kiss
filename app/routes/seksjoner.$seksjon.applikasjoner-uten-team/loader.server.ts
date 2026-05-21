import type { LoaderFunctionArgs } from "react-router"
import { data } from "react-router"
import { getUnassignedAppsForSection } from "~/db/queries/nais.server"
import { getSectionDetail, getTeamsForSection } from "~/db/queries/sections.server"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { canManageTeam } from "~/lib/authorization.server"

export async function loader({ request, params }: LoaderFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)

	const seksjon = params.seksjon
	if (!seksjon) throw new Response("Mangler seksjon", { status: 400 })

	const result = await getSectionDetail(seksjon)
	if (!result) throw new Response("Seksjon ikke funnet", { status: 404 })

	const sectionId = result.section.id

	const [unassignedApps, teams] = await Promise.all([
		getUnassignedAppsForSection(sectionId),
		getTeamsForSection(sectionId, { includeArchived: false }),
	])

	const manageableTeams = teams.filter((t) => canManageTeam(authedUser, t.id))

	return data({
		sectionName: result.section.name,
		seksjon,
		unassignedApps,
		teams: manageableTeams.map((t) => ({ id: t.id, name: t.name })),
		canManageAny: manageableTeams.length > 0,
	})
}
