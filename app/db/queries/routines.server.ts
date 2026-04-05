import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm"
import { frequencyDays, type RoutineFrequency } from "../../lib/routine-frequencies"
import { db } from "../connection.server"
import { monitoredApplications } from "../schema/applications"
import { applicationTechnologyElements, technologyElements } from "../schema/framework"
import {
	routineReviewAttachments,
	routineReviewParticipants,
	routineReviews,
	routines,
	routineTechnologyElements,
} from "../schema/routines"
import { screeningAnswers } from "../schema/screening"
import { writeAuditLog } from "./audit.server"

// ─── Routine CRUD ────────────────────────────────────────────────────────

export async function getRoutinesForSection(sectionId: string) {
	const rows = await db.select().from(routines).where(eq(routines.sectionId, sectionId)).orderBy(routines.name)

	return Promise.all(
		rows.map(async (r) => {
			const elements = await db
				.select({
					id: technologyElements.id,
					name: technologyElements.name,
				})
				.from(routineTechnologyElements)
				.innerJoin(technologyElements, eq(routineTechnologyElements.elementId, technologyElements.id))
				.where(eq(routineTechnologyElements.routineId, r.id))

			const [reviewCount] = await db
				.select({ count: sql<number>`count(*)::int` })
				.from(routineReviews)
				.where(eq(routineReviews.routineId, r.id))

			return {
				...r,
				technologyElements: elements,
				reviewCount: reviewCount?.count ?? 0,
			}
		}),
	)
}

export async function getRoutine(id: string) {
	const [routine] = await db.select().from(routines).where(eq(routines.id, id)).limit(1)
	if (!routine) return null

	const elements = await db
		.select({
			id: technologyElements.id,
			name: technologyElements.name,
		})
		.from(routineTechnologyElements)
		.innerJoin(technologyElements, eq(routineTechnologyElements.elementId, technologyElements.id))
		.where(eq(routineTechnologyElements.routineId, id))

	return { ...routine, technologyElements: elements }
}

export async function createRoutine(params: {
	sectionId: string
	name: string
	description: string | null
	frequency: RoutineFrequency
	screeningQuestionId: string | null
	screeningChoiceValue: string | null
	technologyElementIds: string[]
	createdBy: string
}) {
	const [routine] = await db
		.insert(routines)
		.values({
			sectionId: params.sectionId,
			name: params.name,
			description: params.description,
			frequency: params.frequency,
			screeningQuestionId: params.screeningQuestionId,
			screeningChoiceValue: params.screeningChoiceValue,
			createdBy: params.createdBy,
			updatedBy: params.createdBy,
		})
		.returning()

	if (params.technologyElementIds.length > 0) {
		await db.insert(routineTechnologyElements).values(
			params.technologyElementIds.map((elementId) => ({
				routineId: routine.id,
				elementId,
			})),
		)
	}

	await writeAuditLog({
		action: "routine_created",
		entityType: "routine",
		entityId: routine.id,
		newValue: params.name,
		metadata: {
			sectionId: params.sectionId,
			frequency: params.frequency,
			screeningQuestionId: params.screeningQuestionId,
			technologyElementIds: params.technologyElementIds,
		},
		performedBy: params.createdBy,
	})

	return routine
}

export async function updateRoutine(params: {
	id: string
	name: string
	description: string | null
	frequency: RoutineFrequency
	screeningQuestionId: string | null
	screeningChoiceValue: string | null
	technologyElementIds: string[]
	updatedBy: string
}) {
	const prev = await getRoutine(params.id)

	const [routine] = await db
		.update(routines)
		.set({
			name: params.name,
			description: params.description,
			frequency: params.frequency,
			screeningQuestionId: params.screeningQuestionId,
			screeningChoiceValue: params.screeningChoiceValue,
			updatedBy: params.updatedBy,
			updatedAt: new Date(),
		})
		.where(eq(routines.id, params.id))
		.returning()

	// Replace technology element links
	await db.delete(routineTechnologyElements).where(eq(routineTechnologyElements.routineId, params.id))
	if (params.technologyElementIds.length > 0) {
		await db.insert(routineTechnologyElements).values(
			params.technologyElementIds.map((elementId) => ({
				routineId: params.id,
				elementId,
			})),
		)
	}

	await writeAuditLog({
		action: "routine_updated",
		entityType: "routine",
		entityId: params.id,
		previousValue: prev?.name ?? null,
		newValue: params.name,
		metadata: {
			frequency: params.frequency,
			screeningQuestionId: params.screeningQuestionId,
			technologyElementIds: params.technologyElementIds,
		},
		performedBy: params.updatedBy,
	})

	return routine
}

