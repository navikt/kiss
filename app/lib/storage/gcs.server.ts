import type { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { Storage } from "@google-cloud/storage"
import type { StorageProvider, StorageResult, UploadOptions } from "./types"

/**
 * Stores files in Google Cloud Storage (GCS) buckets.
 * Used in Nais production/dev environments.
 */
export class GcsStorageProvider implements StorageProvider {
	private readonly storage: Storage
	private readonly bucketName: string

	constructor(bucketName: string) {
		this.storage = new Storage()
		this.bucketName = bucketName
	}

	async upload(path: string, data: Buffer, options?: UploadOptions): Promise<StorageResult> {
		const bucket = this.storage.bucket(this.bucketName)
		const file = bucket.file(path)

		await file.save(data, {
			contentType: options?.contentType ?? "application/octet-stream",
			metadata: options?.metadata ? { metadata: options.metadata } : undefined,
		})

		const [metadata] = await file.getMetadata()

		return {
			path,
			sizeBytes: Number(metadata.size ?? data.byteLength),
			contentType: metadata.contentType ?? "application/octet-stream",
		}
	}

	async uploadStream(path: string, stream: Readable, options?: UploadOptions): Promise<StorageResult> {
		const bucket = this.storage.bucket(this.bucketName)
		const file = bucket.file(path)
		const writeStream = file.createWriteStream({
			contentType: options?.contentType ?? "application/octet-stream",
			metadata: options?.metadata ? { metadata: options.metadata } : undefined,
		})
		await pipeline(stream, writeStream)
		const [metadata] = await file.getMetadata()
		return {
			path,
			sizeBytes: Number(metadata.size ?? 0),
			contentType: metadata.contentType ?? "application/octet-stream",
		}
	}

	async download(path: string): Promise<Buffer> {
		const bucket = this.storage.bucket(this.bucketName)
		const [contents] = await bucket.file(path).download()
		return contents
	}

	downloadStream(path: string): Readable {
		return this.storage.bucket(this.bucketName).file(path).createReadStream()
	}

	async exists(path: string): Promise<boolean> {
		const bucket = this.storage.bucket(this.bucketName)
		const [exists] = await bucket.file(path).exists()
		return exists
	}

	async delete(path: string): Promise<void> {
		const bucket = this.storage.bucket(this.bucketName)
		await bucket.file(path).delete({ ignoreNotFound: true })
	}

	async list(prefix: string): Promise<string[]> {
		const bucket = this.storage.bucket(this.bucketName)
		const [files] = await bucket.getFiles({ prefix })
		return files.map((f) => f.name)
	}
}
