import type { ActionFunctionArgs } from "react-router"
import { data } from "react-router"
import { getAuthenticatedUser } from "~/lib/auth.server"
import { runFullNaisSync } from "~/lib/nais-sync.server"

/** POST /api/nais-sync — trigger a full Nais sync. Requires authentication. */
export async function action({ request }: ActionFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	if (!user) {
		return data({ error: "Ikke autentisert" }, { status: 401 })
	}

	const token = process.env.NAIS_API_TOKEN || undefined
	const result = await runFullNaisSync(token)
	if (!result) {
		return data({ message: "Synkronisering pågår allerede." }, { status: 409 })
	}

	return data({
		success: true,
		teams: result.teams,
		apps: result.apps,
	})
}
