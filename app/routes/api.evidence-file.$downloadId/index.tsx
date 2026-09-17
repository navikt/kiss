import { data } from "react-router"
import { downloadEvidenceFileFromStorage, getEvidenceDownloadContext } from "~/db/queries/evidence-downloads.server"
import { getReviewDetailAccessScope } from "~/db/queries/routines.server"
import { requireAuthenticatedUser } from "~/lib/auth.server"
import { requireReviewDetailAccess } from "~/lib/authorization.server"
import { requireUuid } from "~/lib/utils"
import type { Route } from "./+types/index"

export async function loader({ params, request }: Route.LoaderArgs) {
	const authedUser = await requireAuthenticatedUser(request)

	const downloadId = requireUuid(params.downloadId, "downloadId")

	const download = await getEvidenceDownloadContext(downloadId)
	if (!download) {
		throw data({ error: "Fant ikke nedlastet fil" }, { status: 404 })
	}
	const scope = await getReviewDetailAccessScope(download.reviewId)
	if (!scope) {
		throw data({ error: "Fant ikke nedlastet fil" }, { status: 404 })
	}
	requireReviewDetailAccess(authedUser, scope)

	const result = await downloadEvidenceFileFromStorage(downloadId)
	if (!result) {
		throw data({ error: "Fant ikke nedlastet fil" }, { status: 404 })
	}

	return new Response(new Uint8Array(result.buffer), {
		headers: {
			"Content-Type": result.contentType,
			"Content-Disposition": `attachment; filename="${result.fileName.replace(/[^\x20-\x7E]|["\\]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(result.fileName)}`,
			"Content-Length": result.buffer.length.toString(),
		},
	})
}
