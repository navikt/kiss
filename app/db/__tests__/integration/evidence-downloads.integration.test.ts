import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { getTestDb, getTestPool, setupTestDatabase, teardownTestDatabase } from "./setup"

vi.mock("~/db/connection.server", () => ({
	get db() {
		return getTestDb()
	},
	get pool() {
		return getTestPool()
	},
}))

// Mock storage provider
const mockStorage = {
	upload: vi.fn(async (path: string, data: Buffer, options?: { contentType?: string }) => ({
		path,
		sizeBytes: data.length,
		contentType: options?.contentType ?? "application/octet-stream",
	})),
	download: vi.fn().mockResolvedValue(Buffer.from("test-content")),
	delete: vi.fn().mockResolvedValue(undefined),
	exists: vi.fn().mockResolvedValue(true),
	list: vi.fn().mockResolvedValue([]),
}

vi.mock("~/lib/storage/index.server", () => ({
	getStorageProvider: () => mockStorage,
}))

// Import AFTER mocking
const {
	recordEvidenceDownload,
	recordManualEvidenceUpload,
	getEvidenceDownloadsForActivity,
	getEvidenceDownload,
	downloadEvidenceFileFromStorage,
} = await import("~/db/queries/evidence-downloads.server")

// ─── Helpers ─────────────────────────────────────────────────────────────

async function createTestSection() {
	const db = getTestDb()
	const result = await db.execute(
		/* sql */ `INSERT INTO sections (name, slug, created_by, updated_by) VALUES ('Test Section', 'test-section', 'test', 'test') RETURNING id`,
	)
	return (result.rows[0] as { id: string }).id
}

async function createTestApp() {
	const db = getTestDb()
	const result = await db.execute(
		/* sql */ `INSERT INTO monitored_applications (name, created_by, updated_by) VALUES ('test-app', 'test', 'test') RETURNING id`,
	)
	return (result.rows[0] as { id: string }).id
}

async function createTestRoutineAndReview(sectionId: string, appId: string) {
	const db = getTestDb()
	const routineResult = await db.execute(
		/* sql */ `INSERT INTO routines (name, section_id, frequency, activity_type, status, created_by, updated_by) VALUES ('Oracle Test', '${sectionId}', 'quarterly', 'oracle_evidence_audit', 'approved', 'test', 'test') RETURNING id`,
	)
	const routineId = (routineResult.rows[0] as { id: string }).id

	const reviewResult = await db.execute(
		/* sql */ `INSERT INTO routine_reviews (routine_id, application_id, title, status, summary, reviewed_at, created_by) VALUES ('${routineId}', '${appId}', 'Test Review', 'draft', 'Test', NOW(), 'test') RETURNING id`,
	)
	const reviewId = (reviewResult.rows[0] as { id: string }).id

	const activityResult = await db.execute(
		/* sql */ `INSERT INTO routine_review_activities (review_id, type, status, snapshot_before) VALUES ('${reviewId}', 'oracle_evidence_audit', 'pending', '{}') RETURNING id`,
	)
	const activityId = (activityResult.rows[0] as { id: string }).id

	return { routineId, reviewId, activityId }
}

// ─── Test Suite ──────────────────────────────────────────────────────────

