import { Readable } from "node:stream"
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

// Zip-genereringen strømmer opplasting/nedlasting, så faket storage må støtte
// uploadStream/downloadStream (i motsetning til de bufrede upload/download-mockene
// brukt av app-compliance-testene).
const uploaded = new Map<string, Buffer>()
const deleted: string[] = []
vi.mock("~/lib/storage/index.server", () => ({
	getStorageProvider: () => ({
		upload: async (path: string, data: Buffer) => {
			uploaded.set(path, data)
			return { bucketPath: path, sizeBytes: data.length }
		},
		uploadStream: async (path: string, stream: NodeJS.ReadableStream) => {
			const chunks: Buffer[] = []
			for await (const chunk of stream) {
				chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
			}
			const data = Buffer.concat(chunks)
			uploaded.set(path, data)
			return { path, sizeBytes: data.length, contentType: "application/zip" }
		},
		download: async (path: string) => {
			const buf = uploaded.get(path)
			if (!buf) throw new Error(`No upload at ${path}`)
			return buf
		},
		downloadStream: (path: string) => {
			const buf = uploaded.get(path)
			if (!buf) throw new Error(`No upload at ${path}`)
			return Readable.from(buf)
		},
		delete: async (path: string) => {
			deleted.push(path)
			uploaded.delete(path)
		},
		exists: async (path: string) => uploaded.has(path),
	}),
	resetStorageProvider: () => {},
}))

// Lar oss simulere at DB-transaksjonen feiler etter at zip-en er lastet opp, for å teste
// at det foreldreløse zip-objektet ryddes opp (uten å måtte bryte selve reports-innsettingen).
let failNextAuditLog = false
vi.mock("~/db/queries/audit.server", async () => {
	const actual = await vi.importActual<typeof import("~/db/queries/audit.server")>("~/db/queries/audit.server")
	return {
		...actual,
		writeAuditLog: async (...args: Parameters<typeof actual.writeAuditLog>) => {
			if (failNextAuditLog) {
				failNextAuditLog = false
				throw new Error("Simulert transaksjonsfeil")
			}
			return actual.writeAuditLog(...args)
		},
	}
})

const { generateRoutineReviewReport } = await import("~/db/queries/reports.server")
const { createRoutine, createReview, completeReview } = await import("~/db/queries/routines.server")

async function createTestSection(slug: string) {
	const db = getTestDb()
	const result = await db.execute(
		/* sql */ `INSERT INTO sections (name, slug, created_by, updated_by) VALUES ('Sec ${slug}', '${slug}', 'test', 'test') RETURNING id`,
	)
	return (result.rows[0] as { id: string }).id
}

async function createTestApp(name: string) {
	const db = getTestDb()
	const result = await db.execute(
		/* sql */ `INSERT INTO monitored_applications (name, created_by, updated_by) VALUES ('${name}', 'test', 'test') RETURNING id`,
	)
	return (result.rows[0] as { id: string }).id
}

async function approveRoutine(routineId: string) {
	const db = getTestDb()
	await db.execute(/* sql */ `UPDATE routines SET status = 'approved', updated_by = 'test' WHERE id = '${routineId}'`)
}

async function getReportRow(reportId: string) {
	const db = getTestDb()
	const result = await db.execute(/* sql */ `SELECT * FROM reports WHERE id = '${reportId}'`)
	return result.rows[0] as { scope: string; scope_id: string; secondary_scope_id: string | null } | undefined
}

async function getAuditLogForReport(reportId: string) {
	const db = getTestDb()
	const result = await db.execute(
		/* sql */ `SELECT * FROM audit_log WHERE entity_type = 'report' AND entity_id = '${reportId}'`,
	)
	return result.rows as Array<{ action: string; metadata: unknown }>
}

