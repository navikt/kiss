import { and, desc, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm"
import { frequencyDays, type RoutineFrequency } from "../../lib/routine-frequencies"
import { db } from "../connection.server"
import {
	applicationAuthIntegrations,
	applicationManualGroups,
	applicationPersistence,
	type DataClassification,
	entraGroupClassifications,
	type GroupAccessClassification,
	type GroupCriticality,
	monitoredApplications,
	type PersistenceType,
} from "../schema/applications"
import type { AuditLogAction } from "../schema/audit"
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
import { screeningAnswers, screeningQuestions, screeningRoutineSelections } from "../schema/screening"
import { writeAuditLog } from "./audit.server"
import { getEffectiveAppIdsInSection } from "./sections.server"

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
			.where(
				and(inArray(routineTechnologyElements.routineId, routineIds), isNull(routineTechnologyElements.archivedAt)),
			),
		db
			.select()
			.from(routinePersistenceLinks)
			.where(and(inArray(routinePersistenceLinks.routineId, routineIds), isNull(routinePersistenceLinks.archivedAt))),
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
			.where(and(inArray(routineControls.routineId, routineIds), isNull(routineControls.archivedAt))),
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
			.where(and(eq(routineTechnologyElements.routineId, id), isNull(routineTechnologyElements.archivedAt))),
		db
			.select()
			.from(routineScreeningQuestions)
			.where(and(eq(routineScreeningQuestions.routineId, id), isNull(routineScreeningQuestions.archivedAt))),
		db
			.select()
			.from(routinePersistenceLinks)
			.where(and(eq(routinePersistenceLinks.routineId, id), isNull(routinePersistenceLinks.archivedAt))),
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
			.innerJoin(
				frameworkRiskControlMappings,
				and(
					eq(frameworkControls.id, frameworkRiskControlMappings.controlId),
					isNull(frameworkRiskControlMappings.archivedAt),
				),
			)
			.innerJoin(frameworkRisks, eq(frameworkRiskControlMappings.riskId, frameworkRisks.id))
			.innerJoin(frameworkDomains, eq(frameworkRisks.domainId, frameworkDomains.id))
			.where(and(eq(routineControls.routineId, id), isNull(routineControls.archivedAt))),
		db
			.select()
			.from(routineGroupClassificationLinks)
			.where(
				and(eq(routineGroupClassificationLinks.routineId, id), isNull(routineGroupClassificationLinks.archivedAt)),
			),
		db
			.select()
			.from(routineOracleRoleCriticalityLinks)
			.where(
				and(eq(routineOracleRoleCriticalityLinks.routineId, id), isNull(routineOracleRoleCriticalityLinks.archivedAt)),
			),
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
	frequency: RoutineFrequency | null
	eventFrequency?: string | null
	responsibleRole: string | null
	appliesToAllInSection: boolean
	isSectionRoutine?: boolean
	sectionRoutineOwnerRole?: string | null
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
	// Enforce section routine invariants at query level
	if (params.isSectionRoutine && !params.sectionRoutineOwnerRole) {
		throw new Response("Seksjonsrutiner krever en eierrolle (sectionRoutineOwnerRole)", { status: 400 })
	}

	const [routine] = await db
		.insert(routines)
		.values({
			sectionId: params.sectionId,
			name: params.name,
			description: params.description,
			frequency: params.frequency,
			eventFrequency: params.eventFrequency ?? null,
			responsibleRole: params.responsibleRole,
			appliesToAllInSection: params.isSectionRoutine ? 1 : params.appliesToAllInSection ? 1 : 0,
			isSectionRoutine: params.isSectionRoutine ? 1 : 0,
			sectionRoutineOwnerRole: params.isSectionRoutine ? (params.sectionRoutineOwnerRole ?? null) : null,
			activityType: params.isSectionRoutine ? null : (params.activityType ?? null),
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
			eventFrequency: params.eventFrequency,
			responsibleRole: params.responsibleRole,
			isSectionRoutine: params.isSectionRoutine,
			sectionRoutineOwnerRole: params.sectionRoutineOwnerRole,
			persistenceLinks: params.persistenceLinks,
			screeningQuestionId: params.screeningQuestionId,
			screeningQuestionLinks: links,
			technologyElementIds: params.technologyElementIds,
			controlIds: params.controlIds,
		},
		performedBy: params.createdBy,
	})

	// Routine changes affect compliance — sync apps in this section (fire-and-forget)
	import("./application-controls.server").then(({ triggerSyncForSection }) =>
		triggerSyncForSection(params.sectionId, params.createdBy),
	)

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
	frequency: RoutineFrequency | null
	eventFrequency?: string | null
	responsibleRole: string | null
	appliesToAllInSection: boolean
	isSectionRoutine?: boolean
	sectionRoutineOwnerRole?: string | null
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
	const routine = await db.transaction(async (tx) => {
		// Atomisk pre-check: lås rutineraden inne i transaksjonen og les både
		// status og navn for audit. Hindrer TOCTOU mellom pre-sjekk og UPDATE
		// (en samtidig approve kunne ellers slippe gjennom redigering, og
		// `previousValue` i auditen kunne bli stale).
		const [locked] = await tx
			.select({ name: routines.name, status: routines.status, isSectionRoutine: routines.isSectionRoutine })
			.from(routines)
			.where(eq(routines.id, params.id))
			.for("update")
			.limit(1)
		if (!locked) {
			throw new Response("Rutine ikke funnet", { status: 404 })
		}
		if (locked.status === "approved") {
			throw new Response("Kan ikke redigere en godkjent rutine", { status: 403 })
		}

		// Use explicit param if provided, otherwise fall back to current DB value
		const effectiveIsSectionRoutine = params.isSectionRoutine ?? locked.isSectionRoutine === 1

		// Validate owner role for section routines
		if (effectiveIsSectionRoutine && params.isSectionRoutine !== undefined && !params.sectionRoutineOwnerRole) {
			throw new Response("Seksjonsrutiner krever en eierrolle (sectionRoutineOwnerRole)", { status: 400 })
		}

		const [routine] = await tx
			.update(routines)
			.set({
				name: params.name,
				description: params.description,
				frequency: params.frequency,
				...(params.eventFrequency !== undefined && { eventFrequency: params.eventFrequency }),
				responsibleRole: params.responsibleRole,
				appliesToAllInSection: effectiveIsSectionRoutine ? 1 : params.appliesToAllInSection ? 1 : 0,
				...(params.isSectionRoutine !== undefined && {
					isSectionRoutine: params.isSectionRoutine ? 1 : 0,
				}),
				...(params.isSectionRoutine !== undefined && {
					sectionRoutineOwnerRole: effectiveIsSectionRoutine ? (params.sectionRoutineOwnerRole ?? null) : null,
				}),
				activityType: effectiveIsSectionRoutine ? null : (params.activityType ?? null),
				screeningQuestionId: params.screeningQuestionId,
				screeningChoiceValue: params.screeningChoiceValue,
				...(params.status && { status: params.status }),
				updatedBy: params.updatedBy,
				updatedAt: new Date(),
			})
			.where(eq(routines.id, params.id))
			.returning()

		if (!routine) {
			throw new Response("Rutine ikke funnet", { status: 404 })
		}

		// ── Technology element links — bevar koblinger til arkiverte elementer
		// (edit-skjemaet viser bare aktive elementer). Diff beregnes mot endelig
		// sett etter preserve-logikken for å unngå falske added/removed-audit.
		const existingTechLinks = await tx
			.select({
				elementId: routineTechnologyElements.elementId,
				archivedAt: technologyElements.archivedAt,
			})
			.from(routineTechnologyElements)
			.innerJoin(technologyElements, eq(technologyElements.id, routineTechnologyElements.elementId))
			.where(and(eq(routineTechnologyElements.routineId, params.id), isNull(routineTechnologyElements.archivedAt)))
			.for("share", { of: technologyElements })
		const archivedTechToPreserve = existingTechLinks.filter((e) => e.archivedAt).map((e) => e.elementId)
		const finalTechIds = Array.from(new Set([...params.technologyElementIds, ...archivedTechToPreserve]))
		const prevTechIds = new Set(existingTechLinks.map((e) => e.elementId))
		const finalTechSet = new Set(finalTechIds)
		const techAdded = finalTechIds.filter((id) => !prevTechIds.has(id))
		const techRemoved = [...prevTechIds].filter((id) => !finalTechSet.has(id))
		// Triggrer replacement også når eksisterende rader inneholder duplikater,
		// så re-save normaliserer bort historiske duplikater (tabellen mangler unique-constraint).
		const techExistingHasDuplicates = existingTechLinks.length !== prevTechIds.size

		// No-op short-circuit: hopper over UPDATE(archive)+INSERT når settet er
		// uendret, både for å spare write-load og for å bevare link-radenes `id`.
		if (techExistingHasDuplicates || techAdded.length > 0 || techRemoved.length > 0) {
			await tx
				.update(routineTechnologyElements)
				.set({ archivedAt: new Date(), archivedBy: params.updatedBy })
				.where(and(eq(routineTechnologyElements.routineId, params.id), isNull(routineTechnologyElements.archivedAt)))
			if (finalTechIds.length > 0) {
				await tx.insert(routineTechnologyElements).values(
					finalTechIds.map((elementId) => ({
						routineId: params.id,
						elementId,
					})),
				)
			}
		}

		// ── Control links
		const existingControls = await tx
			.select({ controlId: routineControls.controlId })
			.from(routineControls)
			.where(and(eq(routineControls.routineId, params.id), isNull(routineControls.archivedAt)))
		const prevControlIds = new Set(existingControls.map((c) => c.controlId))
		const nextControlIds = [...new Set(params.controlIds)]
		const nextControlSet = new Set(nextControlIds)
		const controlAdded = nextControlIds.filter((id) => !prevControlIds.has(id))
		const controlRemoved = [...prevControlIds].filter((id) => !nextControlSet.has(id))
		const controlExistingHasDuplicates = existingControls.length !== prevControlIds.size

		if (controlExistingHasDuplicates || controlAdded.length > 0 || controlRemoved.length > 0) {
			await tx
				.update(routineControls)
				.set({ archivedAt: new Date(), archivedBy: params.updatedBy })
				.where(and(eq(routineControls.routineId, params.id), isNull(routineControls.archivedAt)))
			if (nextControlIds.length > 0) {
				await tx.insert(routineControls).values(
					nextControlIds.map((controlId) => ({
						routineId: params.id,
						controlId,
					})),
				)
			}
		}

		// ── Persistence links (composite key: persistenceType + dataClassification)
		const existingPersistence = await tx
			.select({
				persistenceType: routinePersistenceLinks.persistenceType,
				dataClassification: routinePersistenceLinks.dataClassification,
			})
			.from(routinePersistenceLinks)
			.where(and(eq(routinePersistenceLinks.routineId, params.id), isNull(routinePersistenceLinks.archivedAt)))
		const persistenceKey = (l: { persistenceType: string | null; dataClassification: string | null }) =>
			JSON.stringify([l.persistenceType, l.dataClassification])
		const prevPersistenceKeys = new Set(existingPersistence.map(persistenceKey))
		const persistenceSeen = new Set<string>()
		const nextPersistence = params.persistenceLinks.filter((l) => {
			const k = persistenceKey(l)
			if (persistenceSeen.has(k)) return false
			persistenceSeen.add(k)
			return true
		})
		const nextPersistenceKeys = new Set(nextPersistence.map(persistenceKey))
		const parsePersistenceKey = (
			key: string,
		): { persistenceType: string | null; dataClassification: string | null } => {
			const [persistenceType, dataClassification] = JSON.parse(key) as [string | null, string | null]
			return { persistenceType, dataClassification }
		}
		const persistenceAdded = [...nextPersistenceKeys]
			.filter((k) => !prevPersistenceKeys.has(k))
			.map(parsePersistenceKey)
		// Set-differanse: én audit per unik composite-key, selv om historiske
		// duplikater finnes (tabellen mangler unique-constraint).
		const persistenceRemoved = [...prevPersistenceKeys]
			.filter((k) => !nextPersistenceKeys.has(k))
			.map(parsePersistenceKey)
		const persistenceExistingHasDuplicates = existingPersistence.length !== prevPersistenceKeys.size

		if (persistenceExistingHasDuplicates || persistenceAdded.length > 0 || persistenceRemoved.length > 0) {
			await tx
				.update(routinePersistenceLinks)
				.set({ archivedAt: new Date(), archivedBy: params.updatedBy })
				.where(and(eq(routinePersistenceLinks.routineId, params.id), isNull(routinePersistenceLinks.archivedAt)))
			if (nextPersistence.length > 0) {
				await tx.insert(routinePersistenceLinks).values(
					nextPersistence.map((link) => ({
						routineId: params.id,
						persistenceType: link.persistenceType,
						dataClassification: link.dataClassification,
					})),
				)
			}
		}

		// ── Group classification links
		const existingGc = await tx
			.select({ classification: routineGroupClassificationLinks.classification })
			.from(routineGroupClassificationLinks)
			.where(
				and(
					eq(routineGroupClassificationLinks.routineId, params.id),
					isNull(routineGroupClassificationLinks.archivedAt),
				),
			)
		const prevGcSet = new Set(existingGc.map((g) => g.classification))
		const gcLinks = [...new Set(params.groupClassifications ?? [])]
		const nextGcSet = new Set(gcLinks)
		const gcAdded = gcLinks.filter((c) => !prevGcSet.has(c))
		const gcRemoved = [...prevGcSet].filter((c) => !nextGcSet.has(c))
		const gcExistingHasDuplicates = existingGc.length !== prevGcSet.size

		if (gcExistingHasDuplicates || gcAdded.length > 0 || gcRemoved.length > 0) {
			await tx
				.update(routineGroupClassificationLinks)
				.set({ archivedAt: new Date(), archivedBy: params.updatedBy })
				.where(
					and(
						eq(routineGroupClassificationLinks.routineId, params.id),
						isNull(routineGroupClassificationLinks.archivedAt),
					),
				)
			if (gcLinks.length > 0) {
				await tx.insert(routineGroupClassificationLinks).values(
					gcLinks.map((classification) => ({
						routineId: params.id,
						classification,
					})),
				)
			}
		}

		// ── Oracle role criticality links
		const existingOrc = await tx
			.select({ criticality: routineOracleRoleCriticalityLinks.criticality })
			.from(routineOracleRoleCriticalityLinks)
			.where(
				and(
					eq(routineOracleRoleCriticalityLinks.routineId, params.id),
					isNull(routineOracleRoleCriticalityLinks.archivedAt),
				),
			)
		const prevOrcSet = new Set(existingOrc.map((o) => o.criticality))
		const orcLinks = [...new Set(params.oracleRoleCriticalities ?? [])]
		const nextOrcSet = new Set(orcLinks)
		const orcAdded = orcLinks.filter((c) => !prevOrcSet.has(c))
		const orcRemoved = [...prevOrcSet].filter((c) => !nextOrcSet.has(c))
		const orcExistingHasDuplicates = existingOrc.length !== prevOrcSet.size

		if (orcExistingHasDuplicates || orcAdded.length > 0 || orcRemoved.length > 0) {
			await tx
				.update(routineOracleRoleCriticalityLinks)
				.set({ archivedAt: new Date(), archivedBy: params.updatedBy })
				.where(
					and(
						eq(routineOracleRoleCriticalityLinks.routineId, params.id),
						isNull(routineOracleRoleCriticalityLinks.archivedAt),
					),
				)
			if (orcLinks.length > 0) {
				await tx.insert(routineOracleRoleCriticalityLinks).values(
					orcLinks.map((criticality) => ({
						routineId: params.id,
						criticality,
					})),
				)
			}
		}

		// ── Screening question links (composite: questionId + choiceValue)
		const existingSq = await tx
			.select({
				questionId: routineScreeningQuestions.questionId,
				choiceValue: routineScreeningQuestions.choiceValue,
			})
			.from(routineScreeningQuestions)
			.where(and(eq(routineScreeningQuestions.routineId, params.id), isNull(routineScreeningQuestions.archivedAt)))
		// Bruker JSON-stringify av tuple for å unngå nøkkelkollisjoner: `choiceValue`
		// er fritekst som kan inneholde "|" og kan være både null og "". En naiv
		// "${q}|${v ?? ""}"-nøkkel ville f.eks. mappet (q1, null) og (q1, "") til
		// samme streng, og diff-en ville da bommet på add/remove-rader.
		const sqKey = (l: { questionId: string; choiceValue: string | null }) =>
			JSON.stringify([l.questionId, l.choiceValue])
		const rawLinks = [...(params.screeningQuestionLinks ?? [])]
		if (params.screeningQuestionId && !rawLinks.some((l) => l.questionId === params.screeningQuestionId)) {
			rawLinks.push({ questionId: params.screeningQuestionId, choiceValue: params.screeningChoiceValue })
		}
		// Dedupliser inn-input på (questionId, choiceValue) før diff og INSERT.
		// Tabellen mangler unique-constraint, så uten dedup ville duplikater i input
		// gi duplikate rader og duplikate audit-entries.
		const sqSeen = new Set<string>()
		const links = rawLinks.filter((l) => {
			const k = sqKey(l)
			if (sqSeen.has(k)) return false
			sqSeen.add(k)
			return true
		})
		const prevSqKeys = new Set(existingSq.map(sqKey))
		const nextSqKeys = new Set(links.map(sqKey))
		const parseSqKey = (key: string): { questionId: string; choiceValue: string | null } => {
			const [questionId, choiceValue] = JSON.parse(key) as [string, string | null]
			return { questionId, choiceValue }
		}
		const sqAdded = [...nextSqKeys].filter((k) => !prevSqKeys.has(k)).map(parseSqKey)
		// Set-differanse: én audit per unik (questionId, choiceValue), selv om
		// historiske duplikater finnes (tabellen mangler unique-constraint).
		const sqRemoved = [...prevSqKeys].filter((k) => !nextSqKeys.has(k)).map(parseSqKey)
		const sqExistingHasDuplicates = existingSq.length !== prevSqKeys.size

		if (sqExistingHasDuplicates || sqAdded.length > 0 || sqRemoved.length > 0) {
			await tx
				.update(routineScreeningQuestions)
				.set({ archivedAt: new Date(), archivedBy: params.updatedBy })
				.where(and(eq(routineScreeningQuestions.routineId, params.id), isNull(routineScreeningQuestions.archivedAt)))
			if (links.length > 0) {
				await tx.insert(routineScreeningQuestions).values(
					links.map((link) => ({
						routineId: params.id,
						questionId: link.questionId,
						choiceValue: link.choiceValue,
					})),
				)
			}
		}

		// ── Audit: hovedoppdatering + én rad per added/removed-link
		await writeAuditLog(
			{
				action: "routine_updated",
				entityType: "routine",
				entityId: params.id,
				previousValue: locked.name ?? null,
				newValue: params.name,
				metadata: {
					frequency: params.frequency,
					responsibleRole: params.responsibleRole,
					persistenceLinks: nextPersistence,
					screeningQuestionId: params.screeningQuestionId,
					screeningQuestionLinks: links,
					technologyElementIds: finalTechIds,
					controlIds: nextControlIds,
				},
				performedBy: params.updatedBy,
			},
			tx,
		)

		const writeLinkAudit = async (
			action: AuditLogAction,
			entityType: string,
			metadata: Record<string, unknown>,
			isAdd: boolean,
		) => {
			await writeAuditLog(
				{
					action,
					entityType,
					entityId: params.id,
					...(isAdd
						? { newValue: JSON.stringify({ routineId: params.id, ...metadata }) }
						: { previousValue: JSON.stringify({ routineId: params.id, ...metadata }) }),
					metadata,
					performedBy: params.updatedBy,
				},
				tx,
			)
		}

		for (const elementId of techAdded) {
			await writeLinkAudit("routine_technology_element_added", "routine_technology_element", { elementId }, true)
		}
		for (const elementId of techRemoved) {
			await writeLinkAudit("routine_technology_element_removed", "routine_technology_element", { elementId }, false)
		}
		for (const controlId of controlAdded) {
			await writeLinkAudit("routine_control_added", "routine_control", { controlId }, true)
		}
		for (const controlId of controlRemoved) {
			await writeLinkAudit("routine_control_removed", "routine_control", { controlId }, false)
		}
		for (const link of persistenceAdded) {
			await writeLinkAudit(
				"routine_persistence_link_added",
				"routine_persistence_link",
				{ persistenceType: link.persistenceType, dataClassification: link.dataClassification },
				true,
			)
		}
		for (const link of persistenceRemoved) {
			await writeLinkAudit(
				"routine_persistence_link_removed",
				"routine_persistence_link",
				{ persistenceType: link.persistenceType, dataClassification: link.dataClassification },
				false,
			)
		}
		for (const classification of gcAdded) {
			await writeLinkAudit(
				"routine_group_classification_link_added",
				"routine_group_classification_link",
				{ classification },
				true,
			)
		}
		for (const classification of gcRemoved) {
			await writeLinkAudit(
				"routine_group_classification_link_removed",
				"routine_group_classification_link",
				{ classification },
				false,
			)
		}
		for (const criticality of orcAdded) {
			await writeLinkAudit(
				"routine_oracle_role_criticality_link_added",
				"routine_oracle_role_criticality_link",
				{ criticality },
				true,
			)
		}
		for (const criticality of orcRemoved) {
			await writeLinkAudit(
				"routine_oracle_role_criticality_link_removed",
				"routine_oracle_role_criticality_link",
				{ criticality },
				false,
			)
		}
		for (const link of sqAdded) {
			await writeLinkAudit(
				"routine_screening_question_added",
				"routine_screening_question",
				{ questionId: link.questionId, choiceValue: link.choiceValue },
				true,
			)
		}
		for (const link of sqRemoved) {
			await writeLinkAudit(
				"routine_screening_question_removed",
				"routine_screening_question",
				{ questionId: link.questionId, choiceValue: link.choiceValue },
				false,
			)
		}

		return routine
	})

	// Routine changes affect compliance — sync apps in this section (fire-and-forget)
	if (routine) {
		import("./application-controls.server").then(({ triggerSyncForSection }) =>
			triggerSyncForSection(routine.sectionId, params.updatedBy),
		)
	}

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
	const routine = await db.transaction(async (tx) => {
		const [archived] = await tx
			.update(routines)
			.set({
				archivedAt: new Date(),
				archivedBy: performedBy,
				updatedAt: new Date(),
				updatedBy: performedBy,
			})
			.where(and(eq(routines.id, id), isNull(routines.archivedAt), eq(routines.status, "approved")))
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

	// Archiving a routine affects compliance — sync apps in this section (fire-and-forget)
	if (routine?.sectionId) {
		import("./application-controls.server").then(({ triggerSyncForSection }) =>
			triggerSyncForSection(routine.sectionId, performedBy),
		)
	}

	return routine
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

	const enrichedReviews = await enrichReviewsBatch(reviews.map((r) => r.review))
	return enrichedReviews.map((enriched, i) => ({
		...enriched,
		applicationName: reviews[i].applicationName,
	}))
}

/**
 * Resolves all section IDs an application effectively belongs to.
 * Uses one SQL query to union the three membership paths and apply the
 * same archived, child-app, ignored-app, and excluded-environment filters.
 */
export async function getSectionIdsForApp(applicationId: string): Promise<string[]> {
	const result = await db.execute(sql`
		WITH valid_app AS (
			SELECT id
			FROM monitored_applications
			WHERE id = ${applicationId}
				AND archived_at IS NULL
				AND primary_application_id IS NULL
		),
		candidate_sections AS (
			SELECT nt.section_id AS section_id
			FROM valid_app app
			INNER JOIN application_environments ae ON ae.application_id = app.id
			INNER JOIN nais_teams nt ON nt.id = ae.nais_team_id
			WHERE nt.section_id IS NOT NULL

			UNION ALL

			SELECT dt.section_id AS section_id
			FROM valid_app app
			INNER JOIN application_team_mappings atm ON atm.application_id = app.id
			INNER JOIN dev_teams dt ON dt.id = atm.dev_team_id
			WHERE atm.archived_at IS NULL
				AND dt.archived_at IS NULL
				AND dt.section_id IS NOT NULL

			UNION ALL

			SELECT dt.section_id AS section_id
			FROM valid_app app
			INNER JOIN application_environments ae ON ae.application_id = app.id
			INNER JOIN dev_team_nais_team_mappings dtnm ON dtnm.nais_team_id = ae.nais_team_id
			INNER JOIN dev_teams dt ON dt.id = dtnm.dev_team_id
			WHERE dtnm.archived_at IS NULL
				AND dt.archived_at IS NULL
				AND dt.section_id IS NOT NULL
		)
		SELECT DISTINCT cs.section_id AS "sectionId"
		FROM candidate_sections cs
		INNER JOIN valid_app app ON TRUE
		WHERE NOT EXISTS (
			SELECT 1
			FROM section_ignored_applications sia
			WHERE sia.section_id = cs.section_id
				AND sia.application_id = app.id
				AND sia.archived_at IS NULL
		)
		AND (
			EXISTS (
				SELECT 1
				FROM application_environments ae
				INNER JOIN nais_teams nt ON nt.id = ae.nais_team_id
				WHERE ae.application_id = app.id
					AND nt.section_id = cs.section_id
					AND NOT EXISTS (
						SELECT 1
						FROM section_environments se
						WHERE se.section_id = cs.section_id
							AND se.included = false
							AND se.cluster = ae.cluster
					)
			)
			OR EXISTS (
				SELECT 1
				FROM application_team_mappings atm
				INNER JOIN dev_teams dt ON dt.id = atm.dev_team_id
				WHERE atm.application_id = app.id
					AND atm.archived_at IS NULL
					AND dt.archived_at IS NULL
					AND dt.section_id = cs.section_id
					AND (
						NOT EXISTS (
							SELECT 1
							FROM application_environments ae_any
							WHERE ae_any.application_id = app.id
						)
						OR EXISTS (
							SELECT 1
							FROM application_environments ae_any
							WHERE ae_any.application_id = app.id
								AND NOT EXISTS (
									SELECT 1
									FROM section_environments se
									WHERE se.section_id = cs.section_id
										AND se.included = false
										AND se.cluster = ae_any.cluster
								)
						)
					)
			)
			OR EXISTS (
				SELECT 1
				FROM application_environments ae
				INNER JOIN dev_team_nais_team_mappings dtnm ON dtnm.nais_team_id = ae.nais_team_id
				INNER JOIN dev_teams dt ON dt.id = dtnm.dev_team_id
				WHERE ae.application_id = app.id
					AND dtnm.archived_at IS NULL
					AND dt.archived_at IS NULL
					AND dt.section_id = cs.section_id
					AND NOT EXISTS (
						SELECT 1
						FROM section_environments se
						WHERE se.section_id = cs.section_id
							AND se.included = false
							AND se.cluster = ae.cluster
					)
			)
		)
		ORDER BY "sectionId"
	`)

	return (result.rows as Array<{ sectionId: string }>).map((row) => row.sectionId)
}

/**
 * Resolves all effective application IDs in a section, with proper filtering
 * (excludes child apps, ignored apps, excluded environments).
 * Delegates to the canonical implementation in sections.server.ts.
 */
async function getAppIdsInSection(sectionId: string): Promise<string[]> {
	return getEffectiveAppIdsInSection(sectionId)
}

export async function getReviewsForApp(applicationId: string) {
	// Find section IDs for this app to scope section-level reviews
	const appSectionIds = await getSectionIdsForApp(applicationId)

	const reviews = await db
		.select({
			review: routineReviews,
			routineName: routines.name,
			routineDescription: routines.description,
			routineFrequency: routines.frequency,
			routineEventFrequency: routines.eventFrequency,
			sectionId: routines.sectionId,
		})
		.from(routineReviews)
		.innerJoin(routines, eq(routineReviews.routineId, routines.id))
		.where(
			and(
				or(
					eq(routineReviews.applicationId, applicationId),
					// Include section-level reviews only for section routines in the app's sections
					...(appSectionIds.length > 0
						? [
								and(
									eq(routines.isSectionRoutine, 1),
									isNull(routineReviews.applicationId),
									inArray(routines.sectionId, appSectionIds),
								),
							]
						: []),
				),
				sql`${routineReviews.status} != 'discarded'`,
			),
		)
		.orderBy(desc(routineReviews.reviewedAt))

	const enrichedReviews = await enrichReviewsBatch(reviews.map((r) => r.review))
	return enrichedReviews.map((enriched, i) => ({
		...enriched,
		routineName: reviews[i].routineName,
		routineDescription: reviews[i].routineDescription,
		routineFrequency: reviews[i].routineFrequency,
		routineEventFrequency: reviews[i].routineEventFrequency,
		sectionId: reviews[i].sectionId,
	}))
}

export async function getReview(id: string) {
	const [review] = await db.select().from(routineReviews).where(eq(routineReviews.id, id)).limit(1)
	if (!review) return null
	return enrichReview(review)
}

async function enrichReview(review: typeof routineReviews.$inferSelect) {
	const enriched = await enrichReviewsBatch([review])
	return enriched[0]
}

/**
 * Batch-enrich multiple reviews with participants, attachments, and links.
 * Uses 3 batch queries instead of N×3 individual queries to avoid pool exhaustion.
 */
async function enrichReviewsBatch(reviews: (typeof routineReviews.$inferSelect)[]) {
	if (reviews.length === 0) return []

	const reviewIds = reviews.map((r) => r.id)

	const [allParticipants, allAttachments, allLinks] = await Promise.all([
		db
			.select()
			.from(routineReviewParticipants)
			.where(and(inArray(routineReviewParticipants.reviewId, reviewIds), isNull(routineReviewParticipants.archivedAt))),
		db
			.select()
			.from(routineReviewAttachments)
			.where(inArray(routineReviewAttachments.reviewId, reviewIds))
			.orderBy(routineReviewAttachments.uploadedAt),
		db
			.select()
			.from(routineReviewLinks)
			.where(and(inArray(routineReviewLinks.reviewId, reviewIds), isNull(routineReviewLinks.archivedAt)))
			.orderBy(routineReviewLinks.addedAt),
	])

	const participantsByReview = new Map<string, (typeof allParticipants)[number][]>()
	for (const p of allParticipants) {
		const arr = participantsByReview.get(p.reviewId) ?? []
		arr.push(p)
		participantsByReview.set(p.reviewId, arr)
	}

	const attachmentsByReview = new Map<string, (typeof allAttachments)[number][]>()
	for (const a of allAttachments) {
		const arr = attachmentsByReview.get(a.reviewId) ?? []
		arr.push(a)
		attachmentsByReview.set(a.reviewId, arr)
	}

	const linksByReview = new Map<string, (typeof allLinks)[number][]>()
	for (const l of allLinks) {
		const arr = linksByReview.get(l.reviewId) ?? []
		arr.push(l)
		linksByReview.set(l.reviewId, arr)
	}

	return reviews.map((review) => ({
		...review,
		participants: participantsByReview.get(review.id) ?? [],
		attachments: attachmentsByReview.get(review.id) ?? [],
		links: linksByReview.get(review.id) ?? [],
	}))
}

/**
 * Oppretter en gjennomgang (review) av en rutine for en gitt applikasjon.
 * Kaster feil hvis rutinen ikke er godkjent, eller hvis den er
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
		if (routine.status !== "approved")
			throw new Response("Kan ikke opprette gjennomgang for en rutine som ikke er godkjent", {
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

		let insertedCount = 0
		if (params.participants.length > 0) {
			const insertedParticipants = await tx
				.insert(routineReviewParticipants)
				.values(
					params.participants.map((p) => ({
						reviewId: review.id,
						userIdent: p.userIdent,
						userName: p.userName,
					})),
				)
				.onConflictDoNothing({
					target: [routineReviewParticipants.reviewId, routineReviewParticipants.userIdent],
					where: isNull(routineReviewParticipants.archivedAt),
				})
				.returning({
					userIdent: routineReviewParticipants.userIdent,
					userName: routineReviewParticipants.userName,
				})

			for (const p of insertedParticipants) {
				await writeAuditLog(
					{
						action: "routine_review_participant_added",
						entityType: "routine_review_participant",
						entityId: review.id,
						newValue: p.userIdent,
						metadata: { reviewId: review.id, userName: p.userName },
						performedBy: params.createdBy,
					},
					tx,
				)
			}

			insertedCount = insertedParticipants.length
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
					participantCount: insertedCount,
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
			const existing = await tx
				.select({
					id: routineReviewParticipants.id,
					userIdent: routineReviewParticipants.userIdent,
					userName: routineReviewParticipants.userName,
				})
				.from(routineReviewParticipants)
				.where(and(eq(routineReviewParticipants.reviewId, reviewId), isNull(routineReviewParticipants.archivedAt)))

			const newSet = new Map(params.participants.map((p) => [p.userIdent, p]))
			const existingSet = new Map(existing.map((e) => [e.userIdent, e]))

			const toRemove = existing.filter((e) => !newSet.has(e.userIdent))
			const toAdd = params.participants.filter((p) => !existingSet.has(p.userIdent))

			if (toRemove.length > 0) {
				const archivedRows = await tx
					.update(routineReviewParticipants)
					.set({ archivedAt: new Date(), archivedBy: performedBy })
					.where(
						and(
							inArray(
								routineReviewParticipants.id,
								toRemove.map((r) => r.id),
							),
							isNull(routineReviewParticipants.archivedAt),
						),
					)
					.returning({
						id: routineReviewParticipants.id,
						userIdent: routineReviewParticipants.userIdent,
						userName: routineReviewParticipants.userName,
					})
				for (const r of archivedRows) {
					await writeAuditLog(
						{
							action: "routine_review_participant_removed",
							entityType: "routine_review_participant",
							entityId: reviewId,
							previousValue: r.userIdent,
							metadata: { reviewId, userName: r.userName },
							performedBy,
						},
						tx,
					)
				}
			}

			if (toAdd.length > 0) {
				const insertedRows = await tx
					.insert(routineReviewParticipants)
					.values(
						toAdd.map((p) => ({
							reviewId,
							userIdent: p.userIdent,
							userName: p.userName,
						})),
					)
					.onConflictDoNothing({
						target: [routineReviewParticipants.reviewId, routineReviewParticipants.userIdent],
						where: isNull(routineReviewParticipants.archivedAt),
					})
					.returning({
						id: routineReviewParticipants.id,
						userIdent: routineReviewParticipants.userIdent,
						userName: routineReviewParticipants.userName,
					})
				for (const r of insertedRows) {
					await writeAuditLog(
						{
							action: "routine_review_participant_added",
							entityType: "routine_review_participant",
							entityId: reviewId,
							newValue: r.userIdent,
							metadata: { reviewId, userName: r.userName },
							performedBy,
						},
						tx,
					)
				}
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
	if (statusChanged) {
		if (existing.applicationId) {
			const { syncApplicationControls } = await import("./application-controls.server")
			await syncApplicationControls(existing.applicationId, performedBy)
		} else {
			// Only sync section for actual section routines (not general null-app reviews)
			const routine = await getRoutine(existing.routineId)
			if (routine?.isSectionRoutine === 1 && routine.sectionId) {
				const { triggerSyncForSection } = await import("./application-controls.server")
				triggerSyncForSection(routine.sectionId, performedBy)
			}
		}
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
 * Arkiverer en review-lenke (soft-delete). Tar `expectedReviewId` for å
 * forhindre IDOR (kun lenker som tilhører den oppgitte gjennomgangen kan
 * arkiveres via en gitt rute-kontekst). Avviser også arkivering hvis
 * foreldre-rutinen er arkivert.
 *
 * Hele operasjonen kjøres i en transaksjon med `FOR SHARE`-lås på
 * foreldre-rutinen, slik at en samtidig `archiveRoutine()` blokkeres til
 * vår transaksjon er ferdig — sjekk og arkivering blir atomisk og lukker
 * TOCTOU-vinduet mellom archived-sjekk og oppdatering.
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
				linkArchivedAt: routineReviewLinks.archivedAt,
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
		// Idempotent: hvis lenken allerede er arkivert, ikke skriv audit-rad.
		if (archiveStatus.linkArchivedAt) return null

		const [link] = await tx
			.update(routineReviewLinks)
			.set({ archivedAt: new Date(), archivedBy: performedBy })
			.where(and(eq(routineReviewLinks.id, linkId), isNull(routineReviewLinks.archivedAt)))
			.returning()
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
		.where(
			and(
				eq(routineReviewParticipants.reviewId, reviewId),
				eq(routineReviewParticipants.userIdent, userIdent),
				isNull(routineReviewParticipants.archivedAt),
			),
		)
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

export async function getAppsRequiringRoutine(
	routineId: string,
	opts?: { sectionAppIdsCache?: Map<string, string[]> },
) {
	const routine = await getRoutine(routineId)
	if (!routine) return []

	// Section routines apply to all apps in the section — resolve via section membership
	if (routine.isSectionRoutine === 1 && routine.sectionId) {
		const cache = opts?.sectionAppIdsCache
		let appIds: string[]
		if (cache?.has(routine.sectionId)) {
			appIds = cache.get(routine.sectionId)!
		} else {
			appIds = await getAppIdsInSection(routine.sectionId)
			cache?.set(routine.sectionId, appIds)
		}
		if (appIds.length === 0) return []
		return db
			.select()
			.from(monitoredApplications)
			.where(and(inArray(monitoredApplications.id, appIds), isNull(monitoredApplications.archivedAt)))
			.orderBy(monitoredApplications.name)
	}

	// Collect app IDs from all matching paths (not just screening questions)
	const allMatchedAppIds = new Set<string>()

	// Path 1: Screening question links
	const questionLinks =
		routine.screeningQuestions.length > 0
			? routine.screeningQuestions
			: routine.screeningQuestionId && routine.screeningChoiceValue
				? [{ questionId: routine.screeningQuestionId, choiceValue: routine.screeningChoiceValue }]
				: []

	if (questionLinks.length > 0) {
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
		for (const id of matchingAppSets.flat()) allMatchedAppIds.add(id)
	}

	// Path 2: Persistence links (Oracle, PostgreSQL, etc.)
	if (routine.persistenceLinks.length > 0) {
		const persAppIds = await findAppsByPersistenceMatch(routine.persistenceLinks)
		for (const id of persAppIds) allMatchedAppIds.add(id)
	}

	// Path 3: Group classification links (Entra ID groups)
	if (routine.groupClassifications.length > 0) {
		const gcAppIds = await findAppsByGroupClassificationMatch(routine.groupClassifications)
		for (const id of gcAppIds) allMatchedAppIds.add(id)
	}

	// Path 4: Oracle role criticality links
	if (routine.oracleRoleCriticalities.length > 0) {
		const orcAppIds = await findAppsByOracleRoleCriticalityMatch(routine.oracleRoleCriticalities)
		for (const id of orcAppIds) allMatchedAppIds.add(id)
	}

	// Path 5: Screening selections (explicit per-app routine selections)
	const selectionRows = await db
		.select({ applicationId: screeningRoutineSelections.applicationId })
		.from(screeningRoutineSelections)
		.where(eq(screeningRoutineSelections.routineId, routineId))
	for (const row of selectionRows) allMatchedAppIds.add(row.applicationId)

	// Path 6: Section-wide (appliesToAllInSection but NOT isSectionRoutine)
	if (routine.appliesToAllInSection === 1 && routine.sectionId) {
		const cache = opts?.sectionAppIdsCache
		let sectionAppIds: string[]
		if (cache?.has(routine.sectionId)) {
			sectionAppIds = cache.get(routine.sectionId)!
		} else {
			sectionAppIds = await getAppIdsInSection(routine.sectionId)
			cache?.set(routine.sectionId, sectionAppIds)
		}
		for (const id of sectionAppIds) allMatchedAppIds.add(id)
	}

	// Path 7: Ruleset — apps that answered screening questions linked to rulesets containing this routine
	const rulesetAppIds = await findAppsByRulesetMatch(routineId)
	for (const id of rulesetAppIds) allMatchedAppIds.add(id)

	if (allMatchedAppIds.size === 0) return []

	// Filter by technology elements if routine requires them
	let filteredAppIds = [...allMatchedAppIds]
	if (routine.technologyElements.length > 0) {
		const elementIds = routine.technologyElements.map((e) => e.id)
		const appsWithElements = await db
			.select({
				applicationId: applicationTechnologyElements.applicationId,
			})
			.from(applicationTechnologyElements)
			.where(
				and(
					inArray(applicationTechnologyElements.applicationId, filteredAppIds),
					inArray(applicationTechnologyElements.elementId, elementIds),
					isNull(applicationTechnologyElements.archivedAt),
					isNotNull(applicationTechnologyElements.confirmedAt),
					isNull(applicationTechnologyElements.rejectedAt),
				),
			)
		filteredAppIds = [...new Set(appsWithElements.map((a) => a.applicationId))]
	}

	if (filteredAppIds.length === 0) return []

	return db
		.select()
		.from(monitoredApplications)
		.where(and(inArray(monitoredApplications.id, filteredAppIds), isNull(monitoredApplications.archivedAt)))
		.orderBy(monitoredApplications.name)
}

/** Reverse lookup: find apps that have persistence matching the routine's persistence links.
 * Mirrors forward logic: type and classification are matched independently across
 * all of an app's persistence entries (cross-product), not within a single row. */
async function findAppsByPersistenceMatch(
	persistenceLinks: Array<{ persistenceType: PersistenceType | null; dataClassification: DataClassification | null }>,
): Promise<string[]> {
	// Collect all required types and classifications from the routine's links
	const requiredTypes = [
		...new Set(persistenceLinks.map((l) => l.persistenceType).filter(Boolean)),
	] as PersistenceType[]
	const requiredClassifications = [
		...new Set(persistenceLinks.map((l) => l.dataClassification).filter(Boolean)),
	] as DataClassification[]

	// Pre-filter persistence entries by relevant types/classifications
	const filters = [isNull(applicationPersistence.archivedAt)]
	if (requiredTypes.length > 0 && requiredClassifications.length > 0) {
		filters.push(
			or(
				inArray(applicationPersistence.type, requiredTypes),
				inArray(applicationPersistence.dataClassification, requiredClassifications),
			)!,
		)
	} else if (requiredTypes.length > 0) {
		filters.push(inArray(applicationPersistence.type, requiredTypes))
	} else if (requiredClassifications.length > 0) {
		filters.push(inArray(applicationPersistence.dataClassification, requiredClassifications))
	}

	const allPersEntries = await db
		.select({
			applicationId: applicationPersistence.applicationId,
			type: applicationPersistence.type,
			dataClassification: applicationPersistence.dataClassification,
		})
		.from(applicationPersistence)
		.where(and(...filters))

	// Group by app and build type/classification sets per app (same as forward logic)
	const appSets = new Map<string, { types: Set<string>; classifications: Set<string> }>()
	for (const entry of allPersEntries) {
		let sets = appSets.get(entry.applicationId)
		if (!sets) {
			sets = { types: new Set(), classifications: new Set() }
			appSets.set(entry.applicationId, sets)
		}
		sets.types.add(entry.type)
		if (entry.dataClassification) sets.classifications.add(entry.dataClassification)
	}

	// For each app, check if any routine link matches using cross-product logic
	const matchedApps = new Set<string>()
	for (const [appId, sets] of appSets) {
		for (const link of persistenceLinks) {
			const typeMatch = !link.persistenceType || sets.types.has(link.persistenceType)
			const classMatch = !link.dataClassification || sets.classifications.has(link.dataClassification)
			if (typeMatch && classMatch) {
				matchedApps.add(appId)
				break
			}
		}
	}

	return [...matchedApps]
}

/** Reverse lookup: find apps with Entra groups matching the routine's group classification links */
async function findAppsByGroupClassificationMatch(
	groupClassifications: Array<{ classification: GroupAccessClassification | null }>,
): Promise<string[]> {
	const classifications = groupClassifications
		.map((gc) => gc.classification)
		.filter((c): c is GroupAccessClassification => c !== null)
	if (classifications.length === 0) return []

	const matchingGroupRows = await db
		.select({ groupId: entraGroupClassifications.groupId })
		.from(entraGroupClassifications)
		.where(
			and(
				inArray(entraGroupClassifications.classification, classifications),
				isNull(entraGroupClassifications.archivedAt),
			),
		)
	const matchingGroupIds = matchingGroupRows.map((r) => r.groupId)
	if (matchingGroupIds.length === 0) return []

	const allApps = new Set<string>()
	const matchingGroupIdSet = new Set(matchingGroupIds)

	// Auth integrations (groups is a JSON text column — only Entra ID integrations have groups)
	const authRows = await db
		.select({
			applicationId: applicationAuthIntegrations.applicationId,
			groups: applicationAuthIntegrations.groups,
		})
		.from(applicationAuthIntegrations)
		.where(and(isNotNull(applicationAuthIntegrations.groups), eq(applicationAuthIntegrations.type, "entra_id")))
	for (const row of authRows) {
		if (!row.groups) continue
		try {
			const parsed = JSON.parse(row.groups) as string[]
			if (parsed.some((gid) => matchingGroupIdSet.has(gid))) {
				allApps.add(row.applicationId)
			}
		} catch {
			// Invalid JSON — skip
		}
	}

	// Manual groups
	if (matchingGroupIds.length > 0) {
		const manualRows = await db
			.select({ applicationId: applicationManualGroups.applicationId })
			.from(applicationManualGroups)
			.where(
				and(inArray(applicationManualGroups.groupId, matchingGroupIds), isNull(applicationManualGroups.archivedAt)),
			)
		for (const r of manualRows) allApps.add(r.applicationId)
	}

	return [...allApps]
}

/** Reverse lookup: find apps with Oracle roles matching the routine's criticality links */
async function findAppsByOracleRoleCriticalityMatch(
	oracleRoleCriticalities: Array<{ criticality: GroupCriticality | null }>,
): Promise<string[]> {
	const criticalities = oracleRoleCriticalities
		.map((orc) => orc.criticality)
		.filter((c): c is GroupCriticality => c !== null)
	if (criticalities.length === 0) return []

	const matchingAssessments = await db
		.select({ applicationId: oracleRoleAssessments.applicationId })
		.from(oracleRoleAssessments)
		.where(inArray(oracleRoleAssessments.criticality, criticalities))

	return [...new Set(matchingAssessments.map((r) => r.applicationId))]
}

/** Reverse lookup: find apps linked via rulesets containing this routine.
 * Mirrors forward logic: for each ruleset, only includes apps that are effective
 * members of THAT ruleset's section and answered questions for THAT ruleset. */
async function findAppsByRulesetMatch(routineId: string): Promise<string[]> {
	const { rulesetRoutines, rulesets } = await import("../schema/rulesets")

	// Find rulesets that include this routine
	const rulesetRows = await db
		.select({ rulesetId: rulesetRoutines.rulesetId })
		.from(rulesetRoutines)
		.where(and(eq(rulesetRoutines.routineId, routineId), isNull(rulesetRoutines.archivedAt)))
	const rulesetIds = [...new Set(rulesetRows.map((r) => r.rulesetId))]
	if (rulesetIds.length === 0) return []

	// Only active, non-archived rulesets — also fetch sectionId for per-ruleset membership filtering
	const activeRulesets = await db
		.select({ id: rulesets.id, sectionId: rulesets.sectionId })
		.from(rulesets)
		.where(and(inArray(rulesets.id, rulesetIds), eq(rulesets.status, "active"), isNull(rulesets.archivedAt)))
	if (activeRulesets.length === 0) return []

	// Process each ruleset independently: find apps in that ruleset's section that answered its questions
	const matchedApps = new Set<string>()
	const sectionAppCache = new Map<string, Set<string>>()

	for (const ruleset of activeRulesets) {
		// Get (and cache) section membership for this ruleset's section
		let sectionApps = sectionAppCache.get(ruleset.sectionId)
		if (!sectionApps) {
			const appIds = await getAppIdsInSection(ruleset.sectionId)
			sectionApps = new Set(appIds)
			sectionAppCache.set(ruleset.sectionId, sectionApps)
		}
		if (sectionApps.size === 0) continue

		// Path A: questions with rulesetId pointing to THIS specific ruleset
		const answeredAppsA = await db
			.selectDistinct({ applicationId: screeningAnswers.applicationId })
			.from(screeningAnswers)
			.innerJoin(
				screeningQuestions,
				and(
					eq(screeningQuestions.id, screeningAnswers.questionId),
					isNull(screeningQuestions.archivedAt),
					eq(screeningQuestions.status, "approved"),
				),
			)
			.where(and(eq(screeningQuestions.rulesetId, ruleset.id), isNotNull(screeningAnswers.answer)))

		// Path B: questions with answerType='ruleset' where the answer IS this ruleset's ID
		const answeredAppsB = await db
			.selectDistinct({ applicationId: screeningAnswers.applicationId })
			.from(screeningAnswers)
			.innerJoin(
				screeningQuestions,
				and(
					eq(screeningQuestions.id, screeningAnswers.questionId),
					isNull(screeningQuestions.archivedAt),
					eq(screeningQuestions.status, "approved"),
					eq(screeningQuestions.answerType, "ruleset"),
				),
			)
			.where(and(eq(screeningAnswers.answer, ruleset.id)))

		// Only add apps that are in THIS ruleset's section
		for (const row of answeredAppsA) {
			if (sectionApps.has(row.applicationId)) matchedApps.add(row.applicationId)
		}
		for (const row of answeredAppsB) {
			if (sectionApps.has(row.applicationId)) matchedApps.add(row.applicationId)
		}
	}

	return [...matchedApps]
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

/** Get latest section-level review (applicationId IS NULL) for a section routine */
export async function getLatestSectionReview(routineId: string) {
	const [review] = await db
		.select()
		.from(routineReviews)
		.where(
			and(
				eq(routineReviews.routineId, routineId),
				isNull(routineReviews.applicationId),
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
 * Returnerer `null` for rutiner uten periodisk frekvens (hendelsesbaserte).
 */
export function calculateDeadline(
	lastReviewDate: Date | null,
	routineCreatedAt: Date,
	frequency: RoutineFrequency | null,
): Date | null {
	if (!frequency) return null
	const base = lastReviewDate ?? routineCreatedAt
	const days = frequencyDays[frequency]
	const deadline = new Date(base)
	deadline.setDate(deadline.getDate() + days)
	return deadline
}

/** Returnerer true hvis fristen ligger i fortid. Null deadline er aldri over frist. */
export function isOverdue(deadline: Date | null): boolean {
	if (!deadline) return false
	return new Date() > deadline
}

export interface RoutineDeadlineInfo {
	routine: Awaited<ReturnType<typeof getRoutine>>
	applicationId: string
	applicationName: string
	lastReviewDate: Date | null
	deadline: Date | null
	overdue: boolean
	matchedPersistenceLinks?: Array<{ persistenceType: string | null; dataClassification: string | null }>
}

export interface DeadlineResolverOpts {
	appName?: string
	appElementIds?: Set<string>
}

async function getDeadlineResolverAppName(applicationId: string, opts?: DeadlineResolverOpts) {
	if (opts?.appName !== undefined) return opts.appName

	const [appRow] = await db
		.select({ name: monitoredApplications.name })
		.from(monitoredApplications)
		.where(eq(monitoredApplications.id, applicationId))
		.limit(1)

	return appRow?.name ?? ""
}

async function getDeadlineResolverAppElementIds(applicationId: string, opts?: DeadlineResolverOpts) {
	if (opts?.appElementIds) return opts.appElementIds

	const appTechElements = await db
		.select({ elementId: applicationTechnologyElements.elementId })
		.from(applicationTechnologyElements)
		.where(
			and(
				eq(applicationTechnologyElements.applicationId, applicationId),
				isNull(applicationTechnologyElements.archivedAt),
				isNotNull(applicationTechnologyElements.confirmedAt),
				isNull(applicationTechnologyElements.rejectedAt),
			),
		)

	return new Set(appTechElements.map((e) => e.elementId))
}

export async function getRoutineDeadlinesForSection(sectionId: string): Promise<RoutineDeadlineInfo[]> {
	const sectionRoutines = await db
		.select()
		.from(routines)
		.where(and(eq(routines.sectionId, sectionId), and(eq(routines.status, "approved"), isNull(routines.archivedAt))))

	const results: RoutineDeadlineInfo[] = []

	// Pre-fetch section-level reviews for section routines
	const sectionRoutineIds = sectionRoutines.filter((r) => r.isSectionRoutine === 1).map((r) => r.id)
	const sectionReviewMap = new Map<string, Date | null>()
	if (sectionRoutineIds.length > 0) {
		const sectionReviews = await db
			.selectDistinctOn([routineReviews.routineId], {
				routineId: routineReviews.routineId,
				reviewedAt: routineReviews.reviewedAt,
			})
			.from(routineReviews)
			.where(
				and(
					inArray(routineReviews.routineId, sectionRoutineIds),
					isNull(routineReviews.applicationId),
					eq(routineReviews.status, "completed"),
				),
			)
			.orderBy(routineReviews.routineId, desc(routineReviews.reviewedAt))
		for (const sr of sectionReviews) {
			sectionReviewMap.set(sr.routineId, sr.reviewedAt)
		}
	}

	const sectionAppIdsCache = new Map<string, string[]>()
	for (const routine of sectionRoutines) {
		const fullRoutine = await getRoutine(routine.id)
		const apps = await getAppsRequiringRoutine(routine.id, { sectionAppIdsCache })

		for (const app of apps) {
			// Section routines use section-level review; regular routines use per-app review
			const lastReviewDate =
				routine.isSectionRoutine === 1
					? (sectionReviewMap.get(routine.id) ?? null)
					: ((await getLatestReviewForApp(routine.id, app.id))?.reviewedAt ?? null)
			const deadline = calculateDeadline(
				lastReviewDate,
				routine.createdAt,
				routine.frequency as RoutineFrequency | null,
			)

			results.push({
				routine: fullRoutine,
				applicationId: app.id,
				applicationName: app.name,
				lastReviewDate,
				deadline,
				overdue: isOverdue(deadline),
			})
		}
	}

	return results
}

export async function getRoutineDeadlinesForApp(applicationId: string, opts?: DeadlineResolverOpts) {
	// Step 1: Find routines linked to this application's question+answer combinations in batch
	// The INNER JOINs naturally return empty when the app has no screening answers
	const [screeningLinkedRoutines, legacyLinkedRoutines] = await Promise.all([
		db
			.selectDistinct({ routineId: routineScreeningQuestions.routineId })
			.from(routineScreeningQuestions)
			.innerJoin(
				screeningAnswers,
				and(
					eq(routineScreeningQuestions.questionId, screeningAnswers.questionId),
					eq(routineScreeningQuestions.choiceValue, screeningAnswers.answer),
				),
			)
			.innerJoin(
				routines,
				and(
					eq(routines.id, routineScreeningQuestions.routineId),
					eq(routines.status, "approved"),
					isNull(routines.archivedAt),
				),
			)
			.where(and(eq(screeningAnswers.applicationId, applicationId), isNull(routineScreeningQuestions.archivedAt))),
		db
			.selectDistinct({ id: routines.id })
			.from(routines)
			.innerJoin(
				screeningAnswers,
				and(
					eq(routines.screeningQuestionId, screeningAnswers.questionId),
					eq(routines.screeningChoiceValue, screeningAnswers.answer),
				),
			)
			.where(
				and(
					eq(screeningAnswers.applicationId, applicationId),
					eq(routines.status, "approved"),
					isNull(routines.archivedAt),
				),
			),
	])

	const matchingRoutineIds = new Set<string>()
	for (const link of screeningLinkedRoutines) matchingRoutineIds.add(link.routineId)
	for (const routine of legacyLinkedRoutines) matchingRoutineIds.add(routine.id)

	if (matchingRoutineIds.size === 0) return []

	// Step 3: Load matched routines with tech elements, screening questions, and persistence links in batch
	const routineIdList = [...matchingRoutineIds]
	const [routineRows, allElements, allScreeningLinks, allPersLinks] = await Promise.all([
		db
			.select()
			.from(routines)
			.where(
				and(inArray(routines.id, routineIdList), and(eq(routines.status, "approved"), isNull(routines.archivedAt))),
			),
		db
			.select({
				routineId: routineTechnologyElements.routineId,
				id: technologyElements.id,
				name: technologyElements.name,
			})
			.from(routineTechnologyElements)
			.innerJoin(technologyElements, eq(routineTechnologyElements.elementId, technologyElements.id))
			.where(
				and(inArray(routineTechnologyElements.routineId, routineIdList), isNull(routineTechnologyElements.archivedAt)),
			),
		db
			.select()
			.from(routineScreeningQuestions)
			.where(
				and(inArray(routineScreeningQuestions.routineId, routineIdList), isNull(routineScreeningQuestions.archivedAt)),
			),
		db
			.select()
			.from(routinePersistenceLinks)
			.where(
				and(inArray(routinePersistenceLinks.routineId, routineIdList), isNull(routinePersistenceLinks.archivedAt)),
			),
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
	const [appElementIds, appName] = await Promise.all([
		getDeadlineResolverAppElementIds(applicationId, opts),
		getDeadlineResolverAppName(applicationId, opts),
	])

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
		const deadline = calculateDeadline(lastReviewDate, routine.createdAt, routine.frequency as RoutineFrequency | null)

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
	opts?: DeadlineResolverOpts,
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
	const allPersLinks = await db.select().from(routinePersistenceLinks).where(isNull(routinePersistenceLinks.archivedAt))
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
		.where(and(inArray(routines.id, routineIds), and(eq(routines.status, "approved"), isNull(routines.archivedAt))))

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
			.where(
				and(inArray(routineTechnologyElements.routineId, routineIdList), isNull(routineTechnologyElements.archivedAt)),
			),
		db
			.select()
			.from(routineScreeningQuestions)
			.where(
				and(inArray(routineScreeningQuestions.routineId, routineIdList), isNull(routineScreeningQuestions.archivedAt)),
			),
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

	const appName = await getDeadlineResolverAppName(applicationId, opts)

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
		const deadline = calculateDeadline(lastReviewDate, routine.createdAt, routine.frequency as RoutineFrequency | null)

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
	opts?: DeadlineResolverOpts,
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
		.where(and(eq(applicationManualGroups.applicationId, applicationId), isNull(applicationManualGroups.archivedAt)))
	for (const mg of manualGroups) groupIds.add(mg.groupId)

	if (groupIds.size === 0) return []

	// Get classifications for these groups
	const classifications = await db
		.select({
			groupId: entraGroupClassifications.groupId,
			classification: entraGroupClassifications.classification,
		})
		.from(entraGroupClassifications)
		.where(and(inArray(entraGroupClassifications.groupId, [...groupIds]), isNull(entraGroupClassifications.archivedAt)))

	if (classifications.length === 0) return []

	const appClassifications = new Set(classifications.map((c) => c.classification))

	// Find routines with matching group classification links
	const allGcLinks = await db
		.select()
		.from(routineGroupClassificationLinks)
		.where(isNull(routineGroupClassificationLinks.archivedAt))
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
		.where(and(inArray(routines.id, routineIds), and(eq(routines.status, "approved"), isNull(routines.archivedAt))))

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
			.where(
				and(inArray(routineTechnologyElements.routineId, routineIdList), isNull(routineTechnologyElements.archivedAt)),
			),
		db
			.select()
			.from(routineScreeningQuestions)
			.where(
				and(inArray(routineScreeningQuestions.routineId, routineIdList), isNull(routineScreeningQuestions.archivedAt)),
			),
		db
			.select()
			.from(routinePersistenceLinks)
			.where(
				and(inArray(routinePersistenceLinks.routineId, routineIdList), isNull(routinePersistenceLinks.archivedAt)),
			),
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

	const appName = await getDeadlineResolverAppName(applicationId, opts)

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
		const deadline = calculateDeadline(lastReviewDate, routine.createdAt, routine.frequency as RoutineFrequency | null)

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
	opts?: DeadlineResolverOpts,
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
				isNull(routineOracleRoleCriticalityLinks.archivedAt),
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
		.where(and(inArray(routines.id, routineIds), and(eq(routines.status, "approved"), isNull(routines.archivedAt))))

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
			.where(
				and(inArray(routineTechnologyElements.routineId, routineIdList), isNull(routineTechnologyElements.archivedAt)),
			),
		db
			.select()
			.from(routineScreeningQuestions)
			.where(
				and(inArray(routineScreeningQuestions.routineId, routineIdList), isNull(routineScreeningQuestions.archivedAt)),
			),
		db
			.select()
			.from(routinePersistenceLinks)
			.where(
				and(inArray(routinePersistenceLinks.routineId, routineIdList), isNull(routinePersistenceLinks.archivedAt)),
			),
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

	const appName = await getDeadlineResolverAppName(applicationId, opts)

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
		const deadline = calculateDeadline(lastReviewDate, routine.createdAt, routine.frequency as RoutineFrequency | null)

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
	opts?: DeadlineResolverOpts,
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
			.where(and(inArray(routines.id, uniqueIds), and(eq(routines.status, "approved"), isNull(routines.archivedAt)))),
		db
			.select({
				routineId: routineTechnologyElements.routineId,
				id: technologyElements.id,
				name: technologyElements.name,
			})
			.from(routineTechnologyElements)
			.innerJoin(technologyElements, eq(routineTechnologyElements.elementId, technologyElements.id))
			.where(
				and(inArray(routineTechnologyElements.routineId, uniqueIds), isNull(routineTechnologyElements.archivedAt)),
			),
		db
			.select()
			.from(routineScreeningQuestions)
			.where(
				and(inArray(routineScreeningQuestions.routineId, uniqueIds), isNull(routineScreeningQuestions.archivedAt)),
			),
		db
			.select()
			.from(routinePersistenceLinks)
			.where(and(inArray(routinePersistenceLinks.routineId, uniqueIds), isNull(routinePersistenceLinks.archivedAt))),
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

	const appName = await getDeadlineResolverAppName(applicationId, opts)

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
		const deadline = calculateDeadline(lastReviewDate, routine.createdAt, routine.frequency as RoutineFrequency | null)

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
	opts?: DeadlineResolverOpts,
): Promise<RoutineDeadlineInfo[]> {
	// Find section IDs for this app via both nais environments and direct team mappings
	const sectionIds = await getSectionIdsForApp(applicationId)
	if (sectionIds.length === 0) return []

	// Find routines that apply to all apps in these sections (approved only)
	const sectionRoutines = await db
		.select()
		.from(routines)
		.where(
			and(
				inArray(routines.sectionId, sectionIds),
				eq(routines.appliesToAllInSection, 1),
				and(eq(routines.status, "approved"), isNull(routines.archivedAt)),
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
			.where(
				and(inArray(routineTechnologyElements.routineId, routineIdList), isNull(routineTechnologyElements.archivedAt)),
			),
		db
			.select()
			.from(routineScreeningQuestions)
			.where(
				and(inArray(routineScreeningQuestions.routineId, routineIdList), isNull(routineScreeningQuestions.archivedAt)),
			),
		db
			.select()
			.from(routinePersistenceLinks)
			.where(
				and(inArray(routinePersistenceLinks.routineId, routineIdList), isNull(routinePersistenceLinks.archivedAt)),
			),
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

	const appName = await getDeadlineResolverAppName(applicationId, opts)

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
		const deadline = calculateDeadline(lastReviewDate, routine.createdAt, routine.frequency as RoutineFrequency | null)

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
	opts?: DeadlineResolverOpts,
): Promise<RoutineDeadlineInfo[]> {
	// Find section IDs for this app
	const sectionIds = await getSectionIdsForApp(applicationId)
	if (sectionIds.length === 0) return []

	// Find rulesets in these sections
	const { rulesetRoutines } = await import("../schema/rulesets")
	const { rulesets } = await import("../schema/rulesets")
	const sectionRulesets = await db
		.select({ id: rulesets.id })
		.from(rulesets)
		.where(and(inArray(rulesets.sectionId, sectionIds), eq(rulesets.status, "active")))
	const rulesetIds = sectionRulesets.map((r) => r.id)
	if (rulesetIds.length === 0) return []

	// Filter: only include rulesets where the app has answered a screening question linked to that ruleset.
	// Two paths:
	// 1. Question has rulesetId pointing to the ruleset (non-ruleset answer types)
	// 2. Question has answerType='ruleset' and the answer IS the ruleset ID (ruleset selection questions)
	const answeredRulesetRows = await db
		.selectDistinct({ rulesetId: screeningQuestions.rulesetId })
		.from(screeningAnswers)
		.innerJoin(
			screeningQuestions,
			and(
				eq(screeningQuestions.id, screeningAnswers.questionId),
				isNull(screeningQuestions.archivedAt),
				eq(screeningQuestions.status, "approved"),
			),
		)
		.where(
			and(
				eq(screeningAnswers.applicationId, applicationId),
				isNotNull(screeningQuestions.rulesetId),
				inArray(screeningQuestions.rulesetId, rulesetIds),
				isNotNull(screeningAnswers.answer),
			),
		)

	const selectedRulesetRows = await db
		.selectDistinct({ rulesetId: screeningAnswers.answer })
		.from(screeningAnswers)
		.innerJoin(
			screeningQuestions,
			and(
				eq(screeningQuestions.id, screeningAnswers.questionId),
				isNull(screeningQuestions.archivedAt),
				eq(screeningQuestions.status, "approved"),
				eq(screeningQuestions.answerType, "ruleset"),
			),
		)
		.where(
			and(
				eq(screeningAnswers.applicationId, applicationId),
				isNotNull(screeningAnswers.answer),
				inArray(screeningAnswers.answer, rulesetIds),
			),
		)

	const answeredRulesetIds = [
		...new Set([
			...answeredRulesetRows.map((r) => r.rulesetId).filter((id): id is string => id !== null),
			...selectedRulesetRows.map((r) => r.rulesetId).filter((id): id is string => id !== null),
		]),
	]
	if (answeredRulesetIds.length === 0) return []

	// Find routines linked to the answered rulesets
	const rulesetRoutineRows = await db
		.select({ routineId: rulesetRoutines.routineId })
		.from(rulesetRoutines)
		.where(and(inArray(rulesetRoutines.rulesetId, answeredRulesetIds), isNull(rulesetRoutines.archivedAt)))

	const routineIds = rulesetRoutineRows.map((r) => r.routineId).filter((id) => !excludeRoutineIds.has(id))
	const uniqueIds = [...new Set(routineIds)]
	if (uniqueIds.length === 0) return []

	const [routineRows, allElements, allScreeningLinks, allPersLinks] = await Promise.all([
		db
			.select()
			.from(routines)
			.where(and(inArray(routines.id, uniqueIds), and(eq(routines.status, "approved"), isNull(routines.archivedAt)))),
		db
			.select({
				routineId: routineTechnologyElements.routineId,
				id: technologyElements.id,
				name: technologyElements.name,
			})
			.from(routineTechnologyElements)
			.innerJoin(technologyElements, eq(routineTechnologyElements.elementId, technologyElements.id))
			.where(
				and(inArray(routineTechnologyElements.routineId, uniqueIds), isNull(routineTechnologyElements.archivedAt)),
			),
		db
			.select()
			.from(routineScreeningQuestions)
			.where(
				and(inArray(routineScreeningQuestions.routineId, uniqueIds), isNull(routineScreeningQuestions.archivedAt)),
			),
		db
			.select()
			.from(routinePersistenceLinks)
			.where(and(inArray(routinePersistenceLinks.routineId, uniqueIds), isNull(routinePersistenceLinks.archivedAt))),
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

	const appName = await getDeadlineResolverAppName(applicationId, opts)

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
		const deadline = calculateDeadline(lastReviewDate, routine.createdAt, routine.frequency as RoutineFrequency | null)

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

	const enrichedReviews = await enrichReviewsBatch(reviews.map((r) => r.review))
	return enrichedReviews.map((enriched, i) => ({
		...enriched,
		routineName: reviews[i].routineName,
		applicationName: reviews[i].appName,
	}))
}

// ─── Section Routines ────────────────────────────────────────────────────

export async function getSectionRoutinesForSection(sectionId: string) {
	const sectionRoutineRows = await db
		.select()
		.from(routines)
		.where(and(eq(routines.sectionId, sectionId), eq(routines.isSectionRoutine, 1), isNull(routines.archivedAt)))
		.orderBy(routines.name)

	if (sectionRoutineRows.length === 0) return []

	const routineIds = sectionRoutineRows.map((r) => r.id)

	// Get latest completed section-level review (applicationId IS NULL) per routine
	const latestReviews = await db
		.selectDistinctOn([routineReviews.routineId], {
			routineId: routineReviews.routineId,
			reviewedAt: routineReviews.reviewedAt,
			reviewId: routineReviews.id,
			title: routineReviews.title,
			status: routineReviews.status,
			createdBy: routineReviews.createdBy,
		})
		.from(routineReviews)
		.where(
			and(
				inArray(routineReviews.routineId, routineIds),
				isNull(routineReviews.applicationId),
				eq(routineReviews.status, "completed"),
			),
		)
		.orderBy(routineReviews.routineId, desc(routineReviews.reviewedAt))

	const reviewByRoutine = new Map(latestReviews.map((r) => [r.routineId, r]))

	return sectionRoutineRows.map((routine) => {
		const lastReview = reviewByRoutine.get(routine.id) ?? null
		const lastReviewDate = lastReview?.reviewedAt ?? null
		const deadline = calculateDeadline(lastReviewDate, routine.createdAt, routine.frequency as RoutineFrequency | null)
		return {
			routine,
			lastReview,
			lastReviewDate,
			deadline,
			overdue: isOverdue(deadline),
		}
	})
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
 * Godkjenner en rutine (kun mulig fra status `ready`). Godkjente rutiner
 * kan ikke redigeres etterpå — kun erstattes via {@link replaceRoutine}.
 */
export async function approveRoutine(routineId: string, performedBy: string) {
	const routine = await getRoutine(routineId)
	if (!routine) return null
	if (routine.status !== "ready") {
		throw new Response("Kun ferdige rutiner kan godkjennes", { status: 400 })
	}

	// Atomisk: archive-guard + UPDATE i tx med FOR SHARE-lås på rutinen så
	// samtidig archiveRoutine() blokkeres til vår tx er ferdig. UPDATE re-
	// validerer status='ready' og archived_at IS NULL i WHERE-clauselen, så
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
			.where(and(eq(routines.id, routineId), eq(routines.status, "ready"), isNull(routines.archivedAt)))
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
		if (!source.frequency && !source.eventFrequency) {
			throw new Response("Kan ikke kopiere rutine uten frekvens", { status: 400 })
		}

		const [copy] = await tx
			.insert(routines)
			.values({
				sectionId: source.sectionId,
				name: `${source.name} (kopi)`,
				description: source.description,
				frequency: source.frequency,
				eventFrequency: source.eventFrequency,
				responsibleRole: source.responsibleRole,
				appliesToAllInSection: source.appliesToAllInSection,
				isSectionRoutine: source.isSectionRoutine,
				sectionRoutineOwnerRole: source.sectionRoutineOwnerRole,
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