export async function deleteRoutine(id: string, performedBy: string) {
	const prev = await getRoutine(id)
	if (!prev) return null

	await db.delete(routines).where(eq(routines.id, id))

	await writeAuditLog({
		action: "routine_deleted",
		entityType: "routine",
		entityId: id,
		previousValue: prev.name,
		performedBy,
	})

	return prev
}

// ─── Routine Reviews ─────────────────────────────────────────────────────

export async function getReviewsForRoutine(routineId: string) {
	const reviews = await db
		.select()
		.from(routineReviews)
		.where(eq(routineReviews.routineId, routineId))
		.orderBy(desc(routineReviews.reviewedAt))

	return Promise.all(reviews.map(enrichReview))
}

export async function getReviewsForApp(applicationId: string) {
	const reviews = await db
		.select({
			review: routineReviews,
			routineName: routines.name,
			routineDescription: routines.description,
			routineFrequency: routines.frequency,
			sectionId: routines.sectionId,
		})
		.from(routineReviews)
		.innerJoin(routines, eq(routineReviews.routineId, routines.id))
		.where(eq(routineReviews.applicationId, applicationId))
		.orderBy(desc(routineReviews.reviewedAt))

	return Promise.all(
		reviews.map(async (row) => {
			const enriched = await enrichReview(row.review)
			return {
				...enriched,
				routineName: row.routineName,
				routineDescription: row.routineDescription,
				routineFrequency: row.routineFrequency,
				sectionId: row.sectionId,
			}
		}),
	)
}

export async function getReview(id: string) {
	const [review] = await db.select().from(routineReviews).where(eq(routineReviews.id, id)).limit(1)
	if (!review) return null
	return enrichReview(review)
}

async function enrichReview(review: typeof routineReviews.$inferSelect) {
	const [participants, attachments] = await Promise.all([
		db.select().from(routineReviewParticipants).where(eq(routineReviewParticipants.reviewId, review.id)),
		db
			.select()
			.from(routineReviewAttachments)
			.where(eq(routineReviewAttachments.reviewId, review.id))
			.orderBy(routineReviewAttachments.uploadedAt),
	])

	return { ...review, participants, attachments }
}

export async function createReview(params: {
	routineId: string
	applicationId: string | null
	title: string
	summary: string | null
	routineSnapshotPath: string | null
	reviewedAt: Date
	createdBy: string
	participants: Array<{ userIdent: string; userName: string | null }>
}) {
	const [review] = await db
		.insert(routineReviews)
		.values({
			routineId: params.routineId,
			applicationId: params.applicationId,
			title: params.title,
			summary: params.summary,
			routineSnapshotPath: params.routineSnapshotPath,
			reviewedAt: params.reviewedAt,
			createdBy: params.createdBy,
		})
		.returning()

	if (params.participants.length > 0) {
		await db.insert(routineReviewParticipants).values(
			params.participants.map((p) => ({
				reviewId: review.id,
				userIdent: p.userIdent,
				userName: p.userName,
			})),
		)
	}

	await writeAuditLog({
		action: "routine_review_created",
		entityType: "routine_review",
		entityId: review.id,
		newValue: params.title,
		metadata: {
			routineId: params.routineId,
			applicationId: params.applicationId,
			participantCount: params.participants.length,
		},
		performedBy: params.createdBy,
	})

	return review
}

export async function updateReview(
	reviewId: string,
	params: {
		title?: string
		summary?: string | null
		applicationId?: string | null
		reviewedAt?: Date
		participants?: Array<{ userIdent: string; userName: string | null }>
	},
	performedBy: string,
) {
	const existing = await getReview(reviewId)
	if (!existing) return null
	if (existing.status === "completed") return null

	const updates: Record<string, unknown> = {}
	if (params.title !== undefined) updates.title = params.title
	if (params.summary !== undefined) updates.summary = params.summary
	if (params.applicationId !== undefined) updates.applicationId = params.applicationId
	if (params.reviewedAt !== undefined) updates.reviewedAt = params.reviewedAt

	if (Object.keys(updates).length > 0) {
		await db.update(routineReviews).set(updates).where(eq(routineReviews.id, reviewId))
	}

	if (params.participants !== undefined) {
		await db.delete(routineReviewParticipants).where(eq(routineReviewParticipants.reviewId, reviewId))
		if (params.participants.length > 0) {
			await db.insert(routineReviewParticipants).values(
				params.participants.map((p) => ({
					reviewId,
					userIdent: p.userIdent,
					userName: p.userName,
				})),
			)
		}
	}

	await writeAuditLog({
		action: "routine_review_updated",
		entityType: "routine_review",
		entityId: reviewId,
		newValue: JSON.stringify(updates),
		performedBy,
	})

	return getReview(reviewId)
}

