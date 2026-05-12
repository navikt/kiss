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

const {
	createRoutine,
	createReview,
	completeReview,
	discardReview,
	addFollowUpPoint,
	updateFollowUpPointStatus,
	updateFollowUpPointText,
	updateFollowUpPointDescription,
	deleteFollowUpPoint,
	getReview,
	getLatestNonDiscardedReviewForApp,
	getLatestNonDiscardedSectionReview,
} = await import("~/db/queries/routines.server")

async function createTestSection(name: string, slug: string) {
	const db = getTestDb()
	const result = await db.execute(
		/* sql */ `INSERT INTO sections (name, slug, created_by, updated_by) VALUES ('${name}', '${slug}', 'test', 'test') RETURNING id`,
	)
	return (result.rows[0] as { id: string }).id
}

async function markRoutineApproved(routineId: string) {
	const db = getTestDb()
	await db.execute(/* sql */ `UPDATE routines SET status = 'approved', updated_by = 'test' WHERE id = '${routineId}'`)
}

async function newDraftReview() {
	const sectionId = await createTestSection(
		`Sec-${Math.random().toString(36).slice(2)}`,
		`sec-${Date.now()}-${Math.random()}`,
	)
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
	await markRoutineApproved(routine.id)
	const review = await createReview({
		routineId: routine.id,
		applicationId: null,
		title: "Test gjennomgang",
		summary: null,
		routineSnapshotPath: null,
		reviewedAt: new Date(),
		createdBy: "test-user",
		participants: [],
	})
	return { routine, review }
}

