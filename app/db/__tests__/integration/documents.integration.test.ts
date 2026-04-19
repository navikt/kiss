import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { getTestDb, setupTestDatabase, teardownTestDatabase } from "./setup"

vi.mock("~/db/connection.server", () => ({
	get db() {
		return getTestDb()
	},
	get pool() {
		return null
	},
}))

const { getAllDocuments, getDocumentById, createDocument, deleteDocument } = await import(
	"~/db/queries/documents.server"
)

async function getAuditRows(entityId: string) {
	const db = getTestDb()
	const r = await db.execute(
		/* sql */ `SELECT action, entity_type, entity_id, new_value, previous_value, performed_by FROM audit_log WHERE entity_id = '${entityId}' ORDER BY performed_at`,
	)
	return r.rows as Array<{
		action: string
		entity_type: string
		entity_id: string
		new_value: string | null
		previous_value: string | null
		performed_by: string
	}>
}

describe("documents.server integration tests", () => {
	beforeAll(async () => {
		await setupTestDatabase()
	}, 120_000)

	afterAll(async () => {
		await teardownTestDatabase()
	})

	beforeEach(async () => {
		const db = getTestDb()
		await db.execute(/* sql */ `DELETE FROM documents; DELETE FROM audit_log;`)
	})

	describe("createDocument", () => {
		it("inserts a document and returns it", async () => {
			const doc = await createDocument({
				title: "Risikoanalyse 2024",
				description: "Årlig risikoanalyse",
				originalFileName: "risiko.pdf",
				contentType: "application/pdf",
				sizeBytes: 1024,
				bucketPath: "documents/risiko.pdf",
				uploadedBy: "X1",
			})

			expect(doc).toBeDefined()
			expect(doc.title).toBe("Risikoanalyse 2024")
			expect(doc.originalFileName).toBe("risiko.pdf")
			expect(doc.bucketPath).toBe("documents/risiko.pdf")
		})

		it("writes an audit log entry on upload", async () => {
			const doc = await createDocument({
				title: "Audit doc",
				originalFileName: "audit.pdf",
				contentType: "application/pdf",
				sizeBytes: 99,
				bucketPath: "documents/audit.pdf",
				uploadedBy: "X-AUDIT",
			})

			const rows = await getAuditRows(doc.id)
			expect(rows).toHaveLength(1)
			expect(rows[0]).toMatchObject({
				action: "document_uploaded",
				entity_type: "document",
				performed_by: "X-AUDIT",
			})
			expect(JSON.parse(rows[0].new_value ?? "{}")).toMatchObject({
				title: "Audit doc",
				fileName: "audit.pdf",
			})
		})
	})

	describe("getAllDocuments / getDocumentById", () => {
		it("returns all documents ordered by uploadedAt desc", async () => {
			const a = await createDocument({
				title: "A",
				originalFileName: "a.pdf",
				contentType: "application/pdf",
				sizeBytes: 1,
				bucketPath: "a",
				uploadedBy: "u",
			})
			// Tiny delay to ensure deterministic ordering
			await new Promise((r) => setTimeout(r, 10))
			const b = await createDocument({
				title: "B",
				originalFileName: "b.pdf",
				contentType: "application/pdf",
				sizeBytes: 1,
				bucketPath: "b",
				uploadedBy: "u",
			})

			const all = await getAllDocuments()
			expect(all.map((d) => d.id)).toEqual([b.id, a.id])
		})

		it("returns null for unknown id", async () => {
			const doc = await getDocumentById("00000000-0000-0000-0000-000000000000")
			expect(doc).toBeNull()
		})
	})

	describe("deleteDocument", () => {
		it("removes the document and writes an audit entry", async () => {
			const doc = await createDocument({
				title: "ToDelete",
				originalFileName: "del.pdf",
				contentType: "application/pdf",
				sizeBytes: 10,
				bucketPath: "del",
				uploadedBy: "u1",
			})

			const result = await deleteDocument(doc.id, "deleter")
			expect(result?.id).toBe(doc.id)

			const after = await getDocumentById(doc.id)
			expect(after).toBeNull()

			const rows = await getAuditRows(doc.id)
			const actions = rows.map((r) => r.action)
			expect(actions).toContain("document_uploaded")
			expect(actions).toContain("document_deleted")

			const deleted = rows.find((r) => r.action === "document_deleted")
			expect(deleted?.performed_by).toBe("deleter")
			expect(JSON.parse(deleted?.previous_value ?? "{}")).toMatchObject({
				title: "ToDelete",
				fileName: "del.pdf",
			})
		})

		it("returns null when the document does not exist", async () => {
			const result = await deleteDocument("00000000-0000-0000-0000-000000000000", "u")
			expect(result).toBeNull()
		})
	})
})
