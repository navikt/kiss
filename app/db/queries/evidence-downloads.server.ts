import { desc, eq, getTableColumns, sql } from "drizzle-orm"
import { getStorageProvider } from "../../lib/storage/index.server"
import { db } from "../connection.server"
import { bucketObjects } from "../schema/buckets"
import {
	type EvidenceDownloadSource,
	type EvidenceProviderType,
	routineReviewEvidenceDownloads,
} from "../schema/routines"
import { writeAuditLog } from "./audit.server"

function sanitizePathSegment(value: string): string {
	return value.replace(/[^a-zA-Z0-9_-]/g, "_")
}

function getBucketName(): string {
	return process.env.GCS_BUCKET_NAME ?? "kiss-data-local"
}

function mapEvidenceSourceToBucketSourceType(source: EvidenceDownloadSource): "manual" | "automated" {
	return source === "manual_upload" ? "manual" : "automated"
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
}

function normalizeProviderMetadata(value: unknown): Record<string, unknown> {
	return isRecord(value) ? value : {}
}

function buildOracleProviderMetadata(params: {
	instanceId: string
	evidenceType: string
	apiInstanceName: string | null
	reviewProgressSnapshot?: unknown
}): Record<string, unknown> {
	return {
		instanceId: params.instanceId,
		evidenceType: params.evidenceType,
		apiInstanceName: params.apiInstanceName,
		reviewProgressSnapshot: params.reviewProgressSnapshot ?? null,
	}
}

function resolveProvider(params: {
	providerType?: EvidenceProviderType
	providerMetadata?: Record<string, unknown>
	instanceId: string
	evidenceType: string
	apiInstanceName: string | null
	reviewProgressSnapshot?: unknown
}): { providerType: EvidenceProviderType; providerMetadata: Record<string, unknown> } {
	return {
		providerType: params.providerType ?? "oracle",
		providerMetadata:
			params.providerMetadata ??
			buildOracleProviderMetadata({
				instanceId: params.instanceId,
				evidenceType: params.evidenceType,
				apiInstanceName: params.apiInstanceName,
				reviewProgressSnapshot: params.reviewProgressSnapshot,
			}),
	}
}

function buildEvidenceBucketPath(params: {
	activityId: string
	providerType: EvidenceProviderType
	format: string
	instanceId?: string
	evidenceType?: string
	fileName?: string
}): string {
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
	const prefix =
		params.providerType === "oracle" ? "oracle-evidence" : `${sanitizePathSegment(params.providerType)}-evidence`
	const segments = [prefix, params.activityId]

	if (params.instanceId) {
		segments.push(sanitizePathSegment(params.instanceId))
	}

	if (params.evidenceType) {
		segments.push(sanitizePathSegment(params.evidenceType))
	}

	if (params.fileName) {
		const safeFileName = params.fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200)
		return `${segments.join("/")}/${timestamp}-${safeFileName}`
	}

	const normalizedFormat = params.format.toLowerCase()
	const ext = normalizedFormat === "pdf" ? "pdf" : "xlsx"
	return `${segments.join("/")}/${timestamp}.${ext}`
}

type EvidenceDownloadRow = typeof routineReviewEvidenceDownloads.$inferSelect

function mapEvidenceDownloadRow(row: EvidenceDownloadRow): EvidenceDownloadRecord {
	return {
		id: row.id,
		activityId: row.activityId,
		bucketObjectId: row.bucketObjectId,
		providerType: row.providerType,
		providerMetadata: normalizeProviderMetadata(row.providerMetadata),
		format: row.format,
		fileName: row.fileName,
		source: row.source,
		collectedAt: row.collectedAt,
		forceFetchJustification: row.forceFetchJustification,
		performedBy: row.performedBy,
		performedAt: row.performedAt,
	}
}

function mapEvidenceDownloadWithBucketDetailsRow(
	row: EvidenceDownloadRow & { bucketPath: string; sizeBytes: number | null; contentType: string },
): EvidenceDownloadWithBucketDetails {
	return {
		...mapEvidenceDownloadRow(row),
		bucketPath: row.bucketPath,
		sizeBytes: row.sizeBytes,
		contentType: row.contentType,
	}
}

// ─── Types ────────────────────────────────────────────────────────────────

