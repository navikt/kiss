import { desc, eq, sql } from "drizzle-orm"
import { getStorageProvider } from "../../lib/storage/index.server"
import { db } from "../connection.server"
import { type EvidenceDownloadSource, routineReviewEvidenceDownloads } from "../schema/routines"
import { writeAuditLog } from "./audit.server"

function sanitizePathSegment(value: string): string {
	return value.replace(/[^a-zA-Z0-9_-]/g, "_")
}

// ─── Types ────────────────────────────────────────────────────────────────

export interface EvidenceDownloadRecord {
	id: string
	activityId: string
	instanceId: string
	evidenceType: string
	format: string
	bucketPath: string
	fileName: string
	sizeBytes: number | null
	contentType: string
	source: EvidenceDownloadSource
	collectedAt: Date | null
	apiInstanceName: string | null
	forceFetchJustification: string | null
	reviewProgressSnapshot: unknown
	performedBy: string
	performedAt: Date
}

// ─── Commands ─────────────────────────────────────────────────────────────

export async function recordEvidenceDownload(params: {
	activityId: string
	instanceId: string
	evidenceType: string
	format: string
	buffer: Buffer
	fileName: string
	contentType: string
	collectedAt: Date | null
	apiInstanceName: string | null
	forceFetchJustification?: string
	reviewProgressSnapshot?: unknown
	performedBy: string
}): Promise<EvidenceDownloadRecord> {
	const storage = getStorageProvider()
	const normalizedFormat = params.format.toLowerCase()
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
	const ext = normalizedFormat === "pdf" ? "pdf" : "xlsx"
	const bucketPath = `oracle-evidence/${params.activityId}/${sanitizePathSegment(params.instanceId)}/${sanitizePathSegment(params.evidenceType)}/${timestamp}.${ext}`

	await storage.upload(bucketPath, params.buffer, { contentType: params.contentType })

	let record: EvidenceDownloadRecord
	try {
		const isForced = !!params.forceFetchJustification
		record = await db.transaction(async (tx) => {
			const [row] = await tx
				.insert(routineReviewEvidenceDownloads)
				.values({
					activityId: params.activityId,
					instanceId: params.instanceId,
					evidenceType: params.evidenceType,
					format: normalizedFormat,
					bucketPath,
					fileName: params.fileName,
					sizeBytes: params.buffer.length,
					contentType: params.contentType,
					source: "m2m_api",
					collectedAt: params.collectedAt,
					apiInstanceName: params.apiInstanceName,
					forceFetchJustification: params.forceFetchJustification ?? null,
					reviewProgressSnapshot: params.reviewProgressSnapshot ?? null,
					performedBy: params.performedBy,
				})
				.returning()

			await writeAuditLog(
				{
					action: isForced ? "evidence_force_downloaded" : "evidence_downloaded",
					entityType: "routine_review_evidence_download",
					entityId: row.id,
					newValue: JSON.stringify({
						instanceId: params.instanceId,
						evidenceType: params.evidenceType,
						format: params.format.toLowerCase(),
						source: "m2m_api",
						...(isForced ? { justification: params.forceFetchJustification } : {}),
					}),
					performedBy: params.performedBy,
				},
				tx,
			)

			return row
		})
	} catch (err) {
		await storage.delete(bucketPath).catch(() => {})
		throw err
	}

	return record
}

export async function recordManualEvidenceUpload(params: {
	activityId: string
	instanceId: string
	evidenceType: string
	format: string
	buffer: Buffer
	fileName: string
	contentType: string
	performedBy: string
}): Promise<EvidenceDownloadRecord> {
	const storage = getStorageProvider()
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
	const safeFileName = params.fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200)
	const bucketPath = `oracle-evidence/${params.activityId}/${sanitizePathSegment(params.instanceId)}/${sanitizePathSegment(params.evidenceType)}/${timestamp}-${safeFileName}`

	await storage.upload(bucketPath, params.buffer, { contentType: params.contentType })

	let record: EvidenceDownloadRecord
	try {
		record = await db.transaction(async (tx) => {
			const [row] = await tx
				.insert(routineReviewEvidenceDownloads)
				.values({
					activityId: params.activityId,
					instanceId: params.instanceId,
					evidenceType: params.evidenceType,
					format: params.format.toLowerCase(),
					bucketPath,
					fileName: params.fileName,
					sizeBytes: params.buffer.length,
					contentType: params.contentType,
					source: "manual_upload",
					collectedAt: null,
					apiInstanceName: null,
					performedBy: params.performedBy,
				})
				.returning()

			await writeAuditLog(
				{
					action: "evidence_uploaded",
					entityType: "routine_review_evidence_download",
					entityId: row.id,
					newValue: JSON.stringify({
						instanceId: params.instanceId,
						evidenceType: params.evidenceType,
						format: params.format.toLowerCase(),
						source: "manual_upload",
						fileName: params.fileName,
					}),
					performedBy: params.performedBy,
				},
				tx,
			)

			return row
		})
	} catch (err) {
		await storage.delete(bucketPath).catch(() => {})
		throw err
	}

	return record
}

