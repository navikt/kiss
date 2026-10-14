import { db } from "../connection.server"
import { bucketObjects } from "../schema/buckets"
import type { DbExecutor } from "./audit.server"

export async function saveBucketObject(
	params: {
		bucketName: string
		objectPath: string
		contentType: string
		sizeBytes: number
		objectType: string
		uploadedBy: string
		metadata?: Record<string, string>
	},
	tx?: DbExecutor,
) {
	const executor = tx ?? db
	const [obj] = await executor
		.insert(bucketObjects)
		.values({
			...params,
			metadata: params.metadata ? JSON.stringify(params.metadata) : null,
		})
		.returning()
	return obj
}
