import type { ActionFunctionArgs } from "react-router"
import { action as genericAction } from "~/routes/api.evidence-download/index"

/**
 * @deprecated Use /api/evidence-download with providerType=oracle instead.
 * Proxies to the generic evidence download route with providerType=oracle.
 */
export async function action(args: ActionFunctionArgs) {
	const formData = await args.request.formData()
	formData.set("providerType", "oracle")

	// Strip content-type/content-length so runtime sets correct multipart boundary
	const headers = new Headers(args.request.headers)
	headers.delete("content-type")
	headers.delete("content-length")

	const newRequest = new Request(args.request.url, {
		method: args.request.method,
		headers,
		body: formData,
	})

	return genericAction({ ...args, request: newRequest })
}
