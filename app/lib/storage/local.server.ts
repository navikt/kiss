import { existsSync } from "node:fs"
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { dirname, join, relative, resolve } from "node:path"
import { lookup } from "mime-types"
import type { StorageProvider, StorageResult, UploadOptions } from "./types"

const DEFAULT_BASE_DIR = resolve(process.cwd(), ".local-storage")

/**
 * Stores files on the local filesystem.
 * Drop-in replacement for GCS buckets during local development.
 */
export class LocalStorageProvider implements StorageProvider {
	private readonly baseDir: string

	constructor(baseDir?: string) {
		this.baseDir = baseDir ?? DEFAULT_BASE_DIR
	}

	async upload(path: string, data: Buffer, options?: UploadOptions): Promise<StorageResult> {
		const fullPath = this.resolve(path)
		await mkdir(dirname(fullPath), { recursive: true })
		await writeFile(fullPath, data)

		const contentType = options?.contentType ?? (lookup(path) || "application/octet-stream")

		if (options?.metadata) {
			const metaPath = `${fullPath}.__meta__.json`
			await writeFile(metaPath, JSON.stringify(options.metadata, null, "\t"))
		}

		return {
			path,
			sizeBytes: data.byteLength,
			contentType,
		}
	}

	async download(path: string): Promise<Buffer> {
		const fullPath = this.resolve(path)
		return readFile(fullPath)
	}

	async exists(path: string): Promise<boolean> {
		return existsSync(this.resolve(path))
	}

	async delete(path: string): Promise<void> {
		const fullPath = this.resolve(path)
		if (existsSync(fullPath)) {
			await rm(fullPath)
		}
		const metaPath = `${fullPath}.__meta__.json`
		if (existsSync(metaPath)) {
			await rm(metaPath)
		}
	}

	async list(prefix: string): Promise<string[]> {
		const dir = this.resolve(prefix)
		if (!existsSync(dir)) return []

		const dirStat = await stat(dir)
		if (!dirStat.isDirectory()) return [prefix]

		const entries = await readdir(dir, { recursive: true, withFileTypes: true })
		return entries
			.filter((e) => e.isFile() && !e.name.endsWith(".__meta__.json"))
			.map((e) => {
				const entryPath = join(e.parentPath, e.name)
				return relative(this.baseDir, entryPath)
			})
	}

	private resolve(path: string): string {
		return join(this.baseDir, path)
	}
}
