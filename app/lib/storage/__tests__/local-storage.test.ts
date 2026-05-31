import { existsSync } from "node:fs"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable } from "node:stream"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { LocalStorageProvider } from "../local.server"

describe("LocalStorageProvider", () => {
	let provider: LocalStorageProvider
	let testDir: string

	beforeEach(async () => {
		testDir = join(tmpdir(), `kiss-storage-test-${Date.now()}`)
		await mkdir(testDir, { recursive: true })
		provider = new LocalStorageProvider(testDir)
	})

	afterEach(async () => {
		if (existsSync(testDir)) {
			await rm(testDir, { recursive: true })
		}
	})

	describe("upload", () => {
		it("writes file to disk and returns metadata", async () => {
			const data = Buffer.from("hello world")
			const result = await provider.upload("docs/test.txt", data, { contentType: "text/plain" })

			expect(result.path).toBe("docs/test.txt")
			expect(result.sizeBytes).toBe(11)
			expect(result.contentType).toBe("text/plain")

			const onDisk = await readFile(join(testDir, "docs/test.txt"), "utf-8")
			expect(onDisk).toBe("hello world")
		})

		it("creates nested directories automatically", async () => {
			const data = Buffer.from("nested")
			await provider.upload("a/b/c/deep.txt", data)

			expect(existsSync(join(testDir, "a/b/c/deep.txt"))).toBe(true)
		})

		it("infers content type from extension", async () => {
			const data = Buffer.from("<html></html>")
			const result = await provider.upload("page.html", data)

			expect(result.contentType).toBe("text/html")
		})

		it("stores metadata in sidecar file", async () => {
			const data = Buffer.from("data")
			await provider.upload("file.bin", data, {
				metadata: { uploadedBy: "Z990001", version: "1.0" },
			})

			const metaPath = join(testDir, "file.bin.__meta__.json")
			expect(existsSync(metaPath)).toBe(true)

			const meta = JSON.parse(await readFile(metaPath, "utf-8"))
			expect(meta.uploadedBy).toBe("Z990001")
			expect(meta.version).toBe("1.0")
		})
	})

	describe("download", () => {
		it("reads file from disk", async () => {
			const filePath = join(testDir, "read-me.txt")
			await mkdir(join(testDir), { recursive: true })
			await writeFile(filePath, "file content")

			const result = await provider.download("read-me.txt")
			expect(result.toString()).toBe("file content")
		})

		it("throws on missing file", async () => {
			await expect(provider.download("nonexistent.txt")).rejects.toThrow()
		})
	})

	describe("exists", () => {
		it("returns true for existing file", async () => {
			await writeFile(join(testDir, "present.txt"), "yes")
			expect(await provider.exists("present.txt")).toBe(true)
		})

		it("returns false for missing file", async () => {
			expect(await provider.exists("absent.txt")).toBe(false)
		})
	})

	describe("delete", () => {
		it("removes file from disk", async () => {
			const filePath = join(testDir, "deleteme.txt")
			await writeFile(filePath, "gone")

			await provider.delete("deleteme.txt")
			expect(existsSync(filePath)).toBe(false)
		})

		it("removes metadata sidecar file", async () => {
			const filePath = join(testDir, "with-meta.bin")
			const metaPath = join(testDir, "with-meta.bin.__meta__.json")
			await writeFile(filePath, "data")
			await writeFile(metaPath, '{"key":"value"}')

			await provider.delete("with-meta.bin")
			expect(existsSync(filePath)).toBe(false)
			expect(existsSync(metaPath)).toBe(false)
		})

		it("does not throw on missing file", async () => {
			await expect(provider.delete("ghost.txt")).resolves.toBeUndefined()
		})
	})

	describe("uploadStream", () => {
		it("writes streamed data to disk and returns correct metadata", async () => {
			const content = "streamed content"
			const stream = Readable.from([Buffer.from(content)])
			const result = await provider.uploadStream("stream/test.txt", stream, { contentType: "text/plain" })

			expect(result.path).toBe("stream/test.txt")
			expect(result.sizeBytes).toBe(content.length)
			expect(result.contentType).toBe("text/plain")

			const onDisk = await readFile(join(testDir, "stream/test.txt"), "utf-8")
			expect(onDisk).toBe(content)
		})

		it("stores metadata sidecar file on streamed upload", async () => {
			const stream = Readable.from([Buffer.from("data")])
			await provider.uploadStream("stream/meta.bin", stream, {
				metadata: { uploadedBy: "test-user" },
			})

			const metaPath = join(testDir, "stream/meta.bin.__meta__.json")
			expect(existsSync(metaPath)).toBe(true)
			const meta = JSON.parse(await readFile(metaPath, "utf-8"))
			expect(meta.uploadedBy).toBe("test-user")
		})
	})

	describe("downloadStream", () => {
		it("streams the same bytes as download()", async () => {
			const content = "stream me"
			await writeFile(join(testDir, "streamable.txt"), content)

			const chunks: Buffer[] = []
			const stream = provider.downloadStream("streamable.txt")
			await new Promise<void>((resolve, reject) => {
				stream.on("data", (chunk: Buffer) => chunks.push(chunk))
				stream.on("end", resolve)
				stream.on("error", reject)
			})

			const streamed = Buffer.concat(chunks).toString("utf-8")
			const buffered = (await provider.download("streamable.txt")).toString("utf-8")
			expect(streamed).toBe(buffered)
			expect(streamed).toBe(content)
		})

		it("emits error for missing file", async () => {
			const stream = provider.downloadStream("nonexistent.txt")
			await expect(
				new Promise<void>((resolve, reject) => {
					stream.on("data", () => {})
					stream.on("end", resolve)
					stream.on("error", reject)
				}),
			).rejects.toThrow()
		})
	})

	describe("list", () => {
		it("lists files under a prefix", async () => {
			await mkdir(join(testDir, "uploads"), { recursive: true })
			await writeFile(join(testDir, "uploads/a.txt"), "a")
			await writeFile(join(testDir, "uploads/b.txt"), "b")

			const files = await provider.list("uploads")
			expect(files).toHaveLength(2)
			expect(files.sort()).toEqual(["uploads/a.txt", "uploads/b.txt"])
		})

		it("excludes metadata sidecar files from listing", async () => {
			await mkdir(join(testDir, "data"), { recursive: true })
			await writeFile(join(testDir, "data/file.bin"), "bin")
			await writeFile(join(testDir, "data/file.bin.__meta__.json"), "{}")

			const files = await provider.list("data")
			expect(files).toEqual(["data/file.bin"])
		})

		it("returns empty array for non-existent prefix", async () => {
			const files = await provider.list("nonexistent")
			expect(files).toEqual([])
		})

		it("lists nested files recursively", async () => {
			await mkdir(join(testDir, "deep/level1/level2"), { recursive: true })
			await writeFile(join(testDir, "deep/level1/a.txt"), "a")
			await writeFile(join(testDir, "deep/level1/level2/b.txt"), "b")

			const files = await provider.list("deep")
			expect(files.sort()).toEqual(["deep/level1/a.txt", "deep/level1/level2/b.txt"])
		})
	})
})
