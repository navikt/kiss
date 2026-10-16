import { addFollowUpPointAttachment } from "~/db/queries/routines.server"
import type { FollowUpPointAttachmentKind } from "~/db/schema/routines"
import { getStorageProvider } from "~/lib/storage/index.server"

export const FOLLOW_UP_POINT_ATTACHMENT_MAX_SIZE_BYTES = 50 * 1024 * 1024

/**
 * Lagrer et vedlegg for et oppfølgingspunkt til bucket + database.
 * `kind` skiller om vedlegget hører til beskrivelsen eller oppsummeringen
 * (status-løsning) på punktet.
 */
export async function storeFollowUpPointAttachment(params: {
	file: File
	pointId: string
	routineId: string
	reviewId: string
	kind: FollowUpPointAttachmentKind
	uploadedBy: string
}) {
	const { file, pointId, routineId, reviewId, kind, uploadedBy } = params

	const arrayBuffer = await file.arrayBuffer()
	const buffer = Buffer.from(arrayBuffer)

	const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_")
	const bucketPath = `routines/${routineId}/reviews/${reviewId}/follow-up-points/${pointId}/${kind}/${crypto.randomUUID()}-${sanitizedName}`
	const contentType = file.type || "application/octet-stream"

	const storage = getStorageProvider()
	const uploadResult = await storage.upload(bucketPath, buffer, { contentType })

	const bucketName = process.env.GCS_BUCKET_NAME ?? "kiss-data-local"
	try {
		return await addFollowUpPointAttachment({
			pointId,
			kind,
			fileName: file.name,
			bucketPath: uploadResult.path,
			bucketName,
			contentType: uploadResult.contentType,
			sizeBytes: uploadResult.sizeBytes,
			uploadedBy,
		})
	} catch (databaseError) {
		try {
			await storage.delete(uploadResult.path)
		} catch (cleanupError) {
			throw new AggregateError(
				[databaseError, cleanupError],
				"Kunne ikke lagre vedlegget eller rydde opp etter opplastingen.",
			)
		}
		throw databaseError
	}
}
