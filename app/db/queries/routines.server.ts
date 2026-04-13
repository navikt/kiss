import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm"
import { frequencyDays, type RoutineFrequency } from "../../lib/routine-frequencies"
import { db } from "../connection.server"
import {
	applicationPersistence,
	type DataClassification,
	monitoredApplications,
	type PersistenceType,
} from "../schema/applications"
import {
	applicationTechnologyElements,
	frameworkControls,
	frameworkDomains,
	frameworkRiskControlMappings,
	frameworkRisks,
	technologyElements,
} from "../schema/framework"
import {
	routineControls,
	routineReviewAttachments,
	routineReviewLinks,
	routineReviewParticipants,
	routineReviews,
	routineScreeningQuestions,
	routines,
	routineTechnologyElements,
} from "../schema/routines"
import { screeningAnswers, screeningRoutineSelections } from "../schema/screening"
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

	const screeningLinks = await db
		.select()
		.from(routineScreeningQuestions)
		.where(eq(routineScreeningQuestions.routineId, id))

	const controlRows = await db
		.selectDistinct({
			id: frameworkControls.id,
			controlId: frameworkControls.controlId,
			shortTitle: frameworkControls.shortTitle,
			responsible: frameworkControls.responsible,
			domainSlug: frameworkDomains.code,
		})
		.from(routineControls)
		.innerJoin(frameworkControls, eq(routineControls.controlId, frameworkControls.id))
		.innerJoin(frameworkRiskControlMappings, eq(frameworkControls.id, frameworkRiskControlMappings.controlId))
		.innerJoin(frameworkRisks, eq(frameworkRiskControlMappings.riskId, frameworkRisks.id))
		.innerJoin(frameworkDomains, eq(frameworkRisks.domainId, frameworkDomains.id))
		.where(eq(routineControls.routineId, id))

	const controls = controlRows.map((c) => ({
		id: c.id,
		controlId: c.controlId,
		name: c.shortTitle ?? c.controlId,
		responsible: c.responsible,
		domainSlug: c.domainSlug,
	}))

	return { ...routine, technologyElements: elements, screeningQuestions: screeningLinks, controls }
}