describe("generateRoutineReviewReport", () => {
	beforeAll(async () => {
		await setupTestDatabase()
	})
	afterAll(async () => {
		await teardownTestDatabase()
	})
	beforeEach(async () => {
		uploaded.clear()
		deleted.length = 0
		const db = getTestDb()
		await db.execute(/* sql */ `TRUNCATE TABLE
			audit_log,
			bucket_objects,
			routine_review_follow_up_point_attachments,
			routine_review_follow_up_points,
			routine_review_links,
			routine_review_attachments,
			routine_review_participants,
			routine_review_activity_entra_changes,
			routine_review_activities,
			routine_reviews,
			routine_persistence_links,
			routine_group_classification_links,
			routine_oracle_role_criticality_links,
			routine_screening_questions,
			routine_controls,
			routine_technology_elements,
			routines,
			reports,
			application_environments,
			application_team_mappings,
			monitored_applications,
			sections
			RESTART IDENTITY CASCADE`)
	})

	it("throws when the routine has no reviews for the given application", async () => {
		const sectionId = await createTestSection(`s-${Date.now()}`)
		const appId = await createTestApp("App uten gjennomganger")
		const routine = await createRoutine({
			sectionId,
			name: "Rutine uten gjennomganger",
			description: null,
			frequency: "monthly",
			screeningQuestionId: null,
			screeningChoiceValue: null,
			appliesToAllInSection: false,
			responsibleRole: null,
			persistenceLinks: [],
			controlIds: [],
			technologyElementIds: [],
			createdBy: "Z990001",
		})
		await approveRoutine(routine.id)

		await expect(
			generateRoutineReviewReport({ routineId: routine.id, applicationId: appId, createdBy: "Z990001" }),
		).rejects.toThrow("Ingen gjennomganger funnet")
	})

	it("creates a reports row, writes an audit log entry and uploads the zip to storage", async () => {
		const sectionId = await createTestSection(`s2-${Date.now()}`)
		const appId = await createTestApp("Test App")
		const routine = await createRoutine({
			sectionId,
			name: "Test rutine",
			description: "Beskrivelse",
			frequency: "monthly",
			screeningQuestionId: null,
			screeningChoiceValue: null,
			appliesToAllInSection: false,
			responsibleRole: null,
			persistenceLinks: [],
			controlIds: [],
			technologyElementIds: [],
			createdBy: "Z990001",
		})
		await approveRoutine(routine.id)

		const review = await createReview({
			routineId: routine.id,
			applicationId: appId,
			title: "Gjennomgang 1",
			summary: null,
			routineSnapshotPath: null,
			reviewedAt: new Date(),
			createdBy: "Z990001",
			participants: [],
		})
		await completeReview(review.id, "Z990001")

		const result = await generateRoutineReviewReport({
			routineId: routine.id,
			applicationId: appId,
			createdBy: "Z990001",
		})

		expect(result.reportId).toMatch(/^[0-9a-f-]{36}$/)
		expect(result.reportBucketPath).toMatch(/^reports\/routine-review\//)
		expect(uploaded.has(result.reportBucketPath)).toBe(true)

		const reportRow = await getReportRow(result.reportId)
		expect(reportRow?.scope).toBe("routine_review")
		expect(reportRow?.scope_id).toBe(appId)
		expect(reportRow?.secondary_scope_id).toBe(routine.id)

		const auditRows = await getAuditLogForReport(result.reportId)
		expect(auditRows).toHaveLength(1)
		expect(auditRows[0].action).toBe("report_generated")
	})

	it("cleans up the uploaded zip if the database transaction fails after upload", async () => {
		const sectionId = await createTestSection(`s3-${Date.now()}`)
		const appId = await createTestApp("Test App feilende transaksjon")
		const routine = await createRoutine({
			sectionId,
			name: "Rutine feilende transaksjon",
			description: null,
			frequency: "monthly",
			screeningQuestionId: null,
			screeningChoiceValue: null,
			appliesToAllInSection: false,
			responsibleRole: null,
			persistenceLinks: [],
			controlIds: [],
			technologyElementIds: [],
			createdBy: "Z990001",
		})
		await approveRoutine(routine.id)

		const review = await createReview({
			routineId: routine.id,
			applicationId: appId,
			title: "Gjennomgang",
			summary: null,
			routineSnapshotPath: null,
			reviewedAt: new Date(),
			createdBy: "Z990001",
			participants: [],
		})
		await completeReview(review.id, "Z990001")

		failNextAuditLog = true
		await expect(
			generateRoutineReviewReport({ routineId: routine.id, applicationId: appId, createdBy: "Z990001" }),
		).rejects.toThrow("Simulert transaksjonsfeil")

		expect(deleted).toHaveLength(1)
		expect(uploaded.has(deleted[0])).toBe(false)
	})
})
