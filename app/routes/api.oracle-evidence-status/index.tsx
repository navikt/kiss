import type { LoaderFunctionArgs } from "react-router"
import { redirect } from "react-router"

/**
 * @deprecated Use /api/evidence-status?providerType=oracle instead.
 * Redirects to the generic evidence status route with providerType=oracle.
 */
export async function loader({ request }: LoaderFunctionArgs) {
	const url = new URL(request.url)
	url.pathname = "/api/evidence-status"
	url.searchParams.set("providerType", "oracle")
	return redirect(url.pathname + url.search)
}
