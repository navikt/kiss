import { GcsStorageProvider } from "./gcs.server"
import { LocalStorageProvider } from "./local.server"
import type { StorageProvider } from "./types"

export type { StorageProvider, StorageResult, UploadOptions } from "./types"

let _provider: StorageProvider | undefined

/**
 * Returns the storage provider for the current environment.
 *
 * - `STORAGE_PROVIDER=local` → local filesystem (.local-storage/)
 * - `STORAGE_PROVIDER=gcs` → Google Cloud Storage
 * - Default: `local` in development, `gcs` in production
 */
export function getStorageProvider(): StorageProvider {
	if (_provider) return _provider

	const explicit = process.env.STORAGE_PROVIDER
	const isProduction = process.env.NODE_ENV === "production"
	const providerType = explicit ?? (isProduction ? "gcs" : "local")

	if (providerType === "gcs") {
		const bucketName = process.env.GCS_BUCKET_NAME
		if (!bucketName) {
			throw new Error("GCS_BUCKET_NAME environment variable is required when using GCS storage provider")
		}
		_provider = new GcsStorageProvider(bucketName)
	} else {
		_provider = new LocalStorageProvider()
	}

	return _provider
}

/** Reset the cached provider (useful for tests). */
export function resetStorageProvider(): void {
	_provider = undefined
}
