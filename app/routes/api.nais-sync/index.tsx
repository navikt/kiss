import type { ActionFunctionArgs } from "react-router"
import { data } from "react-router"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { getNaisToken } from "~/lib/nais.server"
import { runTrackedNaisSync } from "~/lib/nais-sync-jobs.server"

/** POST /api/nais-sync — trigger a full Nais sync. Requires authentication. */
export async function action({ request }: ActionFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	if (!user) {
		return data({ error: "Ikke autentisert" }, { status: 401 })
	}
	const authedUser = requireUser(user)

	const token = getNaisToken()
	const tracked = await runTrackedNaisSync({
		token,
		performedBy: authedUser.navIdent,
		scopeType: "manual",
		scopeId: "api-nais-sync",
	})
	if (!tracked.result) {
		return data({ message: "Synkronisering pågår allerede." }, { status: 409 })
	}

	return data({
		success: true,
		teams: tracked.result.teams,
		apps: tracked.result.apps,
	})
}
