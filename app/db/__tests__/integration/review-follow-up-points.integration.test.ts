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
	addFollowUpPointAttachment,
	updateFollowUpPointStatus,
	updateFollowUpPointText,
	updateFollowUpPointDescription,
	deleteFollowUpPoint,
	addReviewLink,
	deleteReviewLink,
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
		createdBy: "Z990001",
	})
	await markRoutineApproved(routine.id)
	const review = await createReview({
		routineId: routine.id,
		applicationId: null,
		title: "Test gjennomgang",
		summary: null,
		routineSnapshotPath: null,
		reviewedAt: new Date(),
		createdBy: "Z990001",
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
			bucket_objects,
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
		const updated = await completeReview(review.id, "Z990001")
		expect(updated?.status).toBe("completed")
	})

	it("completes review as 'needs_follow_up' when there are unresolved points", async () => {
		const { review } = await newDraftReview()
		await addFollowUpPoint({
			reviewId: review.id,
			text: "Sjekk konfig",
			description: "Beskrivelse",
			performedBy: "Z990001",
		})
		const updated = await completeReview(review.id, "Z990001")
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
			performedBy: "Z990001",
		})
		const p2 = await addFollowUpPoint({
			reviewId: review.id,
			text: "P2",
			description: "Beskrivelse",
			performedBy: "Z990001",
		})
		await completeReview(review.id, "Z990001")

		await updateFollowUpPointStatus({
			pointId: p1.id,
			expectedReviewId: review.id,
			status: "completed",
			performedBy: "Z990001",
		})
		const stillNeedsFollowUp = await getReview(review.id)
		expect(stillNeedsFollowUp?.status).toBe("needs_follow_up")

		await updateFollowUpPointStatus({
			pointId: p2.id,
			expectedReviewId: review.id,
			status: "not_relevant",
			performedBy: "Z990001",
		})
		const fullyDone = await getReview(review.id)
		expect(fullyDone?.status).toBe("completed")
	})

	it("blocks adding a follow-up point to a completed review", async () => {
		const { review } = await newDraftReview()
		const completed = await completeReview(review.id, "Z990001")
		expect(completed?.status).toBe("completed")

		await expect(
			addFollowUpPoint({ reviewId: review.id, text: "Nytt funn", performedBy: "Z990001" }),
		).rejects.toSatisfy((e: unknown) => e instanceof Response && e.status === 409)
	})

	it("blocks adding a follow-up point to a needs_follow_up review", async () => {
		const { review } = await newDraftReview()
		await addFollowUpPoint({
			reviewId: review.id,
			text: "Åpent punkt",
			description: "Beskrivelse",
			performedBy: "Z990001",
		})
		const completed = await completeReview(review.id, "Z990001")
		expect(completed?.status).toBe("needs_follow_up")

		await expect(
			addFollowUpPoint({ reviewId: review.id, text: "Nytt funn", performedBy: "Z990001" }),
		).rejects.toSatisfy((e: unknown) => e instanceof Response && e.status === 409)
	})

	it("blocks adding a follow-up point to a discarded review", async () => {
		const { review } = await newDraftReview()
		await discardReview(review.id, "Z990001")

		await expect(
			addFollowUpPoint({ reviewId: review.id, text: "Nytt funn", performedBy: "Z990001" }),
		).rejects.toSatisfy((e: unknown) => e instanceof Response && e.status === 409)
	})

	it("re-opens needs_follow_up by reverting a resolved point back to needs_follow_up", async () => {
		const { review } = await newDraftReview()
		const p1 = await addFollowUpPoint({
			reviewId: review.id,
			text: "P1",
			description: "Beskrivelse",
			performedBy: "Z990001",
		})
		await completeReview(review.id, "Z990001")
		await updateFollowUpPointStatus({
			pointId: p1.id,
			expectedReviewId: review.id,
			status: "completed",
			performedBy: "Z990001",
		})
		const done = await getReview(review.id)
		expect(done?.status).toBe("completed")

		await updateFollowUpPointStatus({
			pointId: p1.id,
			expectedReviewId: review.id,
			status: "needs_follow_up",
			performedBy: "Z990001",
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
			performedBy: "Z990001",
		})
		await completeReview(review.id, "Z990001")

		await expect(
			updateFollowUpPointText({
				pointId: p1.id,
				expectedReviewId: review.id,
				text: "Endret",
				performedBy: "Z990001",
			}),
		).rejects.toBeInstanceOf(Response)
	})

	it("rejects deleting a follow-up when review is not draft", async () => {
		const { review } = await newDraftReview()
		const p1 = await addFollowUpPoint({
			reviewId: review.id,
			text: "Tag",
			description: "Beskrivelse",
			performedBy: "Z990001",
		})
		await completeReview(review.id, "Z990001")

		await expect(
			deleteFollowUpPoint({
				pointId: p1.id,
				expectedReviewId: review.id,
				performedBy: "Z990001",
			}),
		).rejects.toBeInstanceOf(Response)
	})

	it("allows editing text and deleting while still draft", async () => {
		const { review } = await newDraftReview()
		const p1 = await addFollowUpPoint({ reviewId: review.id, text: "Tag", performedBy: "Z990001" })
		const updated = await updateFollowUpPointText({
			pointId: p1.id,
			expectedReviewId: review.id,
			text: "Tag oppdatert",
			performedBy: "Z990001",
		})
		expect(updated?.text).toBe("Tag oppdatert")
		await deleteFollowUpPoint({ pointId: p1.id, expectedReviewId: review.id, performedBy: "Z990001" })
		const reviewAfter = await getReview(review.id)
		expect(reviewAfter?.followUpPoints).toHaveLength(0)

		const db = getTestDb()
		const archivedPoint = await db.execute(
			/* sql */ `SELECT archived_at, archived_by FROM routine_review_follow_up_points WHERE id = '${p1.id}'`,
		)
		expect(archivedPoint.rows).toHaveLength(1)
		expect(archivedPoint.rows[0]).toMatchObject({ archived_by: "Z990001" })
		expect((archivedPoint.rows[0] as { archived_at: unknown }).archived_at).not.toBeNull()
		await expect(
			updateFollowUpPointText({
				pointId: p1.id,
				expectedReviewId: review.id,
				text: "Endret etter arkivering",
				performedBy: "Z990001",
			}),
		).rejects.toMatchObject({ status: 404 })
		await expect(
			updateFollowUpPointDescription({
				pointId: p1.id,
				expectedReviewId: review.id,
				description: "Endret etter arkivering",
				performedBy: "Z990001",
			}),
		).rejects.toMatchObject({ status: 404 })
		await expect(
			updateFollowUpPointStatus({
				pointId: p1.id,
				expectedReviewId: review.id,
				status: "completed",
				performedBy: "Z990001",
			}),
		).rejects.toMatchObject({ status: 404 })
		await expect(
			addFollowUpPointAttachment({
				pointId: p1.id,
				kind: "resolution",
				fileName: "vedlegg.pdf",
				bucketPath: "test/vedlegg.pdf",
				bucketName: "kiss-test",
				contentType: "application/pdf",
				sizeBytes: 10,
				uploadedBy: "Z990001",
			}),
		).rejects.toMatchObject({ status: 404 })
		const rejectedBucketObject = await db.execute(
			/* sql */ `SELECT COUNT(*)::int AS count FROM bucket_objects WHERE object_path = 'test/vedlegg.pdf'`,
		)
		expect((rejectedBucketObject.rows[0] as { count: number }).count).toBe(0)
	})

	it("revalidates attachment eligibility against the locked review status", async () => {
		const addAttachment = (pointId: string, kind: "description" | "resolution", bucketPath: string) =>
			addFollowUpPointAttachment({
				pointId,
				kind,
				fileName: "vedlegg.pdf",
				bucketPath,
				bucketName: "kiss-test",
				contentType: "application/pdf",
				sizeBytes: 10,
				uploadedBy: "Z990001",
			})

		const followUp = await newDraftReview()
		const unresolvedPoint = await addFollowUpPoint({
			reviewId: followUp.review.id,
			text: "Følg opp MFA",
			description: "Beskrivelse",
			performedBy: "Z990001",
		})
		await completeReview(followUp.review.id, "Z990001")
		await expect(addAttachment(unresolvedPoint.id, "description", "test/late-description.pdf")).rejects.toMatchObject({
			status: 409,
		})
		await expect(addAttachment(unresolvedPoint.id, "resolution", "test/resolution.pdf")).resolves.toBeDefined()

		const completed = await newDraftReview()
		const completedPoint = await addFollowUpPoint({
			reviewId: completed.review.id,
			text: "Følg opp tilgang",
			description: "Beskrivelse",
			performedBy: "Z990001",
		})
		await updateFollowUpPointStatus({
			pointId: completedPoint.id,
			expectedReviewId: completed.review.id,
			status: "completed",
			performedBy: "Z990001",
		})
		await completeReview(completed.review.id, "Z990001")
		await expect(addAttachment(completedPoint.id, "resolution", "test/completed-resolution.pdf")).rejects.toMatchObject(
			{
				status: 409,
			},
		)

		const discarded = await newDraftReview()
		const discardedPoint = await addFollowUpPoint({
			reviewId: discarded.review.id,
			text: "Følg opp logging",
			description: "Beskrivelse",
			performedBy: "Z990001",
		})
		await discardReview(discarded.review.id, "Z990001")
		await expect(addAttachment(discardedPoint.id, "resolution", "test/discarded-resolution.pdf")).rejects.toMatchObject(
			{
				status: 409,
			},
		)
	})

	it("blocks completing review when any follow-up point lacks a description", async () => {
		const { review } = await newDraftReview()
		await addFollowUpPoint({
			reviewId: review.id,
			text: "Med beskrivelse",
			description: "Detaljer",
			performedBy: "Z990001",
		})
		await addFollowUpPoint({
			reviewId: review.id,
			text: "Uten beskrivelse",
			performedBy: "Z990001",
		})

		await expect(completeReview(review.id, "Z990001")).rejects.toBeInstanceOf(Response)

		const stillDraft = await getReview(review.id)
		expect(stillDraft?.status).toBe("draft")

		await updateFollowUpPointDescription({
			pointId: stillDraft?.followUpPoints.find((p) => p.text === "Uten beskrivelse")?.id ?? "",
			expectedReviewId: review.id,
			description: "Nå har den beskrivelse",
			performedBy: "Z990001",
		})

		const updated = await completeReview(review.id, "Z990001")
		expect(updated?.status).toBe("needs_follow_up")
	})

	it("blocks completing review when description is only whitespace", async () => {
		const { review } = await newDraftReview()
		await addFollowUpPoint({
			reviewId: review.id,
			text: "Whitespace-bare",
			description: "   ",
			performedBy: "Z990001",
		})

		await expect(completeReview(review.id, "Z990001")).rejects.toBeInstanceOf(Response)
	})

	it("does not audit individual follow-up edits", async () => {
		const { review } = await newDraftReview()
		const p1 = await addFollowUpPoint({ reviewId: review.id, text: "Audit", performedBy: "Z990001" })
		await updateFollowUpPointStatus({
			pointId: p1.id,
			expectedReviewId: review.id,
			status: "completed",
			performedBy: "Z990001",
		})

		const db = getTestDb()
		const audits = await db.execute(
			/* sql */ `SELECT action FROM audit_log WHERE entity_type = 'review_follow_up_point' ORDER BY performed_at`,
		)
		const actions = audits.rows.map((r) => (r as { action: string }).action)
		expect(actions).toEqual([])
	})

	it("audits one row per follow-up at completion, plus status, resolution and attachments afterwards", async () => {
		const { review } = await newDraftReview()
		const p1 = await addFollowUpPoint({
			reviewId: review.id,
			text: "P1",
			description: "Beskrivelse",
			performedBy: "Z990001",
		})
		const p2 = await addFollowUpPoint({
			reviewId: review.id,
			text: "P2",
			description: "Beskrivelse",
			performedBy: "Z990001",
		})
		await completeReview(review.id, "Z990001")

		await addFollowUpPointAttachment({
			pointId: p2.id,
			kind: "resolution",
			fileName: "oppfolging.pdf",
			bucketPath: "test/audited-resolution.pdf",
			bucketName: "kiss-test",
			contentType: "application/pdf",
			sizeBytes: 10,
			uploadedBy: "Z990002",
		})
		await updateFollowUpPointStatus({
			pointId: p1.id,
			expectedReviewId: review.id,
			status: "completed",
			resolution: "Fikset",
			performedBy: "Z990001",
		})

		const db = getTestDb()
		const audits = await db.execute(
			/* sql */ `SELECT action FROM audit_log WHERE action LIKE 'review_follow_up_%' ORDER BY action`,
		)
		expect(audits.rows.map((r) => (r as { action: string }).action)).toEqual([
			"review_follow_up_added",
			"review_follow_up_added",
			"review_follow_up_attachment_uploaded",
			"review_follow_up_resolution_updated",
			"review_follow_up_status_changed",
		])
	})

	it("audits review links only after the review is completed", async () => {
		const { review } = await newDraftReview()
		const draftLink = await addReviewLink({
			reviewId: review.id,
			url: "https://example.com/utkast",
			title: null,
			addedBy: "Z990001",
		})
		await deleteReviewLink(draftLink.id, review.id, "Z990001")
		await completeReview(review.id, "Z990001")

		const db = getTestDb()
		const countAudits = async () => {
			const rows = await db.execute(
				/* sql */ `SELECT action FROM audit_log WHERE action IN ('review_link_added', 'review_link_deleted') ORDER BY action`,
			)
			return rows.rows.map((r) => (r as { action: string }).action)
		}
		expect(await countAudits()).toEqual([])

		const link = await addReviewLink({
			reviewId: review.id,
			url: "https://example.com/etter",
			title: null,
			addedBy: "Z990001",
		})
		await deleteReviewLink(link.id, review.id, "Z990001")
		expect(await countAudits()).toEqual(["review_link_added", "review_link_deleted"])
	})

	it("supports adding a description with a follow-up and editing it later", async () => {
		const { review } = await newDraftReview()
		const p1 = await addFollowUpPoint({
			reviewId: review.id,
			text: "Konfigurer alarm",
			description: "Sett opp alarm i Grafana for når kø > 1000",
			performedBy: "Z990001",
		})
		expect(p1.description).toBe("Sett opp alarm i Grafana for når kø > 1000")

		const updated = await updateFollowUpPointDescription({
			pointId: p1.id,
			expectedReviewId: review.id,
			description: "Oppdatert beskrivelse",
			performedBy: "Z990001",
		})
		expect(updated?.description).toBe("Oppdatert beskrivelse")

		const cleared = await updateFollowUpPointDescription({
			pointId: p1.id,
			expectedReviewId: review.id,
			description: "   ",
			performedBy: "Z990001",
		})
		expect(cleared?.description).toBeNull()
	})

	it("blocks editing description once review is completed (needs_follow_up or completed)", async () => {
		const { review } = await newDraftReview()
		const p1 = await addFollowUpPoint({
			reviewId: review.id,
			text: "Punkt",
			description: "Innledende beskrivelse",
			performedBy: "Z990001",
		})
		await completeReview(review.id, "Z990001")
		const reviewMid = await getReview(review.id)
		expect(reviewMid?.status).toBe("needs_follow_up")

		await expect(
			updateFollowUpPointDescription({
				pointId: p1.id,
				expectedReviewId: review.id,
				description: "Skal ikke tillates etter fullføring",
				performedBy: "Z990001",
			}),
		).rejects.toBeInstanceOf(Response)

		await updateFollowUpPointStatus({
			pointId: p1.id,
			expectedReviewId: review.id,
			status: "completed",
			performedBy: "Z990001",
		})
		const reviewDone = await getReview(review.id)
		expect(reviewDone?.status).toBe("completed")

		const db = getTestDb()
		const completionAudit = await db.execute(
			/* sql */ `SELECT id FROM audit_log WHERE entity_type = 'routine_review' AND entity_id = '${review.id}' AND action = 'routine_review_completed' AND new_value = 'completed'`,
		)
		expect(completionAudit.rows).toHaveLength(1)

		await expect(
			updateFollowUpPointDescription({
				pointId: p1.id,
				expectedReviewId: review.id,
				description: "For sent",
				performedBy: "Z990001",
			}),
		).rejects.toBeInstanceOf(Response)
	})

	it("can update status together with oppsummering", async () => {
		const { review } = await newDraftReview()
		const p1 = await addFollowUpPoint({ reviewId: review.id, text: "Pkt", performedBy: "Z990001" })
		await updateFollowUpPointStatus({
			pointId: p1.id,
			expectedReviewId: review.id,
			status: "completed",
			resolution: "Fikset i PR #42",
			performedBy: "Z990001",
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
			performedBy: "Z990001",
		})
		const reviewAfter2 = await getReview(review.id)
		expect(reviewAfter2?.followUpPoints.find((x) => x.id === p1.id)?.resolution).toBeNull()

		const db = getTestDb()
		const audits = await db.execute(
			/* sql */ `SELECT action FROM audit_log WHERE entity_type = 'review_follow_up_point' ORDER BY performed_at`,
		)
		const actions = audits.rows.map((r) => (r as { action: string }).action)
		expect(actions).toEqual([])
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
				createdBy: "Z990001",
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
				createdBy: "Z990001",
				participants: [],
			})
			await completeReview(earlier.id, "Z990001")

			const newer = await createReview({
				routineId: routine.id,
				applicationId: appId,
				title: "Nyere",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date("2025-06-01T00:00:00Z"),
				createdBy: "Z990001",
				participants: [],
			})
			await addFollowUpPoint({
				reviewId: newer.id,
				text: "Pkt",
				description: "Beskrivelse",
				performedBy: "Z990001",
			})
			await completeReview(newer.id, "Z990001")

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
				createdBy: "Z990001",
				participants: [],
			})
			await completeReview(completed.id, "Z990001")

			const discarded = await createReview({
				routineId: routine.id,
				applicationId: appId,
				title: "Forkastet",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date("2025-06-01T00:00:00Z"),
				createdBy: "Z990001",
				participants: [],
			})
			await discardReview(discarded.id, "Z990001")

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
				createdBy: "Z990001",
				participants: [],
			})
			await completeReview(review.id, "Z990001")

			const result = await getLatestNonDiscardedReviewForApp(routine.id, appB)
			expect(result).toBeNull()
		})

		it("section-variant returns latest non-discarded section-level review", async () => {
			const { routine, review } = await newDraftReview()
			await addFollowUpPoint({
				reviewId: review.id,
				text: "Pkt",
				description: "Beskrivelse",
				performedBy: "Z990001",
			})
			await completeReview(review.id, "Z990001")

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
				createdBy: "Z990001",
				participants: [],
			})
			await completeReview(appReview.id, "Z990001")

			// Section variant should still return the section review, not appReview
			const result = await getLatestNonDiscardedSectionReview(routine.id)
			expect(result?.id).not.toBe(appReview.id)
			expect(result?.applicationId).toBeNull()
		})
	})
})
