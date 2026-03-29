/** Storage provider abstraction for file storage (GCS buckets in prod, local filesystem in dev). */

export interface StorageResult {
	path: string
	sizeBytes: number
	contentType: string
}

export interface StorageProvider {
	/** Upload a file to storage. */
	upload(path: string, data: Buffer, options?: UploadOptions): Promise<StorageResult>

	/** Download a file from storage. */
	download(path: string): Promise<Buffer>

	/** Check if a file exists in storage. */
	exists(path: string): Promise<boolean>

	/** Delete a file from storage. */
	delete(path: string): Promise<void>

	/** List files matching a prefix. Returns relative paths. */
	list(prefix: string): Promise<string[]>
}

export interface UploadOptions {
	contentType?: string
	metadata?: Record<string, string>
}
