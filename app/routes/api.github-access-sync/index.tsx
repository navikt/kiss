import { data } from "react-router"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { runGitHubAccessSync } from "~/lib/github-access-sync.server"
import type { Route } from "./+types/index"

/** POST /api/github-access-sync — trigger GitHub repo access sync. Requires authentication. */
export async function action({ request }: Route.ActionArgs) {
	const user = await getAuthenticatedUser(request)
	if (!user) {
		return data({ error: "Ikke autentisert" }, { status: 401 })
	}
	const authenticatedUser = requireUser(user)

	const outcome = await runGitHubAccessSync(authenticatedUser.navIdent)

	if (outcome.status === "not_configured") {
		return data({ error: "GitHub App er ikke konfigurert." }, { status: 503 })
	}
	if (outcome.status === "lock_held") {
		return data({ error: "Synkronisering pågår allerede." }, { status: 409 })
	}

	return data({
		success: true,
		...outcome.result,
	})
}
