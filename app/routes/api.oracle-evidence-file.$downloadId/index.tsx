import type { LoaderFunctionArgs } from "react-router"
import { data, redirect } from "react-router"
import { isValidUuid } from "~/lib/utils"

/**
 * @deprecated Use /api/evidence-file/:downloadId instead.
 * Redirects to the generic evidence file route.
 */
export async function loader({ params }: LoaderFunctionArgs) {
	if (!params.downloadId || !isValidUuid(params.downloadId)) {
		throw data({ error: "Ugyldig downloadId" }, { status: 400 })
	}
	return redirect(`/api/evidence-file/${params.downloadId}`)
}
