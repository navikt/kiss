import { db } from "../connection.server"
import { bucketObjects } from "../schema/buckets"

export async function saveBucketObject(params: {
	bucketName: string
	objectPath: string
	contentType: string
	sizeBytes: number
	objectType: string
	uploadedBy: string
	metadata?: Record<string, string>
}) {
	const [obj] = await db
		.insert(bucketObjects)
		.values({
			...params,
			metadata: params.metadata ? JSON.stringify(params.metadata) : null,
		})
		.returning()
	return obj
}
