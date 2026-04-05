import { eq } from "drizzle-orm"
import type { LoaderFunctionArgs } from "react-router"
import { db } from "~/db/connection.server"
import { routineReviewAttachments } from "~/db/schema"
import { getStorageProvider } from "~/lib/storage/index.server"

export async function loader({ params }: LoaderFunctionArgs) {
	const vedleggId = params.vedleggId
	if (!vedleggId) throw new Response("Mangler vedlegg-ID", { status: 400 })

	const [attachment] = await db
		.select()
		.from(routineReviewAttachments)
		.where(eq(routineReviewAttachments.id, vedleggId))
		.limit(1)

	if (!attachment) throw new Response("Vedlegg ikke funnet", { status: 404 })

	const storage = getStorageProvider()
	const fileBuffer = await storage.download(attachment.bucketPath)

	return new Response(new Uint8Array(fileBuffer), {
		headers: {
			"Content-Type": attachment.contentType,
			"Content-Disposition": `inline; filename="${encodeURIComponent(attachment.fileName)}"`,
			"Content-Length": String(fileBuffer.length),
			"Cache-Control": "private, max-age=3600",
		},
	})
}