export async function completeReview(reviewId: string, performedBy: string) {
	const existing = await getReview(reviewId)
	if (!existing) return null
	if (existing.status === "completed") return existing

	await db.update(routineReviews).set({ status: "completed" }).where(eq(routineReviews.id, reviewId))

	await writeAuditLog({
		action: "routine_review_completed",
		entityType: "routine_review",
		entityId: reviewId,
		newValue: "completed",
		performedBy,
	})

	return getReview(reviewId)
}

export async function confirmParticipation(reviewId: string, userIdent: string) {
	const [participant] = await db
		.update(routineReviewParticipants)
		.set({ confirmedAt: new Date() })
		.where(and(eq(routineReviewParticipants.reviewId, reviewId), eq(routineReviewParticipants.userIdent, userIdent)))
		.returning()

	if (participant) {
		await writeAuditLog({
			action: "routine_review_confirmed",
			entityType: "routine_review_participant",
			entityId: participant.id,
			newValue: userIdent,
			metadata: { reviewId },
			performedBy: userIdent,
		})
	}

	return participant ?? null
}

// ─── Review Attachments ──────────────────────────────────────────────────

export async function addReviewAttachment(params: {
	reviewId: string
	fileName: string
	bucketPath: string
	contentType: string
	sizeBytes: number | null
	uploadedBy: string
}) {
	const [attachment] = await db
		.insert(routineReviewAttachments)
		.values({
			reviewId: params.reviewId,
			fileName: params.fileName,
			bucketPath: params.bucketPath,
			contentType: params.contentType,
			sizeBytes: params.sizeBytes,
			uploadedBy: params.uploadedBy,
		})
		.returning()

	await writeAuditLog({
		action: "routine_attachment_uploaded",
		entityType: "routine_review_attachment",
		entityId: attachment.id,
		newValue: params.fileName,
		metadata: { reviewId: params.reviewId, contentType: params.contentType },
		performedBy: params.uploadedBy,
	})

	return attachment
}

// ─── Eligibility — which apps need a routine? ────────────────────────────

export async function getAppsRequiringRoutine(routineId: string) {
	const routine = await getRoutine(routineId)
	if (!routine) return []

	// If no screening question linked, no apps are automatically required
	if (!routine.screeningQuestionId || !routine.screeningChoiceValue) return []

	// Step 1: Find apps that answered the screening question with the required choice
	const matchingApps = await db
		.select({
			applicationId: screeningAnswers.applicationId,
		})
		.from(screeningAnswers)
		.where(
			and(
				eq(screeningAnswers.questionId, routine.screeningQuestionId),
				eq(screeningAnswers.answer, routine.screeningChoiceValue),
			),
		)

	if (matchingApps.length === 0) return []

	const appIds = matchingApps.map((a) => a.applicationId)

	// Step 2: If routine has technology elements, further filter by those
	if (routine.technologyElements.length > 0) {
		const elementIds = routine.technologyElements.map((e) => e.id)

		const appsWithElements = await db
			.select({
				applicationId: applicationTechnologyElements.applicationId,
			})
			.from(applicationTechnologyElements)
			.where(
				and(
					inArray(applicationTechnologyElements.applicationId, appIds),
					inArray(applicationTechnologyElements.elementId, elementIds),
					isNotNull(applicationTechnologyElements.confirmedAt),
					isNull(applicationTechnologyElements.rejectedAt),
				),
			)

		const filteredIds = [...new Set(appsWithElements.map((a) => a.applicationId))]
		if (filteredIds.length === 0) return []

		return db
			.select()
			.from(monitoredApplications)
			.where(inArray(monitoredApplications.id, filteredIds))
			.orderBy(monitoredApplications.name)
	}

	// No technology element filter — all matching apps
	return db
		.select()
		.from(monitoredApplications)
		.where(inArray(monitoredApplications.id, appIds))
		.orderBy(monitoredApplications.name)
}

