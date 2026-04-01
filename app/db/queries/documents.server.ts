import { desc, eq } from "drizzle-orm"
import { db } from "../connection.server"
import { auditLog } from "../schema/audit"
import { documents } from "../schema/documents"

export async function getAllDocuments() {
	return db.select().from(documents).orderBy(desc(documents.uploadedAt))
}

export async function getDocumentById(id: string) {
	const [doc] = await db.select().from(documents).where(eq(documents.id, id)).limit(1)
	return doc ?? null
}

export async function createDocument(params: {
	title: string
	description?: string
	originalFileName: string
	contentType: string
	sizeBytes: number
	bucketPath: string
	uploadedBy: string
}) {
	const [doc] = await db.insert(documents).values(params).returning()

	await db.insert(auditLog).values({
		action: "document_uploaded",
		entityType: "document",
		entityId: doc.id,
		newValue: JSON.stringify({ title: params.title, fileName: params.originalFileName }),
		performedBy: params.uploadedBy,
	})

	return doc
}

export async function deleteDocument(id: string, deletedBy: string) {
	const doc = await getDocumentById(id)
	if (!doc) return null

	await db.delete(documents).where(eq(documents.id, id))

	await db.insert(auditLog).values({
		action: "document_deleted",
		entityType: "document",
		entityId: id,
		previousValue: JSON.stringify({ title: doc.title, fileName: doc.originalFileName }),
		performedBy: deletedBy,
	})

	return doc
}
