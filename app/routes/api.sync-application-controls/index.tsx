import type { ActionFunctionArgs } from "react-router"
import { data } from "react-router"
import { syncAllApplicationControls } from "~/db/queries/application-controls.server"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"

export async function action({ request }: ActionFunctionArgs) {
	if (request.method !== "POST") {
		throw new Response("Method not allowed", { status: 405 })
	}

	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)

	const result = await syncAllApplicationControls(authedUser.navIdent)

	return data({
		success: true,
		synced: result.synced,
		errors: result.errors,
	})
}