describe("Evidence downloads integration tests", () => {
	beforeAll(async () => {
		await setupTestDatabase()
	})

	afterAll(async () => {
		await teardownTestDatabase()
	})

	beforeEach(async () => {
		const db = getTestDb()
		await db.execute(/* sql */ `
			DELETE FROM bucket_objects;
			DELETE FROM routine_review_evidence_downloads;
			DELETE FROM routine_review_activities;
			DELETE FROM routine_review_attachments;
			DELETE FROM routine_review_participants;
			DELETE FROM routine_reviews;
			DELETE FROM routine_controls;
			DELETE FROM routines;
			DELETE FROM monitored_applications;
			DELETE FROM sections;
		`)
		vi.clearAllMocks()
	})

	it("should record an M2M API evidence download", async () => {
		const sectionId = await createTestSection()
		const appId = await createTestApp()
		const { activityId } = await createTestRoutineAndReview(sectionId, appId)

		const record = await recordEvidenceDownload({
			activityId,
			instanceId: "PENSJON_PROD",
			evidenceType: "audit",
			format: "EXCEL",
			buffer: Buffer.from("test-excel-content"),
			fileName: "audit-report.xlsx",
			contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			collectedAt: new Date("2026-03-01T10:00:00Z"),
			apiInstanceName: "PENSJON_PROD",
			performedBy: "A123456",
		})

		expect(record.id).toBeDefined()
		expect(record.source).toBe("m2m_api")
		expect(record.instanceId).toBe("PENSJON_PROD")
		expect(record.evidenceType).toBe("audit")
		expect(record.format).toBe("excel")
		expect(record.fileName).toBe("audit-report.xlsx")
		expect(record.sizeBytes).toBe(18)
		expect(record.forceFetchJustification).toBeNull()

		expect(mockStorage.upload).toHaveBeenCalledOnce()
		const uploadPath = mockStorage.upload.mock.calls[0][0] as string
		expect(uploadPath).toContain("oracle-evidence/")
		expect(uploadPath).toContain(activityId)

		const bucketObjectsResult = await getTestDb().execute(/* sql */ `
			SELECT object_path, object_type, source_type, uploaded_by
			FROM bucket_objects
		`)
		const bucketObject = bucketObjectsResult.rows[0] as {
			object_path: string
			object_type: string
			source_type: string
			uploaded_by: string
		}
		expect(bucketObjectsResult.rows).toHaveLength(1)
		expect(bucketObject.object_path).toBe(record.bucketPath)
		expect(bucketObject.object_type).toBe("oracle_evidence")
		expect(bucketObject.source_type).toBe("automated")
		expect(bucketObject.uploaded_by).toBe("A123456")
	})

	it("should record a force-fetched download with justification", async () => {
		const sectionId = await createTestSection()
		const appId = await createTestApp()
		const { activityId } = await createTestRoutineAndReview(sectionId, appId)

		const record = await recordEvidenceDownload({
			activityId,
			instanceId: "PENSJON_PROD",
			evidenceType: "audit",
			format: "PDF",
			buffer: Buffer.from("pdf-content"),
			fileName: "audit-report.pdf",
			contentType: "application/pdf",
			collectedAt: null,
			apiInstanceName: "PENSJON_PROD",
			forceFetchJustification: "Gjennomgang ikke ferdig, henter bevis for fremdrift",
			reviewProgressSnapshot: { totalStatements: 100, reviewedStatements: 50 },
			performedBy: "A123456",
		})

		expect(record.source).toBe("m2m_api")
		expect(record.forceFetchJustification).toBe("Gjennomgang ikke ferdig, henter bevis for fremdrift")
		expect(record.reviewProgressSnapshot).toEqual({ totalStatements: 100, reviewedStatements: 50 })
	})

	it("should record a manual evidence upload", async () => {
		const sectionId = await createTestSection()
		const appId = await createTestApp()
		const { activityId } = await createTestRoutineAndReview(sectionId, appId)

		const record = await recordManualEvidenceUpload({
			activityId,
			instanceId: "PENSJON_PROD",
			evidenceType: "audit",
			format: "PDF",
			buffer: Buffer.from("manual-pdf"),
			fileName: "manuell-rapport.pdf",
			contentType: "application/pdf",
			performedBy: "B654321",
		})

		expect(record.source).toBe("manual_upload")
		expect(record.fileName).toBe("manuell-rapport.pdf")
		expect(record.apiInstanceName).toBeNull()
		expect(record.collectedAt).toBeNull()

		const bucketObjectsResult = await getTestDb().execute(/* sql */ `
			SELECT object_path, object_type, source_type, uploaded_by
			FROM bucket_objects
		`)
		const bucketObject = bucketObjectsResult.rows[0] as {
			object_path: string
			object_type: string
			source_type: string
			uploaded_by: string
		}
		expect(bucketObjectsResult.rows).toHaveLength(1)
		expect(bucketObject.object_path).toBe(record.bucketPath)
		expect(bucketObject.object_type).toBe("oracle_evidence")
		expect(bucketObject.source_type).toBe("manual")
		expect(bucketObject.uploaded_by).toBe("B654321")
	})

	it("should list evidence downloads for an activity ordered by date desc", async () => {
		const sectionId = await createTestSection()
		const appId = await createTestApp()
		const { activityId } = await createTestRoutineAndReview(sectionId, appId)

		await recordManualEvidenceUpload({
			activityId,
			instanceId: "PENSJON_PROD",
			evidenceType: "audit",
			format: "PDF",
			buffer: Buffer.from("first"),
			fileName: "first.pdf",
			contentType: "application/pdf",
			performedBy: "test",
		})

		await recordEvidenceDownload({
			activityId,
			instanceId: "PENSJON_PROD",
			evidenceType: "audit",
			format: "EXCEL",
			buffer: Buffer.from("second"),
			fileName: "second.xlsx",
			contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			collectedAt: new Date("2026-03-02T10:00:00Z"),
			apiInstanceName: "PENSJON_PROD",
			performedBy: "test",
		})

		const downloads = await getEvidenceDownloadsForActivity(activityId)
		expect(downloads).toHaveLength(2)
		// Most recent first
		expect(downloads[0].fileName).toBe("second.xlsx")
		expect(downloads[1].fileName).toBe("first.pdf")
	})

	it("should get a single evidence download by ID", async () => {
		const sectionId = await createTestSection()
		const appId = await createTestApp()
		const { activityId } = await createTestRoutineAndReview(sectionId, appId)

		const created = await recordManualEvidenceUpload({
			activityId,
			instanceId: "PENSJON_PROD",
			evidenceType: "audit",
			format: "PDF",
			buffer: Buffer.from("content"),
			fileName: "test.pdf",
			contentType: "application/pdf",
			performedBy: "test",
		})

		const found = await getEvidenceDownload(created.id)
		expect(found).not.toBeNull()
		expect(found?.id).toBe(created.id)
		expect(found?.fileName).toBe("test.pdf")
	})

	it("should return null for non-existent download ID", async () => {
		const result = await getEvidenceDownload("00000000-0000-0000-0000-000000000000")
		expect(result).toBeNull()
	})

	it("should download evidence file from storage", async () => {
		const sectionId = await createTestSection()
		const appId = await createTestApp()
		const { activityId } = await createTestRoutineAndReview(sectionId, appId)

		const created = await recordManualEvidenceUpload({
			activityId,
			instanceId: "PENSJON_PROD",
			evidenceType: "audit",
			format: "PDF",
			buffer: Buffer.from("stored-content"),
			fileName: "download-me.pdf",
			contentType: "application/pdf",
			performedBy: "test",
		})

		const result = await downloadEvidenceFileFromStorage(created.id)
		expect(result).not.toBeNull()
		expect(result?.fileName).toBe("download-me.pdf")
		expect(result?.contentType).toBe("application/pdf")
		expect(mockStorage.download).toHaveBeenCalledWith(created.bucketPath)
	})

	it("should return null when downloading non-existent evidence file", async () => {
		const result = await downloadEvidenceFileFromStorage("00000000-0000-0000-0000-000000000000")
		expect(result).toBeNull()
	})
})
