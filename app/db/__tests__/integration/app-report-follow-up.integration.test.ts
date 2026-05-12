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

// Mock storage so we can capture snapshot uploads and serve attachment downloads
const uploaded = new Map<string, Buffer>()
vi.mock("~/lib/storage/index.server", () => ({
	getStorageProvider: () => ({
		upload: async (path: string, data: Buffer) => {
			uploaded.set(path, data)
			return { bucketPath: path, sizeBytes: data.length }
		},
		download: async (path: string) => {
			const buf = uploaded.get(path)
			if (!buf) throw new Error(`No upload at ${path}`)
			return buf
		},
		delete: async () => {},
		exists: async (path: string) => uploaded.has(path),
	}),
	resetStorageProvider: () => {},
}))

const { generateAppComplianceReport } = await import("~/db/queries/reports.server")
const {
	createRoutine,
	createReview,
	completeReview,
	addFollowUpPoint,
	updateFollowUpPointDescription,
	updateFollowUpPointStatus,
	addFollowUpPointAttachment,
} = await import("~/db/queries/routines.server")

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

interface Snapshot {
	reviews: Array<{
		id: string
		title: string
		status: string
		followUpPoints: Array<{
			text: string
			description: string | null
			resolution: string | null
			status: string
			attachments: Array<{ fileName: string; kind: string; contentType: string; bucketPath: string }>
		}>
	}>
}

function readSnapshot(): Snapshot {
	const snapshotEntry = [...uploaded.entries()].find(([p]) => p.endsWith("snapshot.json"))
	if (!snapshotEntry) throw new Error("Snapshot not uploaded")
	return JSON.parse(snapshotEntry[1].toString("utf-8"))
}

