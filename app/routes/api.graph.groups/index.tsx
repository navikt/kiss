import type { LoaderFunctionArgs } from "react-router"
import { requireAuthenticatedUser } from "~/lib/auth.server"
import { requireAdmin } from "~/lib/authorization.server"
import { searchGroups } from "~/lib/graph.server"

export async function loader({ request }: LoaderFunctionArgs) {
	const authedUser = await requireAuthenticatedUser(request)
	requireAdmin(authedUser)

	const url = new URL(request.url)
	const query = url.searchParams.get("q") ?? ""

	const results = await searchGroups(query)

	return Response.json({ results })
}
