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

const { getAllDocuments, getDocumentById, createDocument, archiveDocument, unarchiveDocument } = await import(
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

	describe("archiveDocument / unarchiveDocument", () => {
		it("arkiverer dokumentet og skriver audit", async () => {
			const doc = await createDocument({
				title: "ToArchive",
				originalFileName: "arc.pdf",
				contentType: "application/pdf",
				sizeBytes: 10,
				bucketPath: "arc",
				uploadedBy: "u1",
			})

			const result = await archiveDocument(doc.id, "arkivar")
			expect(result?.id).toBe(doc.id)
			expect(result?.archivedAt).toBeInstanceOf(Date)
			expect(result?.archivedBy).toBe("arkivar")

			// Standardlisten skjuler arkiverte dokumenter
			const visible = await getAllDocuments()
			expect(visible.map((d) => d.id)).not.toContain(doc.id)

			// Med includeArchived skal det fortsatt være med
			const all = await getAllDocuments({ includeArchived: true })
			expect(all.map((d) => d.id)).toContain(doc.id)

			// getDocumentById returnerer arkiverte dokumenter (historiske lenker)
			const fetched = await getDocumentById(doc.id)
			expect(fetched?.id).toBe(doc.id)
			expect(fetched?.archivedAt).toBeInstanceOf(Date)

			const rows = await getAuditRows(doc.id)
			const archived = rows.find((r) => r.action === "document_archived")
			expect(archived?.performed_by).toBe("arkivar")
			expect(JSON.parse(archived?.previous_value ?? "{}")).toMatchObject({
				title: "ToArchive",
				fileName: "arc.pdf",
			})
		})

		it("er idempotent: re-arkivering skriver ikke nytt audit", async () => {
			const doc = await createDocument({
				title: "Idem",
				originalFileName: "i.pdf",
				contentType: "application/pdf",
				sizeBytes: 1,
				bucketPath: "i",
				uploadedBy: "u",
			})

			await archiveDocument(doc.id, "arkivar")
			await archiveDocument(doc.id, "arkivar")

			const rows = await getAuditRows(doc.id)
			const archived = rows.filter((r) => r.action === "document_archived")
			expect(archived).toHaveLength(1)
		})

		it("returnerer null for ukjent id", async () => {
			const r = await archiveDocument("00000000-0000-0000-0000-000000000000", "u")
			expect(r).toBeNull()
		})

		it("returnerer null for ukjent id (unarchive)", async () => {
			const r = await unarchiveDocument("00000000-0000-0000-0000-000000000000", "u")
			expect(r).toBeNull()
		})

		it("reaktiverer arkivert dokument og skriver audit", async () => {
			const doc = await createDocument({
				title: "Re",
				originalFileName: "r.pdf",
				contentType: "application/pdf",
				sizeBytes: 1,
				bucketPath: "r",
				uploadedBy: "u",
			})
			await archiveDocument(doc.id, "arkivar")
			const result = await unarchiveDocument(doc.id, "reaktivator")
			expect(result?.id).toBe(doc.id)
			expect(result?.archivedAt).toBeNull()
			expect(result?.archivedBy).toBeNull()

			const visible = await getAllDocuments()
			expect(visible.map((d) => d.id)).toContain(doc.id)

			const rows = await getAuditRows(doc.id)
			const unarchived = rows.find((r) => r.action === "document_unarchived")
			expect(unarchived?.performed_by).toBe("reaktivator")
		})

		it("er idempotent: re-aktivering skriver ikke nytt audit", async () => {
			const doc = await createDocument({
				title: "ReIdem",
				originalFileName: "ri.pdf",
				contentType: "application/pdf",
				sizeBytes: 1,
				bucketPath: "ri",
				uploadedBy: "u",
			})
			await archiveDocument(doc.id, "arkivar")
			await unarchiveDocument(doc.id, "u")
			await unarchiveDocument(doc.id, "u")

			const rows = await getAuditRows(doc.id)
			const unarchived = rows.filter((r) => r.action === "document_unarchived")
			expect(unarchived).toHaveLength(1)
		})
	})
})
