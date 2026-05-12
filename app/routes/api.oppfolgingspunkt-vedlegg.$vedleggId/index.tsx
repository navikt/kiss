import { eq } from "drizzle-orm"
import type { LoaderFunctionArgs } from "react-router"
import { db } from "~/db/connection.server"
import { routineReviewFollowUpPointAttachments } from "~/db/schema"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { getStorageProvider } from "~/lib/storage/index.server"

export async function loader({ params, request }: LoaderFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	requireUser(user)

	const vedleggId = params.vedleggId
	if (!vedleggId) throw new Response("Mangler vedlegg-ID", { status: 400 })

	const [attachment] = await db
		.select()
		.from(routineReviewFollowUpPointAttachments)
		.where(eq(routineReviewFollowUpPointAttachments.id, vedleggId))
		.limit(1)

	if (!attachment) throw new Response("Vedlegg ikke funnet", { status: 404 })

	const storage = getStorageProvider()
	const fileBuffer = await storage.download(attachment.bucketPath)

	const url = new URL(request.url)
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
