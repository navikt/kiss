import { and, desc, eq, isNotNull, isNull } from "drizzle-orm"
import { db } from "../connection.server"
import { documents } from "../schema/documents"
import { writeAuditLog } from "./audit.server"

export async function getAllDocuments(opts: { includeArchived?: boolean } = {}) {
	const conds = opts.includeArchived ? [] : [isNull(documents.archivedAt)]
	const query = db.select().from(documents)
	return (conds.length ? query.where(and(...conds)) : query).orderBy(desc(documents.uploadedAt))
}

/**
 * Hent dokument basert på id. Returnerer også arkiverte dokumenter — dette er
 * bevisst slik at historiske lenker (f.eks. i compliance-kommentarer) fortsatt
 * fungerer. Kallesteder som vil filtrere må sjekke `archivedAt` eksplisitt.
 */
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
	return db.transaction(async (tx) => {
		const [doc] = await tx.insert(documents).values(params).returning()
		await writeAuditLog(
			{
				action: "document_uploaded",
				entityType: "document",
				entityId: doc.id,
				newValue: JSON.stringify({ title: params.title, fileName: params.originalFileName }),
				performedBy: params.uploadedBy,
			},
			tx,
		)
		return doc
	})
}

/**
 * Arkiver et dokument (logisk sletting). GCS-blob-en bevares (Alt. A) slik at
 * historiske lenker fortsatt kan lastes ned, og slik at AGENTS.md regel 5
 * (data slettes aldri) overholdes. Atomisk guarded UPDATE i transaksjon —
 * idempotent: re-arkivering returnerer det allerede arkiverte dokumentet uten
 * audit-skriving.
 */
export async function archiveDocument(id: string, performedBy: string) {
	return db.transaction(async (tx) => {
		const [archived] = await tx
			.update(documents)
			.set({ archivedAt: new Date(), archivedBy: performedBy })
			.where(and(eq(documents.id, id), isNull(documents.archivedAt)))
			.returning()

		if (!archived) {
			// Allerede arkivert eller ikke funnet — sjekk hvilken
			const [existing] = await tx.select().from(documents).where(eq(documents.id, id)).limit(1)
			if (!existing) return null
			return existing
		}

		await writeAuditLog(
			{
				action: "document_archived",
				entityType: "document",
				entityId: id,
				previousValue: JSON.stringify({ title: archived.title, fileName: archived.originalFileName }),
				performedBy,
			},
			tx,
		)
		return archived
	})
}

/**
 * Reaktiver et arkivert dokument. Idempotent: re-aktivering av et aktivt
 * dokument returnerer det uten audit-skriving.
 */
export async function unarchiveDocument(id: string, performedBy: string) {
	return db.transaction(async (tx) => {
		const [unarchived] = await tx
			.update(documents)
			.set({ archivedAt: null, archivedBy: null })
			.where(and(eq(documents.id, id), isNotNull(documents.archivedAt)))
			.returning()

		if (!unarchived) {
			const [existing] = await tx.select().from(documents).where(eq(documents.id, id)).limit(1)
			if (!existing) return null
			return existing
		}

		await writeAuditLog(
			{
				action: "document_unarchived",
				entityType: "document",
				entityId: id,
				newValue: JSON.stringify({ title: unarchived.title, fileName: unarchived.originalFileName }),
				performedBy,
			},
			tx,
		)
		return unarchived
	})
}