export async function createRoutine(params: {
	sectionId: string
	name: string
	description: string | null
	frequency: RoutineFrequency
	responsibleRole: string | null
	persistenceType: PersistenceType | null
	dataClassification: DataClassification | null
	screeningQuestionId: string | null
	screeningChoiceValue: string | null
	screeningQuestionLinks?: Array<{ questionId: string; choiceValue: string | null }>
	technologyElementIds: string[]
	controlIds: string[]
	createdBy: string
}) {
	const [routine] = await db
		.insert(routines)
		.values({
			sectionId: params.sectionId,
			name: params.name,
			description: params.description,
			frequency: params.frequency,
			responsibleRole: params.responsibleRole,
			persistenceType: params.persistenceType,
			dataClassification: params.dataClassification,
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

	if (params.controlIds.length > 0) {
		await db.insert(routineControls).values(
			params.controlIds.map((controlId) => ({
				routineId: routine.id,
				controlId,
			})),
		)
	}

	// Insert screening question links (new many-to-many)
	const links = params.screeningQuestionLinks ?? []
	// Also include legacy single link if set and not already in the list
	if (params.screeningQuestionId && !links.some((l) => l.questionId === params.screeningQuestionId)) {
		links.push({ questionId: params.screeningQuestionId, choiceValue: params.screeningChoiceValue })
	}
	if (links.length > 0) {
		await db.insert(routineScreeningQuestions).values(
			links.map((link) => ({
				routineId: routine.id,
				questionId: link.questionId,
				choiceValue: link.choiceValue,
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
			responsibleRole: params.responsibleRole,
			persistenceType: params.persistenceType,
			dataClassification: params.dataClassification,
			screeningQuestionId: params.screeningQuestionId,
			screeningQuestionLinks: links,
			technologyElementIds: params.technologyElementIds,
			controlIds: params.controlIds,
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
	responsibleRole: string | null
	persistenceType: PersistenceType | null
	dataClassification: DataClassification | null
	screeningQuestionId: string | null
	screeningChoiceValue: string | null
	screeningQuestionLinks?: Array<{ questionId: string; choiceValue: string | null }>
	technologyElementIds: string[]
	controlIds: string[]
	updatedBy: string
}) {
	const prev = await getRoutine(params.id)

	const [routine] = await db
		.update(routines)
		.set({
			name: params.name,
			description: params.description,
			frequency: params.frequency,
			responsibleRole: params.responsibleRole,
			persistenceType: params.persistenceType,
			dataClassification: params.dataClassification,
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

	// Replace control links
	await db.delete(routineControls).where(eq(routineControls.routineId, params.id))
	if (params.controlIds.length > 0) {
		await db.insert(routineControls).values(
			params.controlIds.map((controlId) => ({
				routineId: params.id,
				controlId,
			})),
		)
	}

	// Replace screening question links
	await db.delete(routineScreeningQuestions).where(eq(routineScreeningQuestions.routineId, params.id))
	const links = params.screeningQuestionLinks ?? []
	if (params.screeningQuestionId && !links.some((l) => l.questionId === params.screeningQuestionId)) {
		links.push({ questionId: params.screeningQuestionId, choiceValue: params.screeningChoiceValue })
	}
	if (links.length > 0) {
		await db.insert(routineScreeningQuestions).values(
			links.map((link) => ({
				routineId: params.id,
				questionId: link.questionId,
				choiceValue: link.choiceValue,
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
			responsibleRole: params.responsibleRole,
			persistenceType: params.persistenceType,
			dataClassification: params.dataClassification,
			screeningQuestionId: params.screeningQuestionId,
			screeningQuestionLinks: links,
			technologyElementIds: params.technologyElementIds,
			controlIds: params.controlIds,
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
		.select({
			review: routineReviews,
			applicationName: monitoredApplications.name,
		})
		.from(routineReviews)
		.leftJoin(monitoredApplications, eq(routineReviews.applicationId, monitoredApplications.id))
		.where(eq(routineReviews.routineId, routineId))
		.orderBy(desc(routineReviews.reviewedAt))

	return Promise.all(
		reviews.map(async (row) => {
			const enriched = await enrichReview(row.review)
			return { ...enriched, applicationName: row.applicationName }
		}),
	)
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
	const [participants, attachments, links] = await Promise.all([
		db.select().from(routineReviewParticipants).where(eq(routineReviewParticipants.reviewId, review.id)),
		db
			.select()
			.from(routineReviewAttachments)
			.where(eq(routineReviewAttachments.reviewId, review.id))
			.orderBy(routineReviewAttachments.uploadedAt),
		db
			.select()
			.from(routineReviewLinks)
			.where(eq(routineReviewLinks.reviewId, review.id))
			.orderBy(routineReviewLinks.addedAt),
	])

	return { ...review, participants, attachments, links }
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

// ─── Review Links ────────────────────────────────────────────────────────

export async function addReviewLink(params: { reviewId: string; url: string; title: string | null; addedBy: string }) {
	const [link] = await db
		.insert(routineReviewLinks)
		.values({
			reviewId: params.reviewId,
			url: params.url,
			title: params.title,
			addedBy: params.addedBy,
		})
		.returning()

	await writeAuditLog({
		action: "review_link_added",
		entityType: "routine_review",
		entityId: params.reviewId,
		newValue: params.url,
		performedBy: params.addedBy,
	})

	return link
}

export async function deleteReviewLink(linkId: string, performedBy: string) {
	const [link] = await db.select().from(routineReviewLinks).where(eq(routineReviewLinks.id, linkId)).limit(1)
	if (!link) return null

	await db.delete(routineReviewLinks).where(eq(routineReviewLinks.id, linkId))

	await writeAuditLog({
		action: "review_link_deleted",
		entityType: "routine_review",
		entityId: link.reviewId,
		newValue: link.url,
		performedBy,
	})

	return link
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

	// Use join table for question links; fall back to legacy single link
	const questionLinks =
		routine.screeningQuestions.length > 0
			? routine.screeningQuestions
			: routine.screeningQuestionId && routine.screeningChoiceValue
				? [{ questionId: routine.screeningQuestionId, choiceValue: routine.screeningChoiceValue }]
				: []

	if (questionLinks.length === 0) return []

	// Find apps that answered ANY linked question with the required choice
	const matchingAppSets = await Promise.all(
		questionLinks.map(async (link) => {
			if (!link.choiceValue) return []
			const rows = await db
				.select({ applicationId: screeningAnswers.applicationId })
				.from(screeningAnswers)
				.where(and(eq(screeningAnswers.questionId, link.questionId), eq(screeningAnswers.answer, link.choiceValue)))
			return rows.map((r) => r.applicationId)
		}),
	)

	// Union all matching app IDs
	const appIds = [...new Set(matchingAppSets.flat())]
	if (appIds.length === 0) return []

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
	// Step 1: Find which routines this app matches via screening answers
	// Get all screening answers for this app
	const appAnswers = await db
		.select({ questionId: screeningAnswers.questionId, answer: screeningAnswers.answer })
		.from(screeningAnswers)
		.where(eq(screeningAnswers.applicationId, applicationId))

	if (appAnswers.length === 0) return []

	// Step 2: Find routines linked to these question+answer combinations
	const matchingRoutineIds = new Set<string>()

	// Check via routine_screening_questions join table
	for (const ans of appAnswers) {
		const links = await db
			.select({ routineId: routineScreeningQuestions.routineId })
			.from(routineScreeningQuestions)
			.where(
				sql`${routineScreeningQuestions.questionId} = ${ans.questionId} AND ${routineScreeningQuestions.choiceValue} = ${ans.answer}`,
			)
		for (const l of links) matchingRoutineIds.add(l.routineId)
	}

	// Also check legacy single-link field
	for (const ans of appAnswers) {
		const legacyRoutines = await db
			.select({ id: routines.id })
			.from(routines)
			.where(
				sql`${routines.screeningQuestionId} = ${ans.questionId} AND ${routines.screeningChoiceValue} = ${ans.answer}`,
			)
		for (const r of legacyRoutines) matchingRoutineIds.add(r.id)
	}

	if (matchingRoutineIds.size === 0) return []

	// Step 3: Load matched routines with tech elements and screening questions in batch
	const routineIdList = [...matchingRoutineIds]
	const [routineRows, allElements, allScreeningLinks] = await Promise.all([
		db.select().from(routines).where(inArray(routines.id, routineIdList)),
		db
			.select({
				routineId: routineTechnologyElements.routineId,
				id: technologyElements.id,
				name: technologyElements.name,
			})
			.from(routineTechnologyElements)
			.innerJoin(technologyElements, eq(routineTechnologyElements.elementId, technologyElements.id))
			.where(inArray(routineTechnologyElements.routineId, routineIdList)),
		db.select().from(routineScreeningQuestions).where(inArray(routineScreeningQuestions.routineId, routineIdList)),
	])

	const elemsByRoutine = new Map<string, { id: string; name: string }[]>()
	for (const e of allElements) {
		const list = elemsByRoutine.get(e.routineId) ?? []
		list.push({ id: e.id, name: e.name })
		elemsByRoutine.set(e.routineId, list)
	}
	const screenByRoutine = new Map<string, typeof allScreeningLinks>()
	for (const s of allScreeningLinks) {
		const list = screenByRoutine.get(s.routineId) ?? []
		list.push(s)
		screenByRoutine.set(s.routineId, list)
	}

	// Step 4: Filter by technology elements if required
	const appTechElements = await db
		.select({ elementId: applicationTechnologyElements.elementId })
		.from(applicationTechnologyElements)
		.where(
			and(
				eq(applicationTechnologyElements.applicationId, applicationId),
				isNotNull(applicationTechnologyElements.confirmedAt),
				isNull(applicationTechnologyElements.rejectedAt),
			),
		)
	const appElementIds = new Set(appTechElements.map((e) => e.elementId))

	const [appRow] = await db
		.select({ name: monitoredApplications.name })
		.from(monitoredApplications)
		.where(eq(monitoredApplications.id, applicationId))
		.limit(1)
	const appName = appRow?.name ?? ""

	// Step 5: Get latest reviews for all matching routines in batch
	const latestReviews = await db
		.selectDistinctOn([routineReviews.routineId], {
			routineId: routineReviews.routineId,
			reviewedAt: routineReviews.reviewedAt,
		})
		.from(routineReviews)
		.where(and(inArray(routineReviews.routineId, routineIdList), eq(routineReviews.applicationId, applicationId)))
		.orderBy(routineReviews.routineId, desc(routineReviews.reviewedAt))
	const reviewByRoutine = new Map(latestReviews.map((r) => [r.routineId, r.reviewedAt]))

	// Step 6: Build results
	const results: RoutineDeadlineInfo[] = []

	for (const routine of routineRows) {
		const techElems = elemsByRoutine.get(routine.id) ?? []

		// If routine requires technology elements, check the app has at least one
		if (techElems.length > 0 && !techElems.some((e) => appElementIds.has(e.id))) {
			continue
		}

		const fullRoutine = {
			...routine,
			technologyElements: techElems,
			screeningQuestions: screenByRoutine.get(routine.id) ?? [],
			controls: [],
		}

		const lastReviewDate = reviewByRoutine.get(routine.id) ?? null
		const deadline = calculateDeadline(lastReviewDate, routine.createdAt, routine.frequency as RoutineFrequency)

		results.push({
			routine: fullRoutine,
			applicationId,
			applicationName: appName,
			lastReviewDate,
			deadline,
			overdue: isOverdue(deadline),
		})
	}

	return results
}

// ─── Routines matched by persistence type / data classification ──────────

export async function getRoutineDeadlinesForAppByPersistence(
	applicationId: string,
	excludeRoutineIds: Set<string> = new Set(),
) {
	// Get the app's persistence entries
	const appPersistence = await db
		.select({
			type: applicationPersistence.type,
			dataClassification: applicationPersistence.dataClassification,
		})
		.from(applicationPersistence)
		.where(eq(applicationPersistence.applicationId, applicationId))

	if (appPersistence.length === 0) return []

	const appTypes = new Set(appPersistence.map((p) => p.type))
	const appClassifications = new Set(appPersistence.map((p) => p.dataClassification).filter(Boolean))

	// Find routines that have persistenceType or dataClassification set
	const candidateRoutines = await db
		.select()
		.from(routines)
		.where(sql`${routines.persistenceType} IS NOT NULL OR ${routines.dataClassification} IS NOT NULL`)

	if (candidateRoutines.length === 0) return []

	// Filter to routines that match the app's persistence
	const matchingRoutines = candidateRoutines.filter((r) => {
		if (excludeRoutineIds.has(r.id)) return false

		const typeMatch = !r.persistenceType || appTypes.has(r.persistenceType as PersistenceType)
		const classMatch = !r.dataClassification || appClassifications.has(r.dataClassification as DataClassification)

		return typeMatch && classMatch
	})

	if (matchingRoutines.length === 0) return []

	const routineIdList = matchingRoutines.map((r) => r.id)

	// Load tech elements and screening links in batch
	const [allElements, allScreeningLinks] = await Promise.all([
		db
			.select({
				routineId: routineTechnologyElements.routineId,
				id: technologyElements.id,
				name: technologyElements.name,
			})
			.from(routineTechnologyElements)
			.innerJoin(technologyElements, eq(routineTechnologyElements.elementId, technologyElements.id))
			.where(inArray(routineTechnologyElements.routineId, routineIdList)),
		db.select().from(routineScreeningQuestions).where(inArray(routineScreeningQuestions.routineId, routineIdList)),
	])

	const elemsByRoutine = new Map<string, { id: string; name: string }[]>()
	for (const e of allElements) {
		const list = elemsByRoutine.get(e.routineId) ?? []
		list.push({ id: e.id, name: e.name })
		elemsByRoutine.set(e.routineId, list)
	}
	const screenByRoutine = new Map<string, typeof allScreeningLinks>()
	for (const s of allScreeningLinks) {
		const list = screenByRoutine.get(s.routineId) ?? []
		list.push(s)
		screenByRoutine.set(s.routineId, list)
	}

	const [appRow] = await db
		.select({ name: monitoredApplications.name })
		.from(monitoredApplications)
		.where(eq(monitoredApplications.id, applicationId))
		.limit(1)
	const appName = appRow?.name ?? ""

	// Get latest reviews
	const latestReviews = await db
		.selectDistinctOn([routineReviews.routineId], {
			routineId: routineReviews.routineId,
			reviewedAt: routineReviews.reviewedAt,
		})
		.from(routineReviews)
		.where(and(inArray(routineReviews.routineId, routineIdList), eq(routineReviews.applicationId, applicationId)))
		.orderBy(routineReviews.routineId, desc(routineReviews.reviewedAt))
	const reviewByRoutine = new Map(latestReviews.map((r) => [r.routineId, r.reviewedAt]))

	const results: RoutineDeadlineInfo[] = []
	for (const routine of matchingRoutines) {
		const fullRoutine = {
			...routine,
			technologyElements: elemsByRoutine.get(routine.id) ?? [],
			screeningQuestions: screenByRoutine.get(routine.id) ?? [],
			controls: [],
		}

		const lastReviewDate = reviewByRoutine.get(routine.id) ?? null
		const deadline = calculateDeadline(lastReviewDate, routine.createdAt, routine.frequency as RoutineFrequency)

		results.push({
			routine: fullRoutine,
			applicationId,
			applicationName: appName,
			lastReviewDate,
			deadline,
			overdue: isOverdue(deadline),
		})
	}

	return results
}

// ─── Routines matched by screening routine selections ────────────────────

export async function getRoutineDeadlinesForAppByScreeningSelection(
	applicationId: string,
	excludeRoutineIds: Set<string> = new Set(),
) {
	const selections = await db
		.select({ routineId: screeningRoutineSelections.routineId })
		.from(screeningRoutineSelections)
		.where(
			and(eq(screeningRoutineSelections.applicationId, applicationId), isNotNull(screeningRoutineSelections.routineId)),
		)

	const selectedRoutineIds = selections
		.map((s) => s.routineId)
		.filter((id): id is string => id !== null && !excludeRoutineIds.has(id))

	if (selectedRoutineIds.length === 0) return []

	// Deduplicate
	const uniqueIds = [...new Set(selectedRoutineIds)]

	const [routineRows, allElements, allScreeningLinks] = await Promise.all([
		db.select().from(routines).where(inArray(routines.id, uniqueIds)),
		db
			.select({
				routineId: routineTechnologyElements.routineId,
				id: technologyElements.id,
				name: technologyElements.name,
			})
			.from(routineTechnologyElements)
			.innerJoin(technologyElements, eq(routineTechnologyElements.elementId, technologyElements.id))
			.where(inArray(routineTechnologyElements.routineId, uniqueIds)),
		db.select().from(routineScreeningQuestions).where(inArray(routineScreeningQuestions.routineId, uniqueIds)),
	])

	const elemsByRoutine = new Map<string, { id: string; name: string }[]>()
	for (const e of allElements) {
		const list = elemsByRoutine.get(e.routineId) ?? []
		list.push({ id: e.id, name: e.name })
		elemsByRoutine.set(e.routineId, list)
	}
	const screenByRoutine = new Map<string, typeof allScreeningLinks>()
	for (const s of allScreeningLinks) {
		const list = screenByRoutine.get(s.routineId) ?? []
		list.push(s)
		screenByRoutine.set(s.routineId, list)
	}

	const [appRow] = await db
		.select({ name: monitoredApplications.name })
		.from(monitoredApplications)
		.where(eq(monitoredApplications.id, applicationId))
		.limit(1)
	const appName = appRow?.name ?? ""

	const latestReviews = await db
		.selectDistinctOn([routineReviews.routineId], {
			routineId: routineReviews.routineId,
			reviewedAt: routineReviews.reviewedAt,
		})
		.from(routineReviews)
		.where(and(inArray(routineReviews.routineId, uniqueIds), eq(routineReviews.applicationId, applicationId)))
		.orderBy(routineReviews.routineId, desc(routineReviews.reviewedAt))
	const reviewByRoutine = new Map(latestReviews.map((r) => [r.routineId, r.reviewedAt]))

	const results: RoutineDeadlineInfo[] = []
	for (const routine of routineRows) {
		const fullRoutine = {
			...routine,
			technologyElements: elemsByRoutine.get(routine.id) ?? [],
			screeningQuestions: screenByRoutine.get(routine.id) ?? [],
			controls: [],
		}

		const lastReviewDate = reviewByRoutine.get(routine.id) ?? null
		const deadline = calculateDeadline(lastReviewDate, routine.createdAt, routine.frequency as RoutineFrequency)

		results.push({
			routine: fullRoutine,
			applicationId,
			applicationName: appName,
			lastReviewDate,
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