// ─── Deadlines — overdue and upcoming ────────────────────────────────────

export async function getLatestReviewForApp(routineId: string, applicationId: string) {
	const [review] = await db
		.select()
		.from(routineReviews)
		.where(and(eq(routineReviews.routineId, routineId), eq(routineReviews.applicationId, applicationId)))
		.orderBy(desc(routineReviews.reviewedAt))
		.limit(1)

	return review ?? null
}

export function calculateDeadline(
	lastReviewDate: Date | null,
	routineCreatedAt: Date,
	frequency: RoutineFrequency,
): Date {
	const base = lastReviewDate ?? routineCreatedAt
	const days = frequencyDays[frequency]
	const deadline = new Date(base)
	deadline.setDate(deadline.getDate() + days)
	return deadline
}

export function isOverdue(deadline: Date): boolean {
	return new Date() > deadline
}

export interface RoutineDeadlineInfo {
	routine: Awaited<ReturnType<typeof getRoutine>>
	applicationId: string
	applicationName: string
	lastReviewDate: Date | null
	deadline: Date
	overdue: boolean
}

export async function getRoutineDeadlinesForSection(sectionId: string): Promise<RoutineDeadlineInfo[]> {
	const sectionRoutines = await db.select().from(routines).where(eq(routines.sectionId, sectionId))

	const results: RoutineDeadlineInfo[] = []

	for (const routine of sectionRoutines) {
		const fullRoutine = await getRoutine(routine.id)
		const apps = await getAppsRequiringRoutine(routine.id)

		for (const app of apps) {
			const lastReview = await getLatestReviewForApp(routine.id, app.id)
			const deadline = calculateDeadline(
				lastReview?.reviewedAt ?? null,
				routine.createdAt,
				routine.frequency as RoutineFrequency,
			)

			results.push({
				routine: fullRoutine,
				applicationId: app.id,
				applicationName: app.name,
				lastReviewDate: lastReview?.reviewedAt ?? null,
				deadline,
				overdue: isOverdue(deadline),
			})
		}
	}

	return results
}

export async function getOverdueRoutinesForSection(sectionId: string) {
	const all = await getRoutineDeadlinesForSection(sectionId)
	return all.filter((d) => d.overdue)
}

export async function getRoutineDeadlinesForApp(applicationId: string) {
	// Find all routines that apply to this app
	const allRoutines = await db.select().from(routines)
	const results: RoutineDeadlineInfo[] = []

	for (const routine of allRoutines) {
		const apps = await getAppsRequiringRoutine(routine.id)
		const appMatch = apps.find((a) => a.id === applicationId)
		if (!appMatch) continue

		const fullRoutine = await getRoutine(routine.id)
		const lastReview = await getLatestReviewForApp(routine.id, applicationId)
		const deadline = calculateDeadline(
			lastReview?.reviewedAt ?? null,
			routine.createdAt,
			routine.frequency as RoutineFrequency,
		)

		results.push({
			routine: fullRoutine,
			applicationId,
			applicationName: appMatch.name,
			lastReviewDate: lastReview?.reviewedAt ?? null,
			deadline,
			overdue: isOverdue(deadline),
		})
	}

	return results
}

// ─── Completed reviews for section ───────────────────────────────────────

export async function getCompletedReviewsForSection(sectionId: string) {
	const sectionRoutines = await db.select({ id: routines.id }).from(routines).where(eq(routines.sectionId, sectionId))

	if (sectionRoutines.length === 0) return []

	const routineIds = sectionRoutines.map((r) => r.id)

	const reviews = await db
		.select({
			review: routineReviews,
			routineName: routines.name,
			appName: monitoredApplications.name,
		})
		.from(routineReviews)
		.innerJoin(routines, eq(routineReviews.routineId, routines.id))
		.leftJoin(monitoredApplications, eq(routineReviews.applicationId, monitoredApplications.id))
		.where(inArray(routineReviews.routineId, routineIds))
		.orderBy(desc(routineReviews.reviewedAt))

	return Promise.all(
		reviews.map(async (row) => {
			const enriched = await enrichReview(row.review)
			return {
				...enriched,
				routineName: row.routineName,
				applicationName: row.appName,
			}
		}),
	)
}