// ─── Queries ──────────────────────────────────────────────────────────────

export async function getSectionIdForActivity(activityId: string): Promise<string | null> {
	const result = await db.execute(sql`
		SELECT r.section_id
		FROM routine_review_activities a
		JOIN routine_reviews rv ON rv.id = a.review_id
		JOIN routines r ON r.id = rv.routine_id
		WHERE a.id = ${activityId}
	`)
	return (result.rows[0] as { section_id: string } | undefined)?.section_id ?? null
}

export interface ActivityContext {
	activityId: string
	activityType: string
	activityStatus: string
	reviewId: string
	reviewStatus: string
	routineId: string
	routineArchivedAt: string | null
	sectionId: string
	applicationId: string | null
}

export async function getActivityContext(activityId: string): Promise<ActivityContext | null> {
	const result = await db.execute(sql`
		SELECT
			a.id as activity_id,
			a.type as activity_type,
			a.status as activity_status,
			rv.id as review_id,
			rv.status as review_status,
			r.id as routine_id,
			r.archived_at as routine_archived_at,
			r.section_id as section_id,
			rv.application_id as application_id
		FROM routine_review_activities a
		JOIN routine_reviews rv ON rv.id = a.review_id
		JOIN routines r ON r.id = rv.routine_id
		WHERE a.id = ${activityId}
	`)
	const row = result.rows[0] as Record<string, unknown> | undefined
	if (!row) return null
	return {
		activityId: row.activity_id as string,
		activityType: row.activity_type as string,
		activityStatus: row.activity_status as string,
		reviewId: row.review_id as string,
		reviewStatus: row.review_status as string,
		routineId: row.routine_id as string,
		routineArchivedAt: row.routine_archived_at as string | null,
		sectionId: row.section_id as string,
		applicationId: row.application_id as string | null,
	}
}

export async function getSectionIdForDownload(downloadId: string): Promise<string | null> {
	const result = await db.execute(sql`
		SELECT r.section_id
		FROM routine_review_evidence_downloads d
		JOIN routine_review_activities a ON a.id = d.activity_id
		JOIN routine_reviews rv ON rv.id = a.review_id
		JOIN routines r ON r.id = rv.routine_id
		WHERE d.id = ${downloadId}
	`)
	return (result.rows[0] as { section_id: string } | undefined)?.section_id ?? null
}

export async function isInstanceConfiguredForApp(applicationId: string, instanceId: string): Promise<boolean> {
	const result = await db.execute(sql`
		SELECT 1
		FROM application_oracle_instances
		WHERE application_id = ${applicationId}
			AND instance_id = ${instanceId}
			AND archived_at IS NULL
		LIMIT 1
	`)
	return result.rows.length > 0
}

export async function getEvidenceDownloadsForActivity(activityId: string): Promise<EvidenceDownloadRecord[]> {
	return db
		.select()
		.from(routineReviewEvidenceDownloads)
		.where(eq(routineReviewEvidenceDownloads.activityId, activityId))
		.orderBy(desc(routineReviewEvidenceDownloads.performedAt))
}

export async function getEvidenceDownload(downloadId: string): Promise<EvidenceDownloadRecord | null> {
	const [record] = await db
		.select()
		.from(routineReviewEvidenceDownloads)
		.where(eq(routineReviewEvidenceDownloads.id, downloadId))

	return record ?? null
}

export async function downloadEvidenceFileFromStorage(
	downloadId: string,
): Promise<{ buffer: Buffer; contentType: string; fileName: string } | null> {
	const record = await getEvidenceDownload(downloadId)
	if (!record) return null

	const storage = getStorageProvider()
	let buffer: Buffer
	try {
		buffer = await storage.download(record.bucketPath)
	} catch {
		return null
	}

	return { buffer, contentType: record.contentType, fileName: record.fileName }
}
