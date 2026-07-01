import type { LoaderFunctionArgs } from "react-router"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { searchGroups } from "~/lib/graph.server"

export async function loader({ request, url }: LoaderFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	requireUser(user)

	const query = url.searchParams.get("q") ?? ""

	const results = await searchGroups(query)

	return Response.json({ results })
}
