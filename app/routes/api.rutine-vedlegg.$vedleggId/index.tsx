import { eq } from "drizzle-orm"
import type { LoaderFunctionArgs } from "react-router"
import { db } from "~/db/connection.server"
import { getReviewScope } from "~/db/queries/routines.server"
import { routineReviewAttachments } from "~/db/schema"
import { requireAuthenticatedUser } from "~/lib/auth.server"
import { requireReviewReadAccess } from "~/lib/authorization.server"
import { getStorageProvider } from "~/lib/storage/index.server"

export async function loader({ params, request, url }: LoaderFunctionArgs) {
	const authedUser = await requireAuthenticatedUser(request)

	const vedleggId = params.vedleggId
	if (!vedleggId) throw new Response("Mangler vedlegg-ID", { status: 400 })

	const [attachment] = await db
		.select()
		.from(routineReviewAttachments)
		.where(eq(routineReviewAttachments.id, vedleggId))
		.limit(1)

	if (!attachment) throw new Response("Vedlegg ikke funnet", { status: 404 })

	const scope = await getReviewScope(attachment.reviewId)
	if (!scope) throw new Response("Vedlegg ikke funnet", { status: 404 })
	await requireReviewReadAccess(authedUser, scope)

	const storage = getStorageProvider()
	const fileBuffer = await storage.download(attachment.bucketPath)

	const forceDownload = url.searchParams.get("download") === "true"
	const disposition = forceDownload ? "attachment" : "inline"

	return new Response(new Uint8Array(fileBuffer), {
		headers: {
			"Content-Type": attachment.contentType,
			"Content-Disposition": `${disposition}; filename="${encodeURIComponent(attachment.fileName)}"`,
			"Content-Length": String(fileBuffer.length),
			"Cache-Control": "private, max-age=3600",
		},
	})
}