export interface EvidenceDownloadRecord {
	id: string
	activityId: string
	bucketObjectId: string
	providerType: EvidenceProviderType
	providerMetadata: Record<string, unknown>
	format: string
	fileName: string
	source: EvidenceDownloadSource
	collectedAt: Date | null
	forceFetchJustification: string | null
	performedBy: string
	performedAt: Date
}

export interface EvidenceDownloadWithBucketDetails extends EvidenceDownloadRecord {
	bucketPath: string
	sizeBytes: number | null
	contentType: string
}

// ─── Commands ─────────────────────────────────────────────────────────────

export async function recordEvidenceDownload(params: {
	activityId: string
	instanceId: string
	evidenceType: string
	providerType?: EvidenceProviderType
	providerMetadata?: Record<string, unknown>
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
	const { providerType, providerMetadata } = resolveProvider({
		providerType: params.providerType,
		providerMetadata: params.providerMetadata,
		instanceId: params.instanceId,
		evidenceType: params.evidenceType,
		apiInstanceName: params.apiInstanceName,
		reviewProgressSnapshot: params.reviewProgressSnapshot,
	})
	const bucketPath = buildEvidenceBucketPath({
		activityId: params.activityId,
		providerType,
		format: normalizedFormat,
		instanceId: params.instanceId,
		evidenceType: params.evidenceType,
	})

	const uploadResult = await storage.upload(bucketPath, params.buffer, { contentType: params.contentType })
	const uploadedPath = uploadResult.path

	let record: EvidenceDownloadRecord
	try {
		const isForced = !!params.forceFetchJustification
		const performedAt = new Date()
		const evidenceDownloadId = crypto.randomUUID()
		const bucketObjectId = crypto.randomUUID()

		record = await db.transaction(async (tx) => {
			await tx.insert(bucketObjects).values({
				id: bucketObjectId,
				bucketName: getBucketName(),
				objectPath: uploadResult.path,
				contentType: uploadResult.contentType,
				sizeBytes: uploadResult.sizeBytes,
				objectType: `${providerType}_evidence`,
				sourceType: mapEvidenceSourceToBucketSourceType("m2m_api"),
				uploadedBy: params.performedBy,
				uploadedAt: performedAt,
				metadata: JSON.stringify({
					activityId: params.activityId,
					evidenceDownloadId,
					providerType,
					fileName: params.fileName,
					providerMetadata,
				}),
			})

			const [row] = await tx
				.insert(routineReviewEvidenceDownloads)
				.values({
					id: evidenceDownloadId,
					activityId: params.activityId,
					bucketObjectId,
					providerType,
					providerMetadata,
					format: normalizedFormat,
					fileName: params.fileName,
					source: "m2m_api",
					collectedAt: params.collectedAt,
					forceFetchJustification: params.forceFetchJustification ?? null,
					performedBy: params.performedBy,
					performedAt,
				})
				.returning()

			await writeAuditLog(
				{
					action: isForced ? "evidence_force_downloaded" : "evidence_downloaded",
					entityType: "routine_review_evidence_download",
					entityId: row.id,
					newValue: JSON.stringify({
						providerType,
						instanceId: params.instanceId,
						evidenceType: params.evidenceType,
						format: normalizedFormat,
						source: "m2m_api",
						bucketObjectId,
						...(isForced ? { justification: params.forceFetchJustification } : {}),
					}),
					performedBy: params.performedBy,
				},
				tx,
			)

			return mapEvidenceDownloadRow(row)
		})
	} catch (err) {
		await storage.delete(uploadedPath).catch(() => {})
		throw err
	}

	return record
}

export async function recordManualEvidenceUpload(params: {
	activityId: string
	instanceId: string
	evidenceType: string
	providerType?: EvidenceProviderType
	providerMetadata?: Record<string, unknown>
	format: string
	buffer: Buffer
	fileName: string
	contentType: string
	performedBy: string
}): Promise<EvidenceDownloadRecord> {
	const storage = getStorageProvider()
	const normalizedFormat = params.format.toLowerCase()
	const { providerType, providerMetadata } = resolveProvider({
		providerType: params.providerType,
		providerMetadata: params.providerMetadata,
		instanceId: params.instanceId,
		evidenceType: params.evidenceType,
		apiInstanceName: null,
		reviewProgressSnapshot: null,
	})
	const bucketPath = buildEvidenceBucketPath({
		activityId: params.activityId,
		providerType,
		format: normalizedFormat,
		instanceId: params.instanceId,
		evidenceType: params.evidenceType,
		fileName: params.fileName,
	})

	const uploadResult = await storage.upload(bucketPath, params.buffer, { contentType: params.contentType })
	const uploadedPath = uploadResult.path

	let record: EvidenceDownloadRecord
	try {
		const performedAt = new Date()
		const evidenceDownloadId = crypto.randomUUID()
		const bucketObjectId = crypto.randomUUID()

		record = await db.transaction(async (tx) => {
			await tx.insert(bucketObjects).values({
				id: bucketObjectId,
				bucketName: getBucketName(),
				objectPath: uploadResult.path,
				contentType: uploadResult.contentType,
				sizeBytes: uploadResult.sizeBytes,
				objectType: `${providerType}_evidence`,
				sourceType: mapEvidenceSourceToBucketSourceType("manual_upload"),
				uploadedBy: params.performedBy,
				uploadedAt: performedAt,
				metadata: JSON.stringify({
					activityId: params.activityId,
					evidenceDownloadId,
					providerType,
					fileName: params.fileName,
					providerMetadata,
				}),
			})

			const [row] = await tx
				.insert(routineReviewEvidenceDownloads)
				.values({
					id: evidenceDownloadId,
					activityId: params.activityId,
					bucketObjectId,
					providerType,
					providerMetadata,
					format: normalizedFormat,
					fileName: params.fileName,
					source: "manual_upload",
					collectedAt: null,
					performedBy: params.performedBy,
					performedAt,
				})
				.returning()

			await writeAuditLog(
				{
					action: "evidence_uploaded",
					entityType: "routine_review_evidence_download",
					entityId: row.id,
					newValue: JSON.stringify({
						providerType,
						instanceId: params.instanceId,
						evidenceType: params.evidenceType,
						format: normalizedFormat,
						source: "manual_upload",
						fileName: params.fileName,
						bucketObjectId,
					}),
					performedBy: params.performedBy,
				},
				tx,
			)

			return mapEvidenceDownloadRow(row)
		})
	} catch (err) {
		await storage.delete(uploadedPath).catch(() => {})
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
	const rows = await db
		.select()
		.from(routineReviewEvidenceDownloads)
		.where(eq(routineReviewEvidenceDownloads.activityId, activityId))
		.orderBy(desc(routineReviewEvidenceDownloads.performedAt))

	return rows.map(mapEvidenceDownloadRow)
}

export async function getEvidenceDownloadsForActivityWithBucketDetails(
	activityId: string,
): Promise<EvidenceDownloadWithBucketDetails[]> {
	const rows = await db
		.select({
			...getTableColumns(routineReviewEvidenceDownloads),
			bucketPath: bucketObjects.objectPath,
			sizeBytes: bucketObjects.sizeBytes,
			contentType: bucketObjects.contentType,
		})
		.from(routineReviewEvidenceDownloads)
		.innerJoin(bucketObjects, eq(routineReviewEvidenceDownloads.bucketObjectId, bucketObjects.id))
		.where(eq(routineReviewEvidenceDownloads.activityId, activityId))
		.orderBy(desc(routineReviewEvidenceDownloads.performedAt))

	return rows.map(mapEvidenceDownloadWithBucketDetailsRow)
}

export async function getEvidenceDownload(downloadId: string): Promise<EvidenceDownloadRecord | null> {
	const [record] = await db
		.select()
		.from(routineReviewEvidenceDownloads)
		.where(eq(routineReviewEvidenceDownloads.id, downloadId))

	return record ? mapEvidenceDownloadRow(record) : null
}

async function getEvidenceDownloadWithBucketDetails(
	downloadId: string,
): Promise<EvidenceDownloadWithBucketDetails | null> {
	const [record] = await db
		.select({
			...getTableColumns(routineReviewEvidenceDownloads),
			bucketPath: bucketObjects.objectPath,
			sizeBytes: bucketObjects.sizeBytes,
			contentType: bucketObjects.contentType,
		})
		.from(routineReviewEvidenceDownloads)
		.innerJoin(bucketObjects, eq(routineReviewEvidenceDownloads.bucketObjectId, bucketObjects.id))
		.where(eq(routineReviewEvidenceDownloads.id, downloadId))

	return record ? mapEvidenceDownloadWithBucketDetailsRow(record) : null
}

export async function downloadEvidenceFileFromStorage(
	downloadId: string,
): Promise<{ buffer: Buffer; contentType: string; fileName: string } | null> {
	const record = await getEvidenceDownloadWithBucketDetails(downloadId)
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
