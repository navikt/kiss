import type { ActionFunctionArgs } from "react-router"
import { redirect } from "react-router"
import { linkAppToTeam } from "~/db/queries/applications.server"
import { getUnassignedAppsForSection } from "~/db/queries/nais.server"
import { getSectionDetail, getTeamsForSection } from "~/db/queries/sections.server"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { canManageTeam } from "~/lib/authorization.server"

export async function action({ request, params }: ActionFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)

	const seksjon = params.seksjon
	if (!seksjon) throw new Response("Mangler seksjon", { status: 400 })

	const result = await getSectionDetail(seksjon)
	if (!result) throw new Response("Seksjon ikke funnet", { status: 404 })

	const sectionId = result.section.id
	const formData = await request.formData()
	const intent = formData.get("intent") as string
	const userId = authedUser.navIdent

	if (intent === "bulk-assign-team") {
		const teamId = formData.get("teamId") as string
		const appIds = [...new Set(formData.getAll("appId") as string[])]
		if (!teamId) throw new Response("Mangler team", { status: 400 })
		if (appIds.length === 0) throw new Response("Ingen applikasjoner valgt", { status: 400 })
		if (!canManageTeam(authedUser, teamId)) throw new Response("Ikke autorisert", { status: 403 })

		// Verify team belongs to this section
		const sectionTeams = await getTeamsForSection(sectionId, { includeArchived: false })
		if (!sectionTeams.some((t) => t.id === teamId)) {
			throw new Response("Team tilhører ikke denne seksjonen", { status: 403 })
		}

		// Verify all apps are actually unassigned in this section
		const unassigned = await getUnassignedAppsForSection(sectionId)
		const unassignedIds = new Set(unassigned.map((a) => a.appId))
		for (const appId of appIds) {
			if (!unassignedIds.has(appId)) {
				throw new Response("Applikasjon er ikke ufordelt i denne seksjonen", { status: 400 })
			}
		}

		for (const appId of appIds) {
			await linkAppToTeam(appId, teamId, userId)
		}
		return redirect(`/seksjoner/${seksjon}/applikasjoner-uten-team`)
	}

	throw new Response("Ugyldig handling", { status: 400 })
}