describe("App compliance report — follow-up points", () => {
	beforeAll(async () => {
		await setupTestDatabase()
	})
	afterAll(async () => {
		await teardownTestDatabase()
	})
	beforeEach(async () => {
		uploaded.clear()
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

	it("includes both 'completed' and 'needs_follow_up' reviews in the snapshot", async () => {
		const sectionId = await createTestSection(`s-${Date.now()}`)
		const appId = await createTestApp("Test App")
		const routine = await createRoutine({
			sectionId,
			name: "Test rutine",
			description: null,
			frequency: "monthly",
			screeningQuestionId: null,
			screeningChoiceValue: null,
			appliesToAllInSection: false,
			responsibleRole: null,
			persistenceLinks: [],
			controlIds: [],
			technologyElementIds: [],
			createdBy: "test-user",
		})
		await approveRoutine(routine.id)

		const reviewA = await createReview({
			routineId: routine.id,
			applicationId: appId,
			title: "Fullført gjennomgang",
			summary: null,
			routineSnapshotPath: null,
			reviewedAt: new Date(),
			createdBy: "test-user",
			participants: [],
		})
		await completeReview(reviewA.id, "test-user")

		const reviewB = await createReview({
			routineId: routine.id,
			applicationId: appId,
			title: "Må følges opp",
			summary: null,
			routineSnapshotPath: null,
			reviewedAt: new Date(),
			createdBy: "test-user",
			participants: [],
		})
		await addFollowUpPoint({
			reviewId: reviewB.id,
			text: "Åpent punkt",
			description: "Beskrivelse",
			performedBy: "test-user",
		})
		await completeReview(reviewB.id, "test-user")

		await generateAppComplianceReport({ applicationId: appId, createdBy: "test-user" })

		const snap = readSnapshot()
		const titles = snap.reviews.map((r) => r.title).sort()
		expect(titles).toEqual(["Fullført gjennomgang", "Må følges opp"])
		const statuses = snap.reviews.map((r) => r.status).sort()
		expect(statuses).toEqual(["completed", "needs_follow_up"])
	})

	it("includes follow-up point details (text, description, resolution, status, attachments) in snapshot", async () => {
		const sectionId = await createTestSection(`s2-${Date.now()}`)
		const appId = await createTestApp("Test App 2")
		const routine = await createRoutine({
			sectionId,
			name: "R2",
			description: null,
			frequency: "monthly",
			screeningQuestionId: null,
			screeningChoiceValue: null,
			appliesToAllInSection: false,
			responsibleRole: null,
			persistenceLinks: [],
			controlIds: [],
			technologyElementIds: [],
			createdBy: "test-user",
		})
		await approveRoutine(routine.id)

		const review = await createReview({
			routineId: routine.id,
			applicationId: appId,
			title: "Med oppfølging",
			summary: null,
			routineSnapshotPath: null,
			reviewedAt: new Date(),
			createdBy: "test-user",
			participants: [],
		})
		const point = await addFollowUpPoint({
			reviewId: review.id,
			text: "Sjekk MFA",
			performedBy: "test-user",
		})
		await updateFollowUpPointDescription({
			pointId: point.id,
			expectedReviewId: review.id,
			description: "Mangler MFA på admin-konto",
			performedBy: "test-user",
		})

		// Pre-seed buffers for both attachment kinds so download() works during report generation
		uploaded.set("attachments/desc.pdf", Buffer.from("desc-data"))
		uploaded.set("attachments/res.pdf", Buffer.from("res-data"))

		await addFollowUpPointAttachment({
			pointId: point.id,
			kind: "description",
			fileName: "evidence.pdf",
			bucketPath: "attachments/desc.pdf",
			contentType: "application/pdf",
			sizeBytes: 9,
			uploadedBy: "test-user",
		})
		await addFollowUpPointAttachment({
			pointId: point.id,
			kind: "resolution",
			fileName: "fix.pdf",
			bucketPath: "attachments/res.pdf",
			contentType: "application/pdf",
			sizeBytes: 8,
			uploadedBy: "test-user",
		})

		await updateFollowUpPointStatus({
			pointId: point.id,
			expectedReviewId: review.id,
			status: "completed",
			resolution: "MFA aktivert på alle admin-kontoer",
			performedBy: "test-user",
		})
		await completeReview(review.id, "test-user")

		await generateAppComplianceReport({ applicationId: appId, createdBy: "test-user" })

		const snap = readSnapshot()
		expect(snap.reviews).toHaveLength(1)
		const fps = snap.reviews[0].followUpPoints
		expect(fps).toHaveLength(1)
		expect(fps[0].text).toBe("Sjekk MFA")
		expect(fps[0].description).toBe("Mangler MFA på admin-konto")
		expect(fps[0].resolution).toBe("MFA aktivert på alle admin-kontoer")
		expect(fps[0].status).toBe("completed")
		expect(fps[0].attachments).toHaveLength(2)
		const kinds = fps[0].attachments.map((a) => a.kind).sort()
		expect(kinds).toEqual(["description", "resolution"])
	})

	it("respects reviewIds filter while still allowing needs_follow_up reviews", async () => {
		const sectionId = await createTestSection(`s3-${Date.now()}`)
		const appId = await createTestApp("Test App 3")
		const routine = await createRoutine({
			sectionId,
			name: "R3",
			description: null,
			frequency: "monthly",
			screeningQuestionId: null,
			screeningChoiceValue: null,
			appliesToAllInSection: false,
			responsibleRole: null,
			persistenceLinks: [],
			controlIds: [],
			technologyElementIds: [],
			createdBy: "test-user",
		})
		await approveRoutine(routine.id)

		const completed = await createReview({
			routineId: routine.id,
			applicationId: appId,
			title: "Completed only",
			summary: null,
			routineSnapshotPath: null,
			reviewedAt: new Date(),
			createdBy: "test-user",
			participants: [],
		})
		await completeReview(completed.id, "test-user")

		const open = await createReview({
			routineId: routine.id,
			applicationId: appId,
			title: "Open follow-up",
			summary: null,
			routineSnapshotPath: null,
			reviewedAt: new Date(),
			createdBy: "test-user",
			participants: [],
		})
		await addFollowUpPoint({
			reviewId: open.id,
			text: "p",
			description: "Beskrivelse",
			performedBy: "test-user",
		})
		await completeReview(open.id, "test-user")

		await generateAppComplianceReport({
			applicationId: appId,
			createdBy: "test-user",
			reviewIds: [open.id],
		})

		const snap = readSnapshot()
		expect(snap.reviews).toHaveLength(1)
		expect(snap.reviews[0].title).toBe("Open follow-up")
		expect(snap.reviews[0].status).toBe("needs_follow_up")
	})
})
