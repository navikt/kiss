import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { searchUsers } from "~/lib/graph.server"
import type { Route } from "./+types/index"

export async function loader({ request, url }: Route.LoaderArgs) {
	const user = await getAuthenticatedUser(request)
	requireUser(user)

	const query = url.searchParams.get("q") ?? ""

	const results = await searchUsers(query)

	return Response.json({ results })
}
