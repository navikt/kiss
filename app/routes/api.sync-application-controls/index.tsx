import { data } from "react-router"
import { syncAllApplicationControls } from "~/db/queries/application-controls.server"
import { requireAuthenticatedUser } from "~/lib/auth.server"
import type { Route } from "./+types/index"

export async function action({ request }: Route.ActionArgs) {
	if (request.method !== "POST") {
		throw new Response("Method not allowed", { status: 405 })
	}

	const authedUser = await requireAuthenticatedUser(request)

	const result = await syncAllApplicationControls(authedUser.navIdent)

	return data({
		success: true,
		synced: result.synced,
		errors: result.errors,
	})
}
