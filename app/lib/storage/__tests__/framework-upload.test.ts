import { existsSync } from "node:fs"
import { mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { LocalStorageProvider } from "../local.server"

describe("Framework import bucket storage", () => {
	let provider: LocalStorageProvider
	let testDir: string

	beforeEach(async () => {
		testDir = join(tmpdir(), `kiss-import-test-${Date.now()}`)
		await mkdir(testDir, { recursive: true })
		provider = new LocalStorageProvider(testDir)
	})

	afterEach(async () => {
		if (existsSync(testDir)) {
			await rm(testDir, { recursive: true })
		}
	})

	it("uploads an Excel file and stores it at the expected path", async () => {
		const fakeExcel = Buffer.from("PK\x03\x04fake-xlsx-content")
		const bucketPath = `framework-uploads/${Date.now()}-rammeverk.xlsx`
		const contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

		const result = await provider.upload(bucketPath, fakeExcel, { contentType })

		expect(result.path).toBe(bucketPath)
		expect(result.sizeBytes).toBe(fakeExcel.length)
		expect(result.contentType).toBe(contentType)
		expect(existsSync(join(testDir, bucketPath))).toBe(true)
	})

	it("can download the uploaded file and get identical content back", async () => {
		const content = Buffer.from("PK\x03\x04spreadsheet-bytes")
		const bucketPath = "framework-uploads/1234-test.xlsx"

		await provider.upload(bucketPath, content, {
			contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		})

		const downloaded = await provider.download(bucketPath)
		expect(downloaded).toEqual(content)
	})

	it("confirms the file exists after upload", async () => {
		const bucketPath = "framework-uploads/exists-check.xlsx"
		await provider.upload(bucketPath, Buffer.from("data"), {
			contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		})

		expect(await provider.exists(bucketPath)).toBe(true)
		expect(await provider.exists("framework-uploads/missing.xlsx")).toBe(false)
	})

	it("stores metadata in sidecar when provided", async () => {
		const bucketPath = "framework-uploads/with-meta.xlsx"
		await provider.upload(bucketPath, Buffer.from("data"), {
			contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			metadata: { originalFileName: "rammeverk.xlsx", uploadedBy: "Z990001" },
		})

		const metaPath = join(testDir, `${bucketPath}.__meta__.json`)
		expect(existsSync(metaPath)).toBe(true)
	})
})
