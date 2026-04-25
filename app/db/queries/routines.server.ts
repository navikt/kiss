import { and, desc, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm"
import { frequencyDays, type RoutineFrequency } from "../../lib/routine-frequencies"
import { db } from "../connection.server"
import {
	applicationAuthIntegrations,
	applicationEnvironments,
	applicationManualGroups,
	applicationPersistence,
	type DataClassification,
	entraGroupClassifications,
	type GroupAccessClassification,
	type GroupCriticality,
	monitoredApplications,
	naisTeams,
	type PersistenceType,
} from "../schema/applications"
import { oracleRoleAssessments } from "../schema/audit-evidence"
import {
	applicationTechnologyElements,
	frameworkControls,
	frameworkDomains,
	frameworkRiskControlMappings,
	frameworkRisks,
	technologyElements,
} from "../schema/framework"
import {
	type EntraChangeType,
	type RoutineActivityType,
	type RoutineStatus,
	routineControls,
	routineGroupClassificationLinks,
	routineOracleRoleCriticalityLinks,
	routinePersistenceLinks,
	routineReviewActivities,
	routineReviewActivityEntraChanges,
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
	const rows = await db
		.select()
		.from(routines)
		.where(and(eq(routines.sectionId, sectionId), isNull(routines.archivedAt)))
		.orderBy(routines.name)
	if (rows.length === 0) return []

	const routineIds = rows.map((r) => r.id)

	// Batch all sub-queries (4 queries total instead of 4×N)
	const [allElements, allPersLinks, allReviewCounts, allControlRows] = await Promise.all([
		db
			.select({
				routineId: routineTechnologyElements.routineId,
				id: technologyElements.id,
				name: technologyElements.name,
			})
			.from(routineTechnologyElements)
			.innerJoin(technologyElements, eq(routineTechnologyElements.elementId, technologyElements.id))
			.where(inArray(routineTechnologyElements.routineId, routineIds)),
		db.select().from(routinePersistenceLinks).where(inArray(routinePersistenceLinks.routineId, routineIds)),
		db
			.select({
				routineId: routineReviews.routineId,
				count: sql<number>`count(*)::int`,
			})
			.from(routineReviews)
			.where(and(inArray(routineReviews.routineId, routineIds), sql`${routineReviews.status} != 'discarded'`))
			.groupBy(routineReviews.routineId),
		db
			.selectDistinct({
				routineId: routineControls.routineId,
				id: frameworkControls.id,
				controlId: frameworkControls.controlId,
				shortTitle: frameworkControls.shortTitle,
			})
			.from(routineControls)
			.innerJoin(frameworkControls, eq(routineControls.controlId, frameworkControls.id))
			.where(inArray(routineControls.routineId, routineIds)),
	])

	// Group results by routineId
	const elementsByRoutine = new Map<string, { id: string; name: string }[]>()
	for (const el of allElements) {
		const arr = elementsByRoutine.get(el.routineId) ?? []
		arr.push({ id: el.id, name: el.name })
		elementsByRoutine.set(el.routineId, arr)
	}

	const persLinksByRoutine = new Map<string, typeof allPersLinks>()
	for (const pl of allPersLinks) {
		const arr = persLinksByRoutine.get(pl.routineId) ?? []
		arr.push(pl)
		persLinksByRoutine.set(pl.routineId, arr)
	}

	const reviewCountByRoutine = new Map<string, number>()
	for (const rc of allReviewCounts) {
		reviewCountByRoutine.set(rc.routineId, rc.count)
	}

	const controlsByRoutine = new Map<string, { id: string; controlId: string; name: string }[]>()
	for (const cr of allControlRows) {
		const arr = controlsByRoutine.get(cr.routineId) ?? []
		arr.push({ id: cr.id, controlId: cr.controlId, name: cr.shortTitle ?? cr.controlId })
		controlsByRoutine.set(cr.routineId, arr)
	}

	return rows.map((r) => ({
		...r,
		technologyElements: elementsByRoutine.get(r.id) ?? [],
		persistenceLinks: persLinksByRoutine.get(r.id) ?? [],
		reviewCount: reviewCountByRoutine.get(r.id) ?? 0,
		controls: controlsByRoutine.get(r.id) ?? [],
	}))
}

export async function getRoutine(id: string) {
	const [routine] = await db.select().from(routines).where(eq(routines.id, id)).limit(1)
	if (!routine) return null

	const [elements, screeningLinks, persLinks, controlRows, gcLinks, orcLinks] = await Promise.all([
		db
			.select({
				id: technologyElements.id,
				name: technologyElements.name,
			})
			.from(routineTechnologyElements)
			.innerJoin(technologyElements, eq(routineTechnologyElements.elementId, technologyElements.id))
			.where(eq(routineTechnologyElements.routineId, id)),
		db.select().from(routineScreeningQuestions).where(eq(routineScreeningQuestions.routineId, id)),
		db.select().from(routinePersistenceLinks).where(eq(routinePersistenceLinks.routineId, id)),
		db
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
			.where(eq(routineControls.routineId, id)),
		db.select().from(routineGroupClassificationLinks).where(eq(routineGroupClassificationLinks.routineId, id)),
		db.select().from(routineOracleRoleCriticalityLinks).where(eq(routineOracleRoleCriticalityLinks.routineId, id)),
	])

	const controls = controlRows.map((c) => ({
		id: c.id,
		controlId: c.controlId,
		name: c.shortTitle ?? c.controlId,
		responsible: c.responsible,
		domainSlug: c.domainSlug,
	}))

	return {
		...routine,
		technologyElements: elements,
		screeningQuestions: screeningLinks,
		persistenceLinks: persLinks,
		controls,
		groupClassifications: gcLinks,
		oracleRoleCriticalities: orcLinks,
	}
}

/**
 * Oppretter en ny rutine med tilhørende koblinger (screening, teknologielementer,
 * kontroller, persistens, gruppeklassifiseringer). Skriver audit-logg.
 */
export async function createRoutine(params: {
	sectionId: string
	name: string
	description: string | null
	frequency: RoutineFrequency
	responsibleRole: string | null
	appliesToAllInSection: boolean
	activityType?: RoutineActivityType | null
	persistenceLinks: Array<{
		persistenceType: PersistenceType | null
		dataClassification: DataClassification | null
	}>
	screeningQuestionId: string | null
	screeningChoiceValue: string | null
	screeningQuestionLinks?: Array<{ questionId: string; choiceValue: string | null }>
	technologyElementIds: string[]
	controlIds: string[]
	groupClassifications?: GroupAccessClassification[]
	oracleRoleCriticalities?: GroupCriticality[]
	status?: RoutineStatus
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
			appliesToAllInSection: params.appliesToAllInSection ? 1 : 0,
			activityType: params.activityType ?? null,
			screeningQuestionId: params.screeningQuestionId,
			screeningChoiceValue: params.screeningChoiceValue,
			...(params.status && { status: params.status }),
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

	// Insert persistence links
	if (params.persistenceLinks.length > 0) {
		await db.insert(routinePersistenceLinks).values(
			params.persistenceLinks.map((link) => ({
				routineId: routine.id,
				persistenceType: link.persistenceType,
				dataClassification: link.dataClassification,
			})),
		)
	}

	// Insert group classification links
	const gcLinks = params.groupClassifications ?? []
	if (gcLinks.length > 0) {
		await db.insert(routineGroupClassificationLinks).values(
			gcLinks.map((classification) => ({
				routineId: routine.id,
				classification,
			})),
		)
	}

	// Insert oracle role criticality links
	const orcLinks = params.oracleRoleCriticalities ?? []
	if (orcLinks.length > 0) {
		await db.insert(routineOracleRoleCriticalityLinks).values(
			orcLinks.map((criticality) => ({
				routineId: routine.id,
				criticality,
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
			persistenceLinks: params.persistenceLinks,
			screeningQuestionId: params.screeningQuestionId,
			screeningQuestionLinks: links,
			technologyElementIds: params.technologyElementIds,
			controlIds: params.controlIds,
		},
		performedBy: params.createdBy,
	})

	return routine
}

/**
 * Oppdaterer en eksisterende rutine. Kaster 403 hvis rutinen er godkjent
 * (godkjente rutiner er låst). Erstatter alle koblinger og skriver audit-logg.
 */
export async function updateRoutine(params: {
	id: string
	name: string
	description: string | null
	frequency: RoutineFrequency
	responsibleRole: string | null
	appliesToAllInSection: boolean
	activityType?: RoutineActivityType | null
	persistenceLinks: Array<{
		persistenceType: PersistenceType | null
		dataClassification: DataClassification | null
	}>
	screeningQuestionId: string | null
	screeningChoiceValue: string | null
	screeningQuestionLinks?: Array<{ questionId: string; choiceValue: string | null }>
	technologyElementIds: string[]
	controlIds: string[]
	groupClassifications?: GroupAccessClassification[]
	oracleRoleCriticalities?: GroupCriticality[]
	status?: RoutineStatus
	updatedBy: string
}) {
	const prev = await getRoutine(params.id)
	if (prev?.status === "approved") {
		throw new Response("Kan ikke redigere en godkjent rutine", { status: 403 })
	}

	const [routine] = await db
		.update(routines)
		.set({
			name: params.name,
			description: params.description,
			frequency: params.frequency,
			responsibleRole: params.responsibleRole,
			appliesToAllInSection: params.appliesToAllInSection ? 1 : 0,
			activityType: params.activityType ?? null,
			screeningQuestionId: params.screeningQuestionId,
			screeningChoiceValue: params.screeningChoiceValue,
			...(params.status && { status: params.status }),
			updatedBy: params.updatedBy,
			updatedAt: new Date(),
		})
		.where(eq(routines.id, params.id))
		.returning()

	// Replace technology element links — bevar koblinger til arkiverte elementer
	// (edit-skjemaet viser bare aktive elementer, så uten denne preserve-logikken
	// ville arkiverte koblinger forsvinne stille ved lagring). Pakkes i tx med
	// FOR SHARE på technology_elements for å hindre at arkivering skjer mellom
	// lesing av arkivstatus og innsetting av nye koblinger.
	await db.transaction(async (tx) => {
		const existingTechLinks = await tx
			.select({
				elementId: routineTechnologyElements.elementId,
				archivedAt: technologyElements.archivedAt,
			})
			.from(routineTechnologyElements)
			.innerJoin(technologyElements, eq(technologyElements.id, routineTechnologyElements.elementId))
			.where(eq(routineTechnologyElements.routineId, params.id))
			.for("share", { of: technologyElements })
		const archivedTechToPreserve = existingTechLinks.filter((e) => e.archivedAt).map((e) => e.elementId)
		const finalTechIds = Array.from(new Set([...params.technologyElementIds, ...archivedTechToPreserve]))

		await tx.delete(routineTechnologyElements).where(eq(routineTechnologyElements.routineId, params.id))
		if (finalTechIds.length > 0) {
			await tx.insert(routineTechnologyElements).values(
				finalTechIds.map((elementId) => ({
					routineId: params.id,
					elementId,
				})),
			)
		}
	})

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

	// Replace persistence links
	await db.delete(routinePersistenceLinks).where(eq(routinePersistenceLinks.routineId, params.id))
	if (params.persistenceLinks.length > 0) {
		await db.insert(routinePersistenceLinks).values(
			params.persistenceLinks.map((link) => ({
				routineId: params.id,
				persistenceType: link.persistenceType,
				dataClassification: link.dataClassification,
			})),
		)
	}

	// Replace group classification links
	await db.delete(routineGroupClassificationLinks).where(eq(routineGroupClassificationLinks.routineId, params.id))
	const gcLinks = params.groupClassifications ?? []
	if (gcLinks.length > 0) {
		await db.insert(routineGroupClassificationLinks).values(
			gcLinks.map((classification) => ({
				routineId: params.id,
				classification,
			})),
		)
	}

	// Replace oracle role criticality links
	await db.delete(routineOracleRoleCriticalityLinks).where(eq(routineOracleRoleCriticalityLinks.routineId, params.id))
	const orcLinks = params.oracleRoleCriticalities ?? []
	if (orcLinks.length > 0) {
		await db.insert(routineOracleRoleCriticalityLinks).values(
			orcLinks.map((criticality) => ({
				routineId: params.id,
				criticality,
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
			persistenceLinks: params.persistenceLinks,
			screeningQuestionId: params.screeningQuestionId,
			screeningQuestionLinks: links,
			technologyElementIds: params.technologyElementIds,
			controlIds: params.controlIds,
		},
		performedBy: params.updatedBy,
	})

	return routine
}

/**
 * Arkiverer (soft-delete) en rutine. Rutinen blir skjult fra brukervendte
 * lister via filteret isNull(archived_at), men beholder all konfigurasjon,
 * gjennomganger og audit-logg. FK-er fra rutinekonfigurasjon og historikk
 * er ON DELETE RESTRICT, så fysisk DELETE er umulig.
 *
 * TOCTOU-sikkerhet: guarded UPDATE WHERE archived_at IS NULL evalueres
 * atomisk. UPDATE og audit-skriving kjører i samme transaksjon (AGENTS.md
 * regel 6).
 */
export async function archiveRoutine(id: string, performedBy: string) {
	return db.transaction(async (tx) => {
		const [archived] = await tx
			.update(routines)
			.set({
				archivedAt: new Date(),
				archivedBy: performedBy,
				updatedAt: new Date(),
				updatedBy: performedBy,
			})
			.where(and(eq(routines.id, id), isNull(routines.archivedAt)))
			.returning()
		if (!archived) {
			const [existing] = await tx.select().from(routines).where(eq(routines.id, id)).limit(1)
			if (!existing) return null
			return existing
		}
		await writeAuditLog(
			{
				action: "routine_archived",
				entityType: "routine",
				entityId: id,
				previousValue: JSON.stringify({ name: archived.name }),
				newValue: JSON.stringify({ name: archived.name, archivedAt: archived.archivedAt }),
				performedBy,
			},
			tx,
		)
		return archived
	})
}

/**
 * Reaktiverer en arkivert rutine. SELECT FOR UPDATE for å låse raden og
 * fange faktisk pre-update archived_at, slik at audit-loggens previousValue
 * registrerer når rutinen var arkivert.
 *
 * Legacy-håndtering: hvis rutinen har status='deleted' (fra det gamle
 * hard-delete-mønsteret, backfilled av migrasjon 0042), tilbakestilles
 * status til 'draft' i samme UPDATE. Ellers ville rutinen blitt liggende
 * i en inkonsistent tilstand der status-guarder fortsatt blokkerer
 * redigering, samtidig som archivedAt-baserte filtre slipper den gjennom.
 */
export async function unarchiveRoutine(id: string, performedBy: string) {
	return db.transaction(async (tx) => {
		const [existing] = await tx.select().from(routines).where(eq(routines.id, id)).for("update").limit(1)
		if (!existing) return null
		if (!existing.archivedAt) return existing
		const previousArchivedAt = existing.archivedAt
		const previousStatus = existing.status
		const restoreLegacyStatus = previousStatus === "deleted"
		const [routine] = await tx
			.update(routines)
			.set({
				archivedAt: null,
				archivedBy: null,
				...(restoreLegacyStatus ? { status: "draft" as const } : {}),
				updatedAt: new Date(),
				updatedBy: performedBy,
			})
			.where(eq(routines.id, id))
			.returning()
		await writeAuditLog(
			{
				action: "routine_unarchived",
				entityType: "routine",
				entityId: id,
				previousValue: JSON.stringify({
					name: routine.name,
					archivedAt: previousArchivedAt,
					...(restoreLegacyStatus ? { status: previousStatus } : {}),
				}),
				newValue: JSON.stringify({
					name: routine.name,
					...(restoreLegacyStatus ? { status: routine.status } : {}),
				}),
				performedBy,
			},
			tx,
		)
		return routine
	})
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
		.where(and(eq(routineReviews.routineId, routineId), sql`${routineReviews.status} != 'discarded'`))
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
		.where(and(eq(routineReviews.applicationId, applicationId), sql`${routineReviews.status} != 'discarded'`))
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

/**
 * Oppretter en gjennomgang (review) av en rutine for en gitt applikasjon.
 * Kaster feil hvis rutinen ikke er aktiv eller godkjent, eller hvis den er
 * arkivert (soft-deleted). Skriver audit-logg.
 */
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
	// Atomisk: hele lookup → guard → INSERT-kjeden kjøres i tx med
	// FOR SHARE-lås på routine-raden, så samtidig archiveRoutine() blokkeres
	// til vår tx er ferdig (lukker TOCTOU mellom guard og INSERT).
	return db.transaction(async (tx) => {
		const [routine] = await tx
			.select({ status: routines.status, archivedAt: routines.archivedAt })
			.from(routines)
			.where(eq(routines.id, params.routineId))
			.for("share")
			.limit(1)
		if (!routine) throw new Response(`Rutine ikke funnet: ${params.routineId}`, { status: 404 })
		if (routine.archivedAt)
			throw new Response("Kan ikke opprette gjennomgang for en arkivert rutine. Reaktiver rutinen først.", {
				status: 403,
			})
		if (routine.status !== "active" && routine.status !== "approved")
			throw new Response("Kan ikke opprette gjennomgang for en rutine som ikke er aktiv eller godkjent", {
				status: 400,
			})

		const [review] = await tx
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
			await tx.insert(routineReviewParticipants).values(
				params.participants.map((p) => ({
					reviewId: review.id,
					userIdent: p.userIdent,
					userName: p.userName,
				})),
			)
		}

		await writeAuditLog(
			{
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
			},
			tx,
		)

		return review
	})
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

	// Atomisk: archive-guard + status-guard + UPDATE/participants i tx med
	// FOR SHARE-lås på foreldre-rutinen og henter review-status atomisk så
	// samtidig archiveRoutine() / completeReview() blokkeres / detekteres.
	await db.transaction(async (tx) => {
		const [snapshot] = await tx
			.select({ archivedAt: routines.archivedAt, reviewStatus: routineReviews.status })
			.from(routineReviews)
			.innerJoin(routines, eq(routineReviews.routineId, routines.id))
			.where(eq(routineReviews.id, reviewId))
			.for("share", { of: [routines] })
			.limit(1)
		if (!snapshot) {
			throw new Response("Gjennomgang ikke funnet.", { status: 404 })
		}
		if (snapshot.archivedAt) {
			throw new Response("Kan ikke endre gjennomganger på en arkivert rutine. Reaktiver rutinen først.", {
				status: 403,
			})
		}
		if (snapshot.reviewStatus === "completed") {
			// Status endret seg fra ikke-completed (pre-check) til completed
			// inne i tx-vinduet (samtidig completeReview-race) → 409 Conflict.
			throw new Response("Gjennomgangen kan ikke endres lenger (status endret seg).", { status: 409 })
		}

		if (Object.keys(updates).length > 0) {
			await tx.update(routineReviews).set(updates).where(eq(routineReviews.id, reviewId))
		}

		if (params.participants !== undefined) {
			await tx.delete(routineReviewParticipants).where(eq(routineReviewParticipants.reviewId, reviewId))
			if (params.participants.length > 0) {
				await tx.insert(routineReviewParticipants).values(
					params.participants.map((p) => ({
						reviewId,
						userIdent: p.userIdent,
						userName: p.userName,
					})),
				)
			}
		}

		await writeAuditLog(
			{
				action: "routine_review_updated",
				entityType: "routine_review",
				entityId: reviewId,
				newValue: JSON.stringify(updates),
				performedBy,
			},
			tx,
		)
	})

	return getReview(reviewId)
}

/**
 * Markerer en gjennomgang som fullført. Fullfører eventuell pågående aktivitet
 * (med snapshot-after for Entra-grupper) og synker materialiserte
 * compliance-kontroller for tilknyttet applikasjon.
 */
export async function completeReview(reviewId: string, performedBy: string) {
	const existing = await getReview(reviewId)
	if (!existing) return null
	if (existing.status === "completed") return existing

	// Bygg Entra-snapshot UTENFOR tx (eksternt HTTP-kall mot Microsoft Graph).
	// Selve activity-completion + status-UPDATE går inn i samme tx for å
	// hindre inkonsistente tilstander (aktivitet=completed, review≠completed).
	const activity = await getReviewActivity(reviewId)
	let snapshotAfter: EntraGroupSnapshot | null = null
	if (activity?.status === "pending" && activity.type === "entra_id_group_maintenance" && existing.applicationId) {
		snapshotAfter = await buildEntraGroupSnapshot(existing.applicationId)
	}

	// Atomisk: archive-guard + activity-complete + status UPDATE i samme tx
	// med FOR SHARE-lås på foreldre-rutinen så samtidig archiveRoutine()
	// blokkeres til vår tx er ferdig. Audit + compliance-sync hopper over
	// hvis status-UPDATE matchet 0 rader (samtidig completion-race).
	const statusChanged = await db.transaction(async (tx) => {
		const [archiveStatus] = await tx
			.select({ archivedAt: routines.archivedAt })
			.from(routineReviews)
			.innerJoin(routines, eq(routineReviews.routineId, routines.id))
			.where(eq(routineReviews.id, reviewId))
			.for("share", { of: [routines] })
			.limit(1)
		if (archiveStatus?.archivedAt) {
			throw new Response("Kan ikke fullføre gjennomganger på en arkivert rutine. Reaktiver rutinen først.", {
				status: 403,
			})
		}

		// Aktivitet fullføres innenfor tx slik at den rolles back hvis
		// status-UPDATE feiler eller archive-guarden kaster.
		if (activity && activity.status === "pending") {
			await completeReviewActivity(activity.id, snapshotAfter, performedBy, tx)
		}

		const updated = await tx
			.update(routineReviews)
			.set({ status: "completed" })
			.where(and(eq(routineReviews.id, reviewId), ne(routineReviews.status, "completed")))
			.returning({ id: routineReviews.id })

		// Status endret seg mellom pre-check og UPDATE (samtidig completeReview)
		// → hopp over audit; en annen request har allerede skrevet completion.
		if (updated.length === 0) return false

		await writeAuditLog(
			{
				action: "routine_review_completed",
				entityType: "routine_review",
				entityId: reviewId,
				newValue: "completed",
				performedBy,
			},
			tx,
		)
		return true
	})

	// Sync materialiserte compliance-kontroller — utenfor tx fordi det er
	// en stor batch-operasjon. Kjør kun hvis vi faktisk fullførte review-en.
	if (statusChanged && existing.applicationId) {
		const { syncApplicationControls } = await import("./application-controls.server")
		await syncApplicationControls(existing.applicationId, performedBy)
	}

	return getReview(reviewId)
}

/** Forkaster en gjennomgang i draft-status. Returnerer null hvis ikke draft. */
export async function discardReview(reviewId: string, performedBy: string) {
	const existing = await getReview(reviewId)
	if (!existing) return null
	if (existing.status !== "draft") return null

	// Atomisk: kjøres i transaksjon med FOR SHARE på foreldre-rutinen (blokkerer
	// samtidig archiveRoutine) og atomisk UPDATE...WHERE status='draft' RETURNING
	// som re-validerer review-status inne i tx (lukker TOCTOU mot completeReview
	// e.l.). Pre-check utenfor tx beholdes så ikke-draft-reviews fortsatt
	// returnerer null (bevarer kallerens kontrakt) i stedet for å kaste 403.
	return db.transaction(async (tx) => {
		const [archiveStatus] = await tx
			.select({ archivedAt: routines.archivedAt })
			.from(routineReviews)
			.innerJoin(routines, eq(routineReviews.routineId, routines.id))
			.where(eq(routineReviews.id, reviewId))
			.for("share", { of: [routines] })
			.limit(1)
		if (archiveStatus?.archivedAt) {
			throw new Response("Kan ikke kassere gjennomganger på en arkivert rutine. Reaktiver rutinen først.", {
				status: 403,
			})
		}

		const updated = await tx
			.update(routineReviews)
			.set({ status: "discarded" })
			.where(and(eq(routineReviews.id, reviewId), eq(routineReviews.status, "draft")))
			.returning({ id: routineReviews.id })

		// Status endret seg mellom pre-check og UPDATE (f.eks. samtidig
		// completeReview) → respekter kontrakten og returner null.
		if (updated.length === 0) return null

		await writeAuditLog(
			{
				action: "routine_review_discarded",
				entityType: "routine_review",
				entityId: reviewId,
				previousValue: existing.title,
				metadata: {
					routineId: existing.routineId,
					applicationId: existing.applicationId,
				},
				performedBy,
			},
			tx,
		)

		return { ...existing, status: "discarded" as const }
	})
}

/**
 * Lettvekts-helper som henter `archivedAt` (og routineId) for foreldre-rutinen
 * til en gjennomgang via én enkelt JOIN-spørring. Brukes av soft-delete-guards
 * i actions/loaders/queries der vi kun trenger å sjekke arkivert-status, og
 * der full `getReview()`/`getRoutine()` (med subqueries på participants,
 * attachments, kontroller, teknologielementer osv.) ville vært unødvendig
 * tungt per request.
 *
 * Returnerer `null` hvis gjennomgangen ikke finnes.
 */
export async function getRoutineArchivedStatusByReviewId(
	reviewId: string,
): Promise<{ routineId: string; archivedAt: Date | null } | null> {
	const [row] = await db
		.select({
			routineId: routines.id,
			archivedAt: routines.archivedAt,
		})
		.from(routineReviews)
		.innerJoin(routines, eq(routineReviews.routineId, routines.id))
		.where(eq(routineReviews.id, reviewId))
		.limit(1)
	return row ?? null
}

// ─── Review Links ────────────────────────────────────────────────────────

export async function addReviewLink(params: { reviewId: string; url: string; title: string | null; addedBy: string }) {
	// Atomisk: archive-guard + INSERT i tx med FOR SHARE-lås på foreldre-
	// rutinen så samtidig archiveRoutine() blokkeres til vår tx er ferdig
	// (lukker TOCTOU mellom action-level archived-guard og INSERT).
	return db.transaction(async (tx) => {
		const [archiveStatus] = await tx
			.select({ archivedAt: routines.archivedAt })
			.from(routineReviews)
			.innerJoin(routines, eq(routineReviews.routineId, routines.id))
			.where(eq(routineReviews.id, params.reviewId))
			.for("share", { of: [routines] })
			.limit(1)
		if (!archiveStatus) {
			throw new Response("Gjennomgang ikke funnet.", { status: 404 })
		}
		if (archiveStatus.archivedAt) {
			throw new Response("Kan ikke legge til lenker på en arkivert rutine. Reaktiver rutinen først.", { status: 403 })
		}

		const [link] = await tx
			.insert(routineReviewLinks)
			.values({
				reviewId: params.reviewId,
				url: params.url,
				title: params.title,
				addedBy: params.addedBy,
			})
			.returning()

		await writeAuditLog(
			{
				action: "review_link_added",
				entityType: "routine_review",
				entityId: params.reviewId,
				newValue: params.url,
				performedBy: params.addedBy,
			},
			tx,
		)

		return link
	})
}

/**
 * Sletter en review-lenke. Tar `expectedReviewId` for å forhindre IDOR
 * (kun lenker som tilhører den oppgitte gjennomgangen kan slettes via en
 * gitt rute-kontekst). Avviser også sletting hvis foreldre-rutinen er
 * arkivert.
 *
 * Hele operasjonen kjøres i en transaksjon med `FOR SHARE`-lås på
 * foreldre-rutinen, slik at en samtidig `archiveRoutine()` blokkeres til
 * vår transaksjon er ferdig — sjekk og DELETE blir atomisk og lukker
 * TOCTOU-vinduet mellom archived-sjekk og sletting.
 */
export async function deleteReviewLink(linkId: string, expectedReviewId: string, performedBy: string) {
	return db.transaction(async (tx) => {
		// Lås foreldre-rutinen (FOR SHARE) — blokkerer samtidig archive,
		// men tillater andre lesere. JOIN-spørring henter reviewId, routineId
		// og archivedAt i ett kall.
		const [archiveStatus] = await tx
			.select({
				reviewId: routineReviewLinks.reviewId,
				archivedAt: routines.archivedAt,
			})
			.from(routineReviewLinks)
			.innerJoin(routineReviews, eq(routineReviewLinks.reviewId, routineReviews.id))
			.innerJoin(routines, eq(routineReviews.routineId, routines.id))
			.where(eq(routineReviewLinks.id, linkId))
			.for("share", { of: [routines] })
			.limit(1)
		if (!archiveStatus) return null
		if (archiveStatus.reviewId !== expectedReviewId) {
			throw new Response("Lenken tilhører ikke denne gjennomgangen.", { status: 403 })
		}
		if (archiveStatus.archivedAt) {
			throw new Response("Kan ikke slette lenker på en arkivert rutine. Reaktiver rutinen først.", { status: 403 })
		}

		const [link] = await tx.delete(routineReviewLinks).where(eq(routineReviewLinks.id, linkId)).returning()
		if (!link) return null

		await writeAuditLog(
			{
				action: "review_link_deleted",
				entityType: "routine_review",
				entityId: link.reviewId,
				newValue: link.url,
				performedBy,
			},
			tx,
		)

		return link
	})
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
			.where(and(inArray(monitoredApplications.id, filteredIds), isNull(monitoredApplications.archivedAt)))
			.orderBy(monitoredApplications.name)
	}

	// No technology element filter — all matching apps
	return db
		.select()
		.from(monitoredApplications)
		.where(and(inArray(monitoredApplications.id, appIds), isNull(monitoredApplications.archivedAt)))
		.orderBy(monitoredApplications.name)
}

// ─── Deadlines — overdue and upcoming ────────────────────────────────────

export async function getLatestReviewForApp(routineId: string, applicationId: string) {
	const [review] = await db
		.select()
		.from(routineReviews)
		.where(
			and(
				eq(routineReviews.routineId, routineId),
				eq(routineReviews.applicationId, applicationId),
				eq(routineReviews.status, "completed"),
			),
		)
		.orderBy(desc(routineReviews.reviewedAt))
		.limit(1)

	return review ?? null
}

/**
 * Beregner neste frist for en rutine basert på frekvens. Bruker `lastReviewDate`
 * hvis tilgjengelig, ellers `routineCreatedAt` som baseline.
 */
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

/** Returnerer true hvis fristen ligger i fortid. */
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
	matchedPersistenceLinks?: Array<{ persistenceType: string | null; dataClassification: string | null }>
}

export async function getRoutineDeadlinesForSection(sectionId: string): Promise<RoutineDeadlineInfo[]> {
	const sectionRoutines = await db
		.select()
		.from(routines)
		.where(
			and(
				eq(routines.sectionId, sectionId),
				and(inArray(routines.status, ["active", "approved"]), isNull(routines.archivedAt)),
			),
		)

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

	// Also check legacy single-link field (active routines only)
	for (const ans of appAnswers) {
		const legacyRoutines = await db
			.select({ id: routines.id })
			.from(routines)
			.where(
				and(
					sql`${routines.screeningQuestionId} = ${ans.questionId} AND ${routines.screeningChoiceValue} = ${ans.answer}`,
					and(inArray(routines.status, ["active", "approved"]), isNull(routines.archivedAt)),
				),
			)
		for (const r of legacyRoutines) matchingRoutineIds.add(r.id)
	}

	if (matchingRoutineIds.size === 0) return []

	// Step 3: Load matched routines with tech elements, screening questions, and persistence links in batch
	const routineIdList = [...matchingRoutineIds]
	const [routineRows, allElements, allScreeningLinks, allPersLinks] = await Promise.all([
		db
			.select()
			.from(routines)
			.where(
				and(
					inArray(routines.id, routineIdList),
					and(inArray(routines.status, ["active", "approved"]), isNull(routines.archivedAt)),
				),
			),
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
		db.select().from(routinePersistenceLinks).where(inArray(routinePersistenceLinks.routineId, routineIdList)),
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
	const persByRoutine = new Map<string, typeof allPersLinks>()
	for (const p of allPersLinks) {
		const list = persByRoutine.get(p.routineId) ?? []
		list.push(p)
		persByRoutine.set(p.routineId, list)
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

	// Step 5: Get latest completed reviews for all matching routines in batch
	const latestReviews = await db
		.selectDistinctOn([routineReviews.routineId], {
			routineId: routineReviews.routineId,
			reviewedAt: routineReviews.reviewedAt,
		})
		.from(routineReviews)
		.where(
			and(
				inArray(routineReviews.routineId, routineIdList),
				eq(routineReviews.applicationId, applicationId),
				eq(routineReviews.status, "completed"),
			),
		)
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
			persistenceLinks: persByRoutine.get(routine.id) ?? [],
			controls: [],
			groupClassifications: [],
			oracleRoleCriticalities: [],
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
	// Get the app's persistence entries (filter out archived/soft-deleted)
	const appPersistence = await db
		.select({
			type: applicationPersistence.type,
			dataClassification: applicationPersistence.dataClassification,
		})
		.from(applicationPersistence)
		.where(and(eq(applicationPersistence.applicationId, applicationId), isNull(applicationPersistence.archivedAt)))

	if (appPersistence.length === 0) return []

	const appTypes = new Set(appPersistence.map((p) => p.type))
	const appClassifications = new Set(appPersistence.map((p) => p.dataClassification).filter(Boolean))

	// Find routines that have any persistence links
	const allPersLinks = await db.select().from(routinePersistenceLinks)
	if (allPersLinks.length === 0) return []

	// Group persistence links by routine
	const persLinksByRoutine = new Map<string, typeof allPersLinks>()
	for (const link of allPersLinks) {
		const list = persLinksByRoutine.get(link.routineId) ?? []
		list.push(link)
		persLinksByRoutine.set(link.routineId, list)
	}

	// Get all routines that have persistence links
	const routineIds = [...persLinksByRoutine.keys()].filter((id) => !excludeRoutineIds.has(id))
	if (routineIds.length === 0) return []

	const candidateRoutines = await db
		.select()
		.from(routines)
		.where(
			and(
				inArray(routines.id, routineIds),
				and(inArray(routines.status, ["active", "approved"]), isNull(routines.archivedAt)),
			),
		)

	// Filter to routines where at least one persistence link matches the app
	const matchingRoutines: Array<{ routine: (typeof candidateRoutines)[number]; matchedLinks: typeof allPersLinks }> = []
	for (const r of candidateRoutines) {
		const links = persLinksByRoutine.get(r.id) ?? []
		const matched = links.filter((link) => {
			const typeMatch = !link.persistenceType || appTypes.has(link.persistenceType as PersistenceType)
			const classMatch =
				!link.dataClassification || appClassifications.has(link.dataClassification as DataClassification)
			return typeMatch && classMatch
		})
		if (matched.length > 0) {
			matchingRoutines.push({ routine: r, matchedLinks: matched })
		}
	}

	if (matchingRoutines.length === 0) return []

	const routineIdList = matchingRoutines.map((m) => m.routine.id)

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

	// Get latest completed reviews
	const latestReviews = await db
		.selectDistinctOn([routineReviews.routineId], {
			routineId: routineReviews.routineId,
			reviewedAt: routineReviews.reviewedAt,
		})
		.from(routineReviews)
		.where(
			and(
				inArray(routineReviews.routineId, routineIdList),
				eq(routineReviews.applicationId, applicationId),
				eq(routineReviews.status, "completed"),
			),
		)
		.orderBy(routineReviews.routineId, desc(routineReviews.reviewedAt))
	const reviewByRoutine = new Map(latestReviews.map((r) => [r.routineId, r.reviewedAt]))

	const results: RoutineDeadlineInfo[] = []
	for (const { routine, matchedLinks } of matchingRoutines) {
		const fullRoutine = {
			...routine,
			technologyElements: elemsByRoutine.get(routine.id) ?? [],
			screeningQuestions: screenByRoutine.get(routine.id) ?? [],
			persistenceLinks: persLinksByRoutine.get(routine.id) ?? [],
			controls: [],
			groupClassifications: [],
			oracleRoleCriticalities: [],
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
			matchedPersistenceLinks: matchedLinks.map((l) => ({
				persistenceType: l.persistenceType,
				dataClassification: l.dataClassification,
			})),
		})
	}

	return results
}

// ─── Routines matched by Entra group access classification ───────────────

export async function getRoutineDeadlinesForAppByGroupClassification(
	applicationId: string,
	excludeRoutineIds: Set<string> = new Set(),
) {
	// Get group IDs from auth integrations (JSON array in groups column)
	const authIntegrations = await db
		.select({ groups: applicationAuthIntegrations.groups })
		.from(applicationAuthIntegrations)
		.where(eq(applicationAuthIntegrations.applicationId, applicationId))

	const groupIds = new Set<string>()
	for (const ai of authIntegrations) {
		if (!ai.groups) continue
		try {
			const parsed = JSON.parse(ai.groups) as string[]
			for (const gid of parsed) groupIds.add(gid)
		} catch {
			// Invalid JSON — skip
		}
	}

	// Also include manually added groups
	const manualGroups = await db
		.select({ groupId: applicationManualGroups.groupId })
		.from(applicationManualGroups)
		.where(eq(applicationManualGroups.applicationId, applicationId))
	for (const mg of manualGroups) groupIds.add(mg.groupId)

	if (groupIds.size === 0) return []

	// Get classifications for these groups
	const classifications = await db
		.select({
			groupId: entraGroupClassifications.groupId,
			classification: entraGroupClassifications.classification,
		})
		.from(entraGroupClassifications)
		.where(inArray(entraGroupClassifications.groupId, [...groupIds]))

	if (classifications.length === 0) return []

	const appClassifications = new Set(classifications.map((c) => c.classification))

	// Find routines with matching group classification links
	const allGcLinks = await db.select().from(routineGroupClassificationLinks)
	if (allGcLinks.length === 0) return []

	const gcLinksByRoutine = new Map<string, typeof allGcLinks>()
	for (const link of allGcLinks) {
		const list = gcLinksByRoutine.get(link.routineId) ?? []
		list.push(link)
		gcLinksByRoutine.set(link.routineId, list)
	}

	const routineIds = [...gcLinksByRoutine.keys()].filter((id) => !excludeRoutineIds.has(id))
	if (routineIds.length === 0) return []

	const candidateRoutines = await db
		.select()
		.from(routines)
		.where(
			and(
				inArray(routines.id, routineIds),
				and(inArray(routines.status, ["active", "approved"]), isNull(routines.archivedAt)),
			),
		)

	// Filter to routines where at least one classification link matches
	const matchingRoutines: Array<{ routine: (typeof candidateRoutines)[number] }> = []
	for (const r of candidateRoutines) {
		const links = gcLinksByRoutine.get(r.id) ?? []
		const hasMatch = links.some((link) => appClassifications.has(link.classification))
		if (hasMatch) {
			matchingRoutines.push({ routine: r })
		}
	}

	if (matchingRoutines.length === 0) return []

	const routineIdList = matchingRoutines.map((m) => m.routine.id)

	// Load tech elements, screening links, and persistence links in batch
	const [allElements, allScreeningLinks, allPersLinks] = await Promise.all([
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
		db.select().from(routinePersistenceLinks).where(inArray(routinePersistenceLinks.routineId, routineIdList)),
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
	const persLinksByRoutine = new Map<string, typeof allPersLinks>()
	for (const p of allPersLinks) {
		const list = persLinksByRoutine.get(p.routineId) ?? []
		list.push(p)
		persLinksByRoutine.set(p.routineId, list)
	}

	const [appRow] = await db
		.select({ name: monitoredApplications.name })
		.from(monitoredApplications)
		.where(eq(monitoredApplications.id, applicationId))
		.limit(1)
	const appName = appRow?.name ?? ""

	// Get latest completed reviews
	const latestReviews = await db
		.selectDistinctOn([routineReviews.routineId], {
			routineId: routineReviews.routineId,
			reviewedAt: routineReviews.reviewedAt,
		})
		.from(routineReviews)
		.where(
			and(
				inArray(routineReviews.routineId, routineIdList),
				eq(routineReviews.applicationId, applicationId),
				eq(routineReviews.status, "completed"),
			),
		)
		.orderBy(routineReviews.routineId, desc(routineReviews.reviewedAt))
	const reviewByRoutine = new Map(latestReviews.map((r) => [r.routineId, r.reviewedAt]))

	const results: RoutineDeadlineInfo[] = []
	for (const { routine } of matchingRoutines) {
		const fullRoutine = {
			...routine,
			technologyElements: elemsByRoutine.get(routine.id) ?? [],
			screeningQuestions: screenByRoutine.get(routine.id) ?? [],
			persistenceLinks: persLinksByRoutine.get(routine.id) ?? [],
			controls: [],
			groupClassifications: [],
			oracleRoleCriticalities: [],
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

// ─── Routines matched by Oracle role criticality ─────────────────────────

export async function getRoutineDeadlinesForAppByOracleRoleCriticality(
	applicationId: string,
	excludeRoutineIds: Set<string> = new Set(),
) {
	// Get the app's oracle role assessments
	const assessments = await db
		.select({ criticality: oracleRoleAssessments.criticality })
		.from(oracleRoleAssessments)
		.where(eq(oracleRoleAssessments.applicationId, applicationId))

	if (assessments.length === 0) return []

	const appCriticalities = [...new Set(assessments.map((a) => a.criticality))]

	// Find routine IDs with matching criticality directly in SQL
	const excludeIds = [...excludeRoutineIds]
	const matchingLinks = await db
		.select({ routineId: routineOracleRoleCriticalityLinks.routineId })
		.from(routineOracleRoleCriticalityLinks)
		.where(
			and(
				inArray(routineOracleRoleCriticalityLinks.criticality, appCriticalities),
				excludeIds.length > 0
					? sql`${routineOracleRoleCriticalityLinks.routineId} NOT IN (${sql.join(
							excludeIds.map((id) => sql`${id}`),
							sql`, `,
						)})`
					: undefined,
			),
		)

	if (matchingLinks.length === 0) return []

	const routineIds = [...new Set(matchingLinks.map((l) => l.routineId))]

	const candidateRoutines = await db
		.select()
		.from(routines)
		.where(
			and(
				inArray(routines.id, routineIds),
				and(inArray(routines.status, ["active", "approved"]), isNull(routines.archivedAt)),
			),
		)

	if (candidateRoutines.length === 0) return []

	const routineIdList = candidateRoutines.map((r) => r.id)

	// Load tech elements, screening links, and persistence links in batch
	const [allElements, allScreeningLinks, allPersLinks] = await Promise.all([
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
		db.select().from(routinePersistenceLinks).where(inArray(routinePersistenceLinks.routineId, routineIdList)),
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
	const persLinksByRoutine = new Map<string, typeof allPersLinks>()
	for (const p of allPersLinks) {
		const list = persLinksByRoutine.get(p.routineId) ?? []
		list.push(p)
		persLinksByRoutine.set(p.routineId, list)
	}

	const [appRow] = await db
		.select({ name: monitoredApplications.name })
		.from(monitoredApplications)
		.where(eq(monitoredApplications.id, applicationId))
		.limit(1)
	const appName = appRow?.name ?? ""

	// Get latest completed reviews
	const latestReviews = await db
		.selectDistinctOn([routineReviews.routineId], {
			routineId: routineReviews.routineId,
			reviewedAt: routineReviews.reviewedAt,
		})
		.from(routineReviews)
		.where(
			and(
				inArray(routineReviews.routineId, routineIdList),
				eq(routineReviews.applicationId, applicationId),
				eq(routineReviews.status, "completed"),
			),
		)
		.orderBy(routineReviews.routineId, desc(routineReviews.reviewedAt))
	const reviewByRoutine = new Map(latestReviews.map((r) => [r.routineId, r.reviewedAt]))

	const results: RoutineDeadlineInfo[] = []
	for (const routine of candidateRoutines) {
		const fullRoutine = {
			...routine,
			technologyElements: elemsByRoutine.get(routine.id) ?? [],
			screeningQuestions: screenByRoutine.get(routine.id) ?? [],
			persistenceLinks: persLinksByRoutine.get(routine.id) ?? [],
			controls: [],
			groupClassifications: [],
			oracleRoleCriticalities: [],
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

	const [routineRows, allElements, allScreeningLinks, allPersLinks] = await Promise.all([
		db
			.select()
			.from(routines)
			.where(
				and(
					inArray(routines.id, uniqueIds),
					and(inArray(routines.status, ["active", "approved"]), isNull(routines.archivedAt)),
				),
			),
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
		db.select().from(routinePersistenceLinks).where(inArray(routinePersistenceLinks.routineId, uniqueIds)),
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
	const persByRoutine2 = new Map<string, typeof allPersLinks>()
	for (const p of allPersLinks) {
		const list = persByRoutine2.get(p.routineId) ?? []
		list.push(p)
		persByRoutine2.set(p.routineId, list)
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
		.where(
			and(
				inArray(routineReviews.routineId, uniqueIds),
				eq(routineReviews.applicationId, applicationId),
				eq(routineReviews.status, "completed"),
			),
		)
		.orderBy(routineReviews.routineId, desc(routineReviews.reviewedAt))
	const reviewByRoutine = new Map(latestReviews.map((r) => [r.routineId, r.reviewedAt]))

	const results: RoutineDeadlineInfo[] = []
	for (const routine of routineRows) {
		const fullRoutine = {
			...routine,
			technologyElements: elemsByRoutine.get(routine.id) ?? [],
			screeningQuestions: screenByRoutine.get(routine.id) ?? [],
			persistenceLinks: persByRoutine2.get(routine.id) ?? [],
			controls: [],
			groupClassifications: [],
			oracleRoleCriticalities: [],
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

// ─── Section-wide routines (applies to all apps in section) ──────────────

export async function getRoutineDeadlinesForAppBySection(
	applicationId: string,
	excludeRoutineIds: Set<string> = new Set(),
): Promise<RoutineDeadlineInfo[]> {
	// Find section IDs for this app via nais team environments
	const sectionRows = await db
		.selectDistinct({ sectionId: naisTeams.sectionId })
		.from(applicationEnvironments)
		.innerJoin(naisTeams, eq(applicationEnvironments.naisTeamId, naisTeams.id))
		.where(and(eq(applicationEnvironments.applicationId, applicationId), isNotNull(naisTeams.sectionId)))

	const sectionIds = sectionRows.map((r) => r.sectionId).filter((id): id is string => id !== null)
	if (sectionIds.length === 0) return []

	// Find routines that apply to all apps in these sections (active only)
	const sectionRoutines = await db
		.select()
		.from(routines)
		.where(
			and(
				inArray(routines.sectionId, sectionIds),
				eq(routines.appliesToAllInSection, 1),
				and(inArray(routines.status, ["active", "approved"]), isNull(routines.archivedAt)),
			),
		)

	const matchingRoutines = sectionRoutines.filter((r) => !excludeRoutineIds.has(r.id))
	if (matchingRoutines.length === 0) return []

	const routineIdList = matchingRoutines.map((r) => r.id)

	const [allElements, allScreeningLinks, allPersLinks] = await Promise.all([
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
		db.select().from(routinePersistenceLinks).where(inArray(routinePersistenceLinks.routineId, routineIdList)),
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
	const persByRoutine = new Map<string, typeof allPersLinks>()
	for (const p of allPersLinks) {
		const list = persByRoutine.get(p.routineId) ?? []
		list.push(p)
		persByRoutine.set(p.routineId, list)
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
		.where(
			and(
				inArray(routineReviews.routineId, routineIdList),
				eq(routineReviews.applicationId, applicationId),
				eq(routineReviews.status, "completed"),
			),
		)
		.orderBy(routineReviews.routineId, desc(routineReviews.reviewedAt))
	const reviewByRoutine = new Map(latestReviews.map((r) => [r.routineId, r.reviewedAt]))

	const results: RoutineDeadlineInfo[] = []
	for (const routine of matchingRoutines) {
		const fullRoutine = {
			...routine,
			technologyElements: elemsByRoutine.get(routine.id) ?? [],
			screeningQuestions: screenByRoutine.get(routine.id) ?? [],
			persistenceLinks: persByRoutine.get(routine.id) ?? [],
			controls: [],
			groupClassifications: [],
			oracleRoleCriticalities: [],
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

// ─── Routine matching path 5: Ruleset-linked routines ────────────────────

export async function getRoutineDeadlinesForAppByRuleset(
	applicationId: string,
	excludeRoutineIds: Set<string> = new Set(),
): Promise<RoutineDeadlineInfo[]> {
	// Find section IDs for this app
	const sectionRows = await db
		.selectDistinct({ sectionId: naisTeams.sectionId })
		.from(applicationEnvironments)
		.innerJoin(naisTeams, eq(applicationEnvironments.naisTeamId, naisTeams.id))
		.where(and(eq(applicationEnvironments.applicationId, applicationId), isNotNull(naisTeams.sectionId)))

	const sectionIds = sectionRows.map((r) => r.sectionId).filter((id): id is string => id !== null)
	if (sectionIds.length === 0) return []

	// Find rulesets in these sections
	const { rulesetRoutines } = await import("../schema/rulesets")
	const { rulesets } = await import("../schema/rulesets")
	const sectionRulesets = await db
		.select({ id: rulesets.id })
		.from(rulesets)
		.where(and(inArray(rulesets.sectionId, sectionIds), isNull(rulesets.archivedAt)))
	const rulesetIds = sectionRulesets.map((r) => r.id)
	if (rulesetIds.length === 0) return []

	// Find routines linked to these rulesets
	const rulesetRoutineRows = await db
		.select({ routineId: rulesetRoutines.routineId })
		.from(rulesetRoutines)
		.where(inArray(rulesetRoutines.rulesetId, rulesetIds))

	const routineIds = rulesetRoutineRows.map((r) => r.routineId).filter((id) => !excludeRoutineIds.has(id))
	const uniqueIds = [...new Set(routineIds)]
	if (uniqueIds.length === 0) return []

	const [routineRows, allElements, allScreeningLinks, allPersLinks] = await Promise.all([
		db
			.select()
			.from(routines)
			.where(
				and(
					inArray(routines.id, uniqueIds),
					and(inArray(routines.status, ["active", "approved"]), isNull(routines.archivedAt)),
				),
			),
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
		db.select().from(routinePersistenceLinks).where(inArray(routinePersistenceLinks.routineId, uniqueIds)),
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
	const persByRoutine = new Map<string, typeof allPersLinks>()
	for (const p of allPersLinks) {
		const list = persByRoutine.get(p.routineId) ?? []
		list.push(p)
		persByRoutine.set(p.routineId, list)
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
		.where(
			and(
				inArray(routineReviews.routineId, uniqueIds),
				eq(routineReviews.applicationId, applicationId),
				eq(routineReviews.status, "completed"),
			),
		)
		.orderBy(routineReviews.routineId, desc(routineReviews.reviewedAt))
	const reviewByRoutine = new Map(latestReviews.map((r) => [r.routineId, r.reviewedAt]))

	const results: RoutineDeadlineInfo[] = []
	for (const routine of routineRows) {
		const fullRoutine = {
			...routine,
			technologyElements: elemsByRoutine.get(routine.id) ?? [],
			screeningQuestions: screenByRoutine.get(routine.id) ?? [],
			persistenceLinks: persByRoutine.get(routine.id) ?? [],
			controls: [],
			groupClassifications: [],
			oracleRoleCriticalities: [],
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
	const sectionRoutines = await db
		.select({ id: routines.id })
		.from(routines)
		.where(and(eq(routines.sectionId, sectionId), isNull(routines.archivedAt)))

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
		.where(and(inArray(routineReviews.routineId, routineIds), sql`${routineReviews.status} != 'discarded'`))
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

// ─── Review Activities ───────────────────────────────────────────────────

export type EntraGroupSnapshot = {
	groups: Array<{
		groupId: string
		groupName: string | null
		source: "nais" | "manual" | "removed"
		criticality: string | null
	}>
}

/**
 * Bygger et øyeblikksbilde av Entra ID-grupper for en applikasjon — inkluderer
 * Nais auth-grupper, manuelt registrerte grupper og lagrede vurderinger.
 * Eksternt kall: resolver gruppenavn via Microsoft Graph.
 */
export async function buildEntraGroupSnapshot(applicationId: string): Promise<EntraGroupSnapshot> {
	const { getAppAuthIntegrations, getManualGroupsForApp, getGroupAssessmentsForApp } = await import("./nais.server")
	const { resolveGroupNames } = await import("../../lib/graph.server")

	const [authIntegrations, manualGroups, groupAssessments] = await Promise.all([
		getAppAuthIntegrations(applicationId),
		getManualGroupsForApp(applicationId),
		getGroupAssessmentsForApp(applicationId),
	])

	const naisGroupIds: string[] = []
	for (const auth of authIntegrations) {
		if (auth.groups) {
			const groups = JSON.parse(auth.groups) as string[]
			naisGroupIds.push(...groups)
		}
	}

	const naisGroupIdSet = new Set(naisGroupIds)
	const manualGroupIdSet = new Set(manualGroups.map((g) => g.groupId))
	const ghostGroupIds = groupAssessments
		.filter((a) => !naisGroupIdSet.has(a.groupId) && !manualGroupIdSet.has(a.groupId))
		.map((a) => a.groupId)

	const allGroupIds = [...new Set([...naisGroupIds, ...manualGroups.map((g) => g.groupId), ...ghostGroupIds])]
	const groupNames = await resolveGroupNames(allGroupIds)

	const assessmentsByGroupId = new Map(groupAssessments.map((a) => [a.groupId, a.criticality]))

	const groups: EntraGroupSnapshot["groups"] = [
		...naisGroupIds.map((id) => ({
			groupId: id,
			groupName: groupNames[id] ?? null,
			source: "nais" as const,
			criticality: assessmentsByGroupId.get(id) ?? null,
		})),
		...manualGroups.map((g) => ({
			groupId: g.groupId,
			groupName: groupNames[g.groupId] ?? null,
			source: "manual" as const,
			criticality: assessmentsByGroupId.get(g.groupId) ?? null,
		})),
		...ghostGroupIds.map((id) => ({
			groupId: id,
			groupName: groupNames[id] ?? null,
			source: "removed" as const,
			criticality: assessmentsByGroupId.get(id) ?? null,
		})),
	]

	return { groups }
}

export async function autoCreateActivityForReview(
	reviewId: string,
	routineId: string,
	applicationId: string | null,
	performedBy: string,
) {
	const routine = await getRoutine(routineId)
	if (!routine?.activityType) return null

	let snapshotBefore: EntraGroupSnapshot | null = null
	if (routine.activityType === "entra_id_group_maintenance" && applicationId) {
		snapshotBefore = await buildEntraGroupSnapshot(applicationId)
	}

	return createReviewActivity(reviewId, routine.activityType, snapshotBefore, performedBy)
}

export async function createReviewActivity(
	reviewId: string,
	type: RoutineActivityType,
	snapshotBefore: EntraGroupSnapshot | null,
	performedBy: string,
) {
	const [activity] = await db
		.insert(routineReviewActivities)
		.values({
			reviewId,
			type,
			snapshotBefore,
		})
		.returning()

	await writeAuditLog({
		action: "review_activity_created",
		entityType: "routine_review_activity",
		entityId: activity.id,
		newValue: type,
		metadata: { reviewId },
		performedBy,
	})

	return activity
}

export async function getReviewActivity(reviewId: string) {
	const [activity] = await db
		.select()
		.from(routineReviewActivities)
		.where(eq(routineReviewActivities.reviewId, reviewId))
		.limit(1)

	if (!activity) return null

	const changes = await db
		.select()
		.from(routineReviewActivityEntraChanges)
		.where(eq(routineReviewActivityEntraChanges.activityId, activity.id))
		.orderBy(routineReviewActivityEntraChanges.performedAt)

	return { ...activity, changes }
}

export async function recordEntraChange(params: {
	activityId: string
	changeType: EntraChangeType
	groupId: string
	groupName: string | null
	previousValue: string | null
	newValue: string | null
	performedBy: string
}) {
	const [change] = await db
		.insert(routineReviewActivityEntraChanges)
		.values({
			activityId: params.activityId,
			changeType: params.changeType,
			groupId: params.groupId,
			groupName: params.groupName,
			previousValue: params.previousValue,
			newValue: params.newValue,
			performedBy: params.performedBy,
		})
		.returning()

	await writeAuditLog({
		action: "review_activity_entra_change",
		entityType: "routine_review_activity",
		entityId: params.activityId,
		newValue: JSON.stringify({
			changeType: params.changeType,
			groupId: params.groupId,
			groupName: params.groupName,
		}),
		performedBy: params.performedBy,
	})

	return change
}

type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]

export async function completeReviewActivity(
	activityId: string,
	snapshotAfter: EntraGroupSnapshot | null,
	performedBy: string,
	tx?: DbExecutor,
) {
	const executor = tx ?? db
	const [updated] = await executor
		.update(routineReviewActivities)
		.set({
			status: "completed",
			snapshotAfter,
			completedAt: new Date(),
		})
		.where(eq(routineReviewActivities.id, activityId))
		.returning()

	await writeAuditLog(
		{
			action: "review_activity_completed",
			entityType: "routine_review_activity",
			entityId: activityId,
			performedBy,
		},
		tx,
	)

	return updated
}

export async function getActivitiesForReviews(reviewIds: string[]) {
	if (reviewIds.length === 0) return []

	const activities = await db
		.select()
		.from(routineReviewActivities)
		.where(inArray(routineReviewActivities.reviewId, reviewIds))

	if (activities.length === 0) return []

	const activityIds = activities.map((a) => a.id)
	const allChanges = await db
		.select()
		.from(routineReviewActivityEntraChanges)
		.where(inArray(routineReviewActivityEntraChanges.activityId, activityIds))
		.orderBy(routineReviewActivityEntraChanges.performedAt)

	const changesByActivityId = new Map<string, typeof allChanges>()
	for (const c of allChanges) {
		const list = changesByActivityId.get(c.activityId) ?? []
		list.push(c)
		changesByActivityId.set(c.activityId, list)
	}

	return activities.map((a) => ({
		...a,
		changes: changesByActivityId.get(a.id) ?? [],
	}))
}

// ─── Routine Approval ────────────────────────────────────────────────────

/**
 * Godkjenner en rutine (kun mulig fra status `active`). Godkjente rutiner
 * kan ikke redigeres etterpå — kun erstattes via {@link replaceRoutine}.
 */
export async function approveRoutine(routineId: string, performedBy: string) {
	const routine = await getRoutine(routineId)
	if (!routine) return null
	if (routine.status !== "active") {
		throw new Response("Kun aktive rutiner kan godkjennes", { status: 400 })
	}

	// Atomisk: archive-guard + UPDATE i tx med FOR SHARE-lås på rutinen så
	// samtidig archiveRoutine() blokkeres til vår tx er ferdig. UPDATE re-
	// validerer status='active' og archived_at IS NULL i WHERE-clauselen, så
	// status-endring mellom pre-check og UPDATE (f.eks. samtidig replaceRoutine
	// eller manuell statusendring) gir 0 oppdaterte rader → 409 Conflict.
	return db.transaction(async (tx) => {
		const [locked] = await tx
			.select({ archivedAt: routines.archivedAt })
			.from(routines)
			.where(eq(routines.id, routineId))
			.for("share")
			.limit(1)
		if (!locked) return null
		if (locked.archivedAt) {
			throw new Response("Arkiverte rutiner kan ikke godkjennes. Reaktiver rutinen først.", { status: 403 })
		}

		const now = new Date()
		const [updated] = await tx
			.update(routines)
			.set({ status: "approved", approvedBy: performedBy, approvedAt: now, updatedBy: performedBy, updatedAt: now })
			.where(and(eq(routines.id, routineId), eq(routines.status, "active"), isNull(routines.archivedAt)))
			.returning()
		if (!updated) {
			throw new Response("Rutinen kan ikke godkjennes lenger (status eller archived_at endret seg).", {
				status: 409,
			})
		}

		await writeAuditLog(
			{
				action: "routine_approved",
				entityType: "routine",
				entityId: routineId,
				newValue: "approved",
				metadata: { routineName: routine.name, approvedBy: performedBy },
				performedBy,
			},
			tx,
		)

		return updated
	})
}

/**
 * Lager en draft-kopi av en eksisterende rutine med alle koblinger.
 * Brukes som utgangspunkt for å erstatte en godkjent rutine.
 */
export async function copyRoutine(routineId: string, performedBy: string) {
	const source = await getRoutine(routineId)
	if (!source) return null

	// Atomisk: archive-guard + INSERTs i tx med FOR SHARE-lås på kilde-rutinen
	// så samtidig archiveRoutine() blokkeres til vi har kopiert ferdig.
	return db.transaction(async (tx) => {
		const [locked] = await tx
			.select({ archivedAt: routines.archivedAt })
			.from(routines)
			.where(eq(routines.id, routineId))
			.for("share")
			.limit(1)
		if (!locked) return null
		if (locked.archivedAt) {
			throw new Response("Arkiverte rutiner kan ikke kopieres. Reaktiver rutinen først.", { status: 403 })
		}

		const [copy] = await tx
			.insert(routines)
			.values({
				sectionId: source.sectionId,
				name: `${source.name} (kopi)`,
				description: source.description,
				frequency: source.frequency,
				responsibleRole: source.responsibleRole,
				appliesToAllInSection: source.appliesToAllInSection,
				activityType: source.activityType,
				screeningQuestionId: source.screeningQuestionId,
				screeningChoiceValue: source.screeningChoiceValue,
				status: "draft",
				sourceRoutineId: routineId,
				createdBy: performedBy,
				updatedBy: performedBy,
			})
			.returning()

		if (source.technologyElements.length > 0) {
			await tx
				.insert(routineTechnologyElements)
				.values(source.technologyElements.map((el) => ({ routineId: copy.id, elementId: el.id })))
		}

		if (source.controls.length > 0) {
			await tx.insert(routineControls).values(source.controls.map((c) => ({ routineId: copy.id, controlId: c.id })))
		}

		if (source.persistenceLinks.length > 0) {
			await tx.insert(routinePersistenceLinks).values(
				source.persistenceLinks.map((pl) => ({
					routineId: copy.id,
					persistenceType: pl.persistenceType,
					dataClassification: pl.dataClassification,
				})),
			)
		}

		if (source.groupClassifications.length > 0) {
			await tx.insert(routineGroupClassificationLinks).values(
				source.groupClassifications.map((gc) => ({
					routineId: copy.id,
					classification: gc.classification as GroupAccessClassification,
				})),
			)
		}

		if (source.screeningQuestions.length > 0) {
			await tx.insert(routineScreeningQuestions).values(
				source.screeningQuestions.map((sq) => ({
					routineId: copy.id,
					questionId: sq.questionId,
					choiceValue: sq.choiceValue,
				})),
			)
		}

		await writeAuditLog(
			{
				action: "routine_copied",
				entityType: "routine",
				entityId: copy.id,
				metadata: { sourceRoutineId: routineId, sourceName: source.name },
				performedBy,
			},
			tx,
		)

		return copy
	})
}

/**
 * Erstatter en godkjent rutine med en ny. `deadlinePolicy` (`"reset"` eller
 * `"continue"`) blir lagret i audit-metadata for sporing — selve fristlogikken
 * er ikke implementert ennå, og verdien påvirker per i dag ikke hvordan
 * eksisterende frister behandles.
 */
export async function replaceRoutine(
	newRoutineId: string,
	oldRoutineId: string,
	deadlinePolicy: "reset" | "continue",
	performedBy: string,
) {
	const newRoutine = await getRoutine(newRoutineId)
	const oldRoutine = await getRoutine(oldRoutineId)
	if (!newRoutine || !oldRoutine) return null

	const now = new Date()

	// Approve the new routine
	await db
		.update(routines)
		.set({ status: "approved", approvedBy: performedBy, approvedAt: now, updatedBy: performedBy, updatedAt: now })
		.where(eq(routines.id, newRoutineId))

	// Archive the old routine and mark replacement
	await db
		.update(routines)
		.set({
			status: "archived",
			replacedByRoutineId: newRoutineId,
			replacedAt: now,
			updatedBy: performedBy,
			updatedAt: now,
		})
		.where(eq(routines.id, oldRoutineId))

	// If deadlinePolicy is "continue", copy the last review date reference
	// by storing replacement metadata. The deadline calculation will check
	// the old routine's last review when no reviews exist on the new one.
	await writeAuditLog({
		action: "routine_replaced",
		entityType: "routine",
		entityId: newRoutineId,
		metadata: {
			replacedRoutineId: oldRoutineId,
			replacedRoutineName: oldRoutine.name,
			newRoutineName: newRoutine.name,
			deadlinePolicy,
		},
		performedBy,
	})

	return { newRoutine: newRoutineId, oldRoutine: oldRoutineId, deadlinePolicy }
}
