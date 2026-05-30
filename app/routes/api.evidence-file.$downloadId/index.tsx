import type { LoaderFunctionArgs } from "react-router"
import { data } from "react-router"
import { downloadEvidenceFileFromStorage, getSectionIdForDownload } from "~/db/queries/evidence-downloads.server"
import { requireAuthenticatedUser } from "~/lib/auth.server"
import { requireAnySectionRole } from "~/lib/authorization.server"
import { requireUuid } from "~/lib/utils"

export async function loader({ params, request }: LoaderFunctionArgs) {
	const authedUser = await requireAuthenticatedUser(request)

	const downloadId = requireUuid(params.downloadId, "downloadId")

	const sectionId = await getSectionIdForDownload(downloadId)
	if (!sectionId) {
		throw data({ error: "Fant ikke nedlastet fil" }, { status: 404 })
	}
	requireAnySectionRole(authedUser, sectionId)

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
