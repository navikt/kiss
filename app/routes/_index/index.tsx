import type { LoaderFunctionArgs } from "react-router"
import { redirect } from "react-router"
import { getUserLandingPage, getUserRoles } from "~/db/queries/users.server"
import { getAuthenticatedUser } from "~/lib/auth.server"

export async function loader({ request }: LoaderFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	if (!user) return redirect("/dashboard")

	let landingPage: string
	try {
		landingPage = await getUserLandingPage(user.navIdent)
	} catch {
		return redirect("/dashboard")
	}

	if (landingPage === "min-seksjon" || landingPage === "mine-team") {
		try {
			const roles = await getUserRoles(user.navIdent)
			const firstSection = roles.find((r) => r.sectionSlug)
			if (firstSection?.sectionSlug) {
				if (landingPage === "mine-team") {
					const firstTeam = roles.find((r) => r.devTeamId && r.devTeamName)
					if (firstTeam?.devTeamId) {
						return redirect(`/seksjoner/${firstSection.sectionSlug}/team/${firstTeam.devTeamId}`)
					}
				}
				return redirect(`/seksjoner/${firstSection.sectionSlug}`)
			}
		} catch {
			// Fall through to dashboard
		}
	}

	return redirect("/dashboard")
}

export default function Index() {
	return null
}