describe("Review follow-up points integration tests", () => {
	beforeAll(async () => {
		await setupTestDatabase()
	})
	afterAll(async () => {
		await teardownTestDatabase()
	})
	beforeEach(async () => {
		const db = getTestDb()
		await db.execute(/* sql */ `TRUNCATE TABLE
			audit_log,
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
			monitored_applications,
			sections
			RESTART IDENTITY CASCADE`)
	})

	it("completes review as 'completed' when there are no follow-ups", async () => {
		const { review } = await newDraftReview()
		const updated = await completeReview(review.id, "test-user")
		expect(updated?.status).toBe("completed")
	})

	it("completes review as 'needs_follow_up' when there are unresolved points", async () => {
		const { review } = await newDraftReview()
		await addFollowUpPoint({
			reviewId: review.id,
			text: "Sjekk konfig",
			description: "Beskrivelse",
			performedBy: "test-user",
		})
		const updated = await completeReview(review.id, "test-user")
		expect(updated?.status).toBe("needs_follow_up")
		expect(updated?.followUpPoints).toHaveLength(1)
		expect(updated?.followUpPoints[0].status).toBe("needs_follow_up")
	})

	it("transitions review back to 'completed' when all points become resolved", async () => {
		const { review } = await newDraftReview()
		const p1 = await addFollowUpPoint({
			reviewId: review.id,
			text: "P1",
			description: "Beskrivelse",
			performedBy: "test-user",
		})
		const p2 = await addFollowUpPoint({
			reviewId: review.id,
			text: "P2",
			description: "Beskrivelse",
			performedBy: "test-user",
		})
		await completeReview(review.id, "test-user")

		await updateFollowUpPointStatus({
			pointId: p1.id,
			expectedReviewId: review.id,
			status: "completed",
			performedBy: "test-user",
		})
		const stillNeedsFollowUp = await getReview(review.id)
		expect(stillNeedsFollowUp?.status).toBe("needs_follow_up")

		await updateFollowUpPointStatus({
			pointId: p2.id,
			expectedReviewId: review.id,
			status: "not_relevant",
			performedBy: "test-user",
		})
		const fullyDone = await getReview(review.id)
		expect(fullyDone?.status).toBe("completed")
	})

	it("transitions completed review back to 'needs_follow_up' when a new point is added", async () => {
		const { review } = await newDraftReview()
		const completed = await completeReview(review.id, "test-user")
		expect(completed?.status).toBe("completed")

		await addFollowUpPoint({ reviewId: review.id, text: "Nytt funn", performedBy: "test-user" })
		const reopened = await getReview(review.id)
		expect(reopened?.status).toBe("needs_follow_up")
	})

	it("re-opens needs_follow_up by reverting a resolved point back to needs_follow_up", async () => {
		const { review } = await newDraftReview()
		const p1 = await addFollowUpPoint({
			reviewId: review.id,
			text: "P1",
			description: "Beskrivelse",
			performedBy: "test-user",
		})
		await completeReview(review.id, "test-user")
		await updateFollowUpPointStatus({
			pointId: p1.id,
			expectedReviewId: review.id,
			status: "completed",
			performedBy: "test-user",
		})
		const done = await getReview(review.id)
		expect(done?.status).toBe("completed")

		await updateFollowUpPointStatus({
			pointId: p1.id,
			expectedReviewId: review.id,
			status: "needs_follow_up",
			performedBy: "test-user",
		})
		const reopened = await getReview(review.id)
		expect(reopened?.status).toBe("needs_follow_up")
	})

	it("rejects updating text when review is not draft", async () => {
		const { review } = await newDraftReview()
		const p1 = await addFollowUpPoint({
			reviewId: review.id,
			text: "Original",
			description: "Beskrivelse",
			performedBy: "test-user",
		})
		await completeReview(review.id, "test-user")

		await expect(
			updateFollowUpPointText({
				pointId: p1.id,
				expectedReviewId: review.id,
				text: "Endret",
				performedBy: "test-user",
			}),
		).rejects.toBeInstanceOf(Response)
	})

	it("rejects deleting a follow-up when review is not draft", async () => {
		const { review } = await newDraftReview()
		const p1 = await addFollowUpPoint({
			reviewId: review.id,
			text: "Tag",
			description: "Beskrivelse",
			performedBy: "test-user",
		})
		await completeReview(review.id, "test-user")

		await expect(
			deleteFollowUpPoint({
				pointId: p1.id,
				expectedReviewId: review.id,
				performedBy: "test-user",
			}),
		).rejects.toBeInstanceOf(Response)
	})

	it("allows editing text and deleting while still draft", async () => {
		const { review } = await newDraftReview()
		const p1 = await addFollowUpPoint({ reviewId: review.id, text: "Tag", performedBy: "test-user" })
		const updated = await updateFollowUpPointText({
			pointId: p1.id,
			expectedReviewId: review.id,
			text: "Tag oppdatert",
			performedBy: "test-user",
		})
		expect(updated?.text).toBe("Tag oppdatert")
		await deleteFollowUpPoint({ pointId: p1.id, expectedReviewId: review.id, performedBy: "test-user" })
		const reviewAfter = await getReview(review.id)
		expect(reviewAfter?.followUpPoints).toHaveLength(0)
	})

	it("blocks completing review when any follow-up point lacks a description", async () => {
		const { review } = await newDraftReview()
		await addFollowUpPoint({
			reviewId: review.id,
			text: "Med beskrivelse",
			description: "Detaljer",
			performedBy: "test-user",
		})
		await addFollowUpPoint({
			reviewId: review.id,
			text: "Uten beskrivelse",
			performedBy: "test-user",
		})

		await expect(completeReview(review.id, "test-user")).rejects.toBeInstanceOf(Response)

		const stillDraft = await getReview(review.id)
		expect(stillDraft?.status).toBe("draft")

		await updateFollowUpPointDescription({
			pointId: stillDraft?.followUpPoints.find((p) => p.text === "Uten beskrivelse")?.id ?? "",
			expectedReviewId: review.id,
			description: "Nå har den beskrivelse",
			performedBy: "test-user",
		})

		const updated = await completeReview(review.id, "test-user")
		expect(updated?.status).toBe("needs_follow_up")
	})

	it("blocks completing review when description is only whitespace", async () => {
		const { review } = await newDraftReview()
		await addFollowUpPoint({
			reviewId: review.id,
			text: "Whitespace-bare",
			description: "   ",
			performedBy: "test-user",
		})

		await expect(completeReview(review.id, "test-user")).rejects.toBeInstanceOf(Response)
	})

	it("writes audit log entries for follow-up actions", async () => {
		const { review } = await newDraftReview()
		const p1 = await addFollowUpPoint({ reviewId: review.id, text: "Audit", performedBy: "test-user" })
		await updateFollowUpPointStatus({
			pointId: p1.id,
			expectedReviewId: review.id,
			status: "completed",
			performedBy: "test-user",
		})

		const db = getTestDb()
		const audits = await db.execute(
			/* sql */ `SELECT action FROM audit_log WHERE entity_type = 'review_follow_up_point' ORDER BY performed_at`,
		)
		const actions = audits.rows.map((r) => (r as { action: string }).action)
		expect(actions).toContain("review_follow_up_added")
		expect(actions).toContain("review_follow_up_status_changed")
	})

	it("supports adding a description with a follow-up and editing it later", async () => {
		const { review } = await newDraftReview()
		const p1 = await addFollowUpPoint({
			reviewId: review.id,
			text: "Konfigurer alarm",
			description: "Sett opp alarm i Grafana for når kø > 1000",
			performedBy: "test-user",
		})
		expect(p1.description).toBe("Sett opp alarm i Grafana for når kø > 1000")

		const updated = await updateFollowUpPointDescription({
			pointId: p1.id,
			expectedReviewId: review.id,
			description: "Oppdatert beskrivelse",
			performedBy: "test-user",
		})
		expect(updated?.description).toBe("Oppdatert beskrivelse")

		const cleared = await updateFollowUpPointDescription({
			pointId: p1.id,
			expectedReviewId: review.id,
			description: "   ",
			performedBy: "test-user",
		})
		expect(cleared?.description).toBeNull()
	})

	it("blocks editing description once review is completed (needs_follow_up or completed)", async () => {
		const { review } = await newDraftReview()
		const p1 = await addFollowUpPoint({
			reviewId: review.id,
			text: "Punkt",
			description: "Innledende beskrivelse",
			performedBy: "test-user",
		})
		await completeReview(review.id, "test-user")
		const reviewMid = await getReview(review.id)
		expect(reviewMid?.status).toBe("needs_follow_up")

		await expect(
			updateFollowUpPointDescription({
				pointId: p1.id,
				expectedReviewId: review.id,
				description: "Skal ikke tillates etter fullføring",
				performedBy: "test-user",
			}),
		).rejects.toBeInstanceOf(Response)

		await updateFollowUpPointStatus({
			pointId: p1.id,
			expectedReviewId: review.id,
			status: "completed",
			performedBy: "test-user",
		})
		const reviewDone = await getReview(review.id)
		expect(reviewDone?.status).toBe("completed")

		await expect(
			updateFollowUpPointDescription({
				pointId: p1.id,
				expectedReviewId: review.id,
				description: "For sent",
				performedBy: "test-user",
			}),
		).rejects.toBeInstanceOf(Response)
	})

	it("can update status together with oppsummering", async () => {
		const { review } = await newDraftReview()
		const p1 = await addFollowUpPoint({ reviewId: review.id, text: "Pkt", performedBy: "test-user" })
		await updateFollowUpPointStatus({
			pointId: p1.id,
			expectedReviewId: review.id,
			status: "completed",
			resolution: "Fikset i PR #42",
			performedBy: "test-user",
		})
		const reviewAfter = await getReview(review.id)
		const point = reviewAfter?.followUpPoints.find((x) => x.id === p1.id)
		expect(point?.status).toBe("completed")
		expect(point?.resolution).toBe("Fikset i PR #42")

		await updateFollowUpPointStatus({
			pointId: p1.id,
			expectedReviewId: review.id,
			status: "completed",
			resolution: "   ",
			performedBy: "test-user",
		})
		const reviewAfter2 = await getReview(review.id)
		expect(reviewAfter2?.followUpPoints.find((x) => x.id === p1.id)?.resolution).toBeNull()

		const db = getTestDb()
		const audits = await db.execute(
			/* sql */ `SELECT action FROM audit_log WHERE entity_type = 'review_follow_up_point' ORDER BY performed_at`,
		)
		const actions = audits.rows.map((r) => (r as { action: string }).action)
		expect(actions).toContain("review_follow_up_resolution_updated")
	})

	describe("getLatestNonDiscardedReviewForApp / getLatestNonDiscardedSectionReview", () => {
		async function createTestApp(name: string) {
			const db = getTestDb()
			const result = await db.execute(
				/* sql */ `INSERT INTO monitored_applications (name, created_by, updated_by) VALUES ('${name}', 'test', 'test') RETURNING id`,
			)
			return (result.rows[0] as { id: string }).id
		}

		async function createAppRoutine() {
			const sectionId = await createTestSection(
				`Sec-${Math.random().toString(36).slice(2)}`,
				`sec-${Date.now()}-${Math.random()}`,
			)
			const routine = await createRoutine({
				sectionId,
				name: "App rutine",
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
			await markRoutineApproved(routine.id)
			return routine
		}

		it("returns null when no review exists for the (routine, app) pair", async () => {
			const routine = await createAppRoutine()
			const appId = await createTestApp("App X")
			const result = await getLatestNonDiscardedReviewForApp(routine.id, appId)
			expect(result).toBeNull()
		})

		it("returns the latest non-discarded review including needs_follow_up status", async () => {
			const routine = await createAppRoutine()
			const appId = await createTestApp("App Y")

			const earlier = await createReview({
				routineId: routine.id,
				applicationId: appId,
				title: "Eldre",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date("2025-01-01T00:00:00Z"),
				createdBy: "test-user",
				participants: [],
			})
			await completeReview(earlier.id, "test-user")

			const newer = await createReview({
				routineId: routine.id,
				applicationId: appId,
				title: "Nyere",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date("2025-06-01T00:00:00Z"),
				createdBy: "test-user",
				participants: [],
			})
			await addFollowUpPoint({
				reviewId: newer.id,
				text: "Pkt",
				description: "Beskrivelse",
				performedBy: "test-user",
			})
			await completeReview(newer.id, "test-user")

			const result = await getLatestNonDiscardedReviewForApp(routine.id, appId)
			expect(result?.id).toBe(newer.id)
			expect(result?.status).toBe("needs_follow_up")
		})

		it("ignores discarded reviews even if they are the most recent", async () => {
			const routine = await createAppRoutine()
			const appId = await createTestApp("App Z")

			const completed = await createReview({
				routineId: routine.id,
				applicationId: appId,
				title: "Fullført",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date("2025-01-01T00:00:00Z"),
				createdBy: "test-user",
				participants: [],
			})
			await completeReview(completed.id, "test-user")

			const discarded = await createReview({
				routineId: routine.id,
				applicationId: appId,
				title: "Forkastet",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date("2025-06-01T00:00:00Z"),
				createdBy: "test-user",
				participants: [],
			})
			await discardReview(discarded.id, "test-user")

			const result = await getLatestNonDiscardedReviewForApp(routine.id, appId)
			expect(result?.id).toBe(completed.id)
			expect(result?.status).toBe("completed")
		})

		it("does not return another app's review", async () => {
			const routine = await createAppRoutine()
			const appA = await createTestApp("App A")
			const appB = await createTestApp("App B")

			const review = await createReview({
				routineId: routine.id,
				applicationId: appA,
				title: "For App A",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date(),
				createdBy: "test-user",
				participants: [],
			})
			await completeReview(review.id, "test-user")

			const result = await getLatestNonDiscardedReviewForApp(routine.id, appB)
			expect(result).toBeNull()
		})

		it("section-variant returns latest non-discarded section-level review", async () => {
			const { routine, review } = await newDraftReview()
			await addFollowUpPoint({
				reviewId: review.id,
				text: "Pkt",
				description: "Beskrivelse",
				performedBy: "test-user",
			})
			await completeReview(review.id, "test-user")

			const result = await getLatestNonDiscardedSectionReview(routine.id)
			expect(result?.id).toBe(review.id)
			expect(result?.status).toBe("needs_follow_up")
		})

		it("section-variant ignores app-level reviews", async () => {
			const { routine } = await newDraftReview()
			const appId = await createTestApp("App for filter")
			const appReview = await createReview({
				routineId: routine.id,
				applicationId: appId,
				title: "App-level",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date("2030-01-01T00:00:00Z"),
				createdBy: "test-user",
				participants: [],
			})
			await completeReview(appReview.id, "test-user")

			// Section variant should still return the section review, not appReview
			const result = await getLatestNonDiscardedSectionReview(routine.id)
			expect(result?.id).not.toBe(appReview.id)
			expect(result?.applicationId).toBeNull()
		})
	})
})
