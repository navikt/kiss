import { saveBucketObject } from "~/db/queries/buckets.server"
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
	const bucketPath = `routines/${routineId}/reviews/${reviewId}/follow-up-points/${pointId}/${kind}/${Date.now()}-${sanitizedName}`
	const contentType = file.type || "application/octet-stream"

	const storage = getStorageProvider()
	const uploadResult = await storage.upload(bucketPath, buffer, { contentType })

	const bucketName = process.env.GCS_BUCKET_NAME ?? "kiss-data-local"
	await saveBucketObject({
		bucketName,
		objectPath: uploadResult.path,
		contentType: uploadResult.contentType,
		sizeBytes: uploadResult.sizeBytes,
		objectType: "routine-review-follow-up-point-attachment",
		uploadedBy,
		metadata: { originalFileName: file.name, pointId, reviewId, kind },
	})

	return addFollowUpPointAttachment({
		pointId,
		kind,
		fileName: file.name,
		bucketPath: uploadResult.path,
		contentType: uploadResult.contentType,
		sizeBytes: uploadResult.sizeBytes,
		uploadedBy,
	})
}
