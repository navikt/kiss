import { getDocumentById } from "~/db/queries/documents.server"
import { getStorageProvider } from "~/lib/storage/index.server"
import type { Route } from "./+types/index"

export async function loader({ params }: Route.LoaderArgs) {
	const dokumentId = params.dokumentId
	if (!dokumentId) throw new Response("Mangler dokumentId", { status: 400 })

	const doc = await getDocumentById(dokumentId)
	if (!doc) throw new Response("Dokument ikke funnet", { status: 404 })

	const storage = getStorageProvider()
	const fileBuffer = await storage.download(doc.bucketPath)

	return new Response(new Uint8Array(fileBuffer), {
		headers: {
			"Content-Type": doc.contentType,
			"Content-Disposition": `inline; filename="${encodeURIComponent(doc.originalFileName)}"`,
			"Content-Length": String(fileBuffer.length),
			"Cache-Control": "private, max-age=3600",
		},
	})
}
