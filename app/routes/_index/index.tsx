import { redirect } from "react-router"
import { getUserLandingPage, getUserRoles } from "~/db/queries/users.server"
import { getAuthenticatedUser } from "~/lib/auth.server"
import type { Route } from "./+types/index"

export async function loader({ request }: Route.LoaderArgs) {
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
			if (landingPage === "mine-team") {
				const hasTeam = roles.some((r) => r.devTeamId)
				if (hasTeam) {
					return redirect("/mine-team")
				}
			}
			if (firstSection?.sectionSlug) {
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
