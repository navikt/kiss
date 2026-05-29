import { and, desc, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm"
import {
	applyEntraStagedDataPatch,
	ENTRA_STAGED_DATA_ACTIVITY_TYPE,
	ENTRA_STAGED_DATA_SCHEMA_VERSION,
	type EntraGroupSnapshot,
	type EntraStagedData,
	parseEntraStagedData,
	type StagedDataPatch,
	toEntraGroupSnapshot,
} from "../../lib/entra-staged-data"
import { resolveGroupNames } from "../../lib/graph.server"
import { withAdvisoryLock } from "../../lib/lock.server"
import { frequencyDays, type RoutineFrequency } from "../../lib/routine-frequencies"
import { db } from "../connection.server"
import {
	applicationAuthIntegrations,
	applicationGroupAssessments,
	applicationManualGroups,
	applicationPersistence,
	type DataClassification,
	entraGroupClassifications,
	type GroupAccessClassification,
	type GroupCriticality,
	monitoredApplications,
	type PersistenceType,
} from "../schema/applications"
import { type AuditLogAction, auditLog } from "../schema/audit"
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
	FOLLOW_UP_POINT_STATUSES,
	type FollowUpPointAttachmentKind,
	type FollowUpPointStatus,
	type PeriodConfig,
	type ReviewActivityProviderConfig,
	type ReviewStatus,
	type RoutineActivityType,
	type RoutineStatus,
	routineActivityLinks,
	routineControls,
	routineGroupClassificationLinks,
	routineOracleRoleCriticalityLinks,
	routinePersistenceLinks,
	routineReviewActivities,
	routineReviewActivityEntraChanges,
	routineReviewAttachments,
	routineReviewFollowUpPointAttachments,
	routineReviewFollowUpPoints,
	routineReviewLinks,
	routineReviewParticipants,
	routineReviews,
	routineScreeningQuestions,
	routines,
	routineTechnologyElements,
} from "../schema/routines"
import { screeningAnswers, screeningQuestions, screeningRoutineSelections } from "../schema/screening"
import { writeAuditLog } from "./audit.server"
import { getAppAuthIntegrations, getGroupAssessmentsForApp, getManualGroupsForApp } from "./nais.server"
import { completeRpaReviewActivity } from "./rpa.server"
import { getEffectiveAppIdsInSection } from "./sections.server"

// ─── Resolver opts for deadline pipeline ─────────────────────────────────

export interface ResolverOpts {
	appName?: string
	appElementIds?: Set<string>
}

async function resolveAppName(applicationId: string, opts?: ResolverOpts): Promise<string> {
	if (opts?.appName !== undefined) return opts.appName
	const [appRow] = await db
		.select({ name: monitoredApplications.name })
		.from(monitoredApplications)
		.where(eq(monitoredApplications.id, applicationId))
		.limit(1)
	return appRow?.name ?? ""
}

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
	activityTypes?: RoutineActivityType[]
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

	const routine = await db.transaction(async (tx) => {
		const [routine] = await tx
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
				screeningQuestionId: params.screeningQuestionId,
				screeningChoiceValue: params.screeningChoiceValue,
				...(params.status && { status: params.status }),
				createdBy: params.createdBy,
				updatedBy: params.createdBy,
			})
			.returning()

		if (params.technologyElementIds.length > 0) {
			await tx.insert(routineTechnologyElements).values(
				params.technologyElementIds.map((elementId) => ({
					routineId: routine.id,
					elementId,
				})),
			)
		}

		if (params.controlIds.length > 0) {
			await tx.insert(routineControls).values(
				params.controlIds.map((controlId) => ({
					routineId: routine.id,
					controlId,
				})),
			)
		}

		// Insert persistence links
		if (params.persistenceLinks.length > 0) {
			await tx.insert(routinePersistenceLinks).values(
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
			await tx.insert(routineGroupClassificationLinks).values(
				gcLinks.map((classification) => ({
					routineId: routine.id,
					classification,
				})),
			)
		}

		// Insert oracle role criticality links
		const orcLinks = params.oracleRoleCriticalities ?? []
		if (orcLinks.length > 0) {
			await tx.insert(routineOracleRoleCriticalityLinks).values(
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
			await tx.insert(routineScreeningQuestions).values(
				links.map((link) => ({
					routineId: routine.id,
					questionId: link.questionId,
					choiceValue: link.choiceValue,
				})),
			)
		}

		// Insert activity links (new multi-activity support)
		const activityTypes = [...new Set(params.isSectionRoutine ? [] : (params.activityTypes ?? []))]
		if (activityTypes.length > 0) {
			await tx.insert(routineActivityLinks).values(
				activityTypes.map((activityType, index) => ({
					routineId: routine.id,
					activityType,
					sortOrder: index,
					createdBy: params.createdBy,
				})),
			)
		}

		await writeAuditLog(
			{
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
					activityTypes,
				},
				performedBy: params.createdBy,
			},
			tx,
		)

		return routine
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
 *
 * **Aktivitetslenker synkroniseres kun hvis:**
 * - `activityTypes` er eksplisitt satt (erstatter alle eksisterende lenker), eller
 * - `isSectionRoutine: true` sendes (sletter alle lenker, seksjonsrutiner har ingen aktivitetstype)
 *
 * `isSectionRoutine: false` alene trigger IKKE synkronisering — eksisterende lenker bevares.
 * Kall-steder som konverterer en seksjonsrutine til vanlig rutine MÅ sende `activityTypes`
 * (eventuelt tom array) for at lenkene skal oppdateres.
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
	activityTypes?: RoutineActivityType[]
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

		// Compute effective activity types before UPDATE (for link table sync)
		// When neither activityTypes nor isSectionRoutine:true is provided, preserve existing state.
		// isSectionRoutine:false alone does NOT clear links — only explicit activityTypes or switching
		// to section routine (isSectionRoutine:true) triggers a link sync.
		const hasActivityInput = params.activityTypes !== undefined || params.isSectionRoutine === true
		const effectiveActivityTypes = hasActivityInput
			? [...new Set(effectiveIsSectionRoutine ? [] : (params.activityTypes ?? []))]
			: null

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

		// ── Activity links (new multi-activity) — skip when no activity input provided
		if (effectiveActivityTypes !== null) {
			const existingActivityLinks = await tx
				.select({ activityType: routineActivityLinks.activityType })
				.from(routineActivityLinks)
				.where(and(eq(routineActivityLinks.routineId, params.id), isNull(routineActivityLinks.archivedAt)))
				.orderBy(routineActivityLinks.sortOrder)
			const prevActivityTypes = existingActivityLinks.map((a) => a.activityType)
			const activityChanged =
				effectiveActivityTypes.length !== prevActivityTypes.length ||
				effectiveActivityTypes.some((t, i) => t !== prevActivityTypes[i])

			if (activityChanged) {
				// Archive existing
				await tx
					.update(routineActivityLinks)
					.set({ archivedAt: new Date(), archivedBy: params.updatedBy })
					.where(and(eq(routineActivityLinks.routineId, params.id), isNull(routineActivityLinks.archivedAt)))
				// Insert new
				if (effectiveActivityTypes.length > 0) {
					await tx.insert(routineActivityLinks).values(
						effectiveActivityTypes.map((activityType, index) => ({
							routineId: params.id,
							activityType,
							sortOrder: index,
							createdBy: params.updatedBy,
						})),
					)
				}
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
					// Only include activityTypes when activity input was explicitly provided.
					// null means "no input given, DB state preserved" and should not be logged.
					...(effectiveActivityTypes !== null && { activityTypes: effectiveActivityTypes }),
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
			if (!existing) throw new Response(`Rutine med id=${id} finnes ikke`, { status: 404 })
			if (existing.archivedAt) return existing // idempotent: allerede arkivert
			throw new Response(`Kan ikke arkivere rutine (status="${existing.status}", forventet "approved")`, {
				status: 409,
			})
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
 * Sletter en draft-rutine ved å arkivere den med status='deleted'.
 * Kun draft-rutiner kan slettes — godkjente rutiner skal arkiveres via archiveRoutine.
 */
export async function deleteDraftRoutine(id: string, performedBy: string) {
	return db.transaction(async (tx) => {
		const [deleted] = await tx
			.update(routines)
			.set({
				status: "deleted",
				archivedAt: new Date(),
				archivedBy: performedBy,
				updatedAt: new Date(),
				updatedBy: performedBy,
			})
			.where(and(eq(routines.id, id), isNull(routines.archivedAt), eq(routines.status, "draft")))
			.returning()
		if (!deleted) {
			const [existing] = await tx.select().from(routines).where(eq(routines.id, id)).limit(1)
			if (!existing) throw new Response(`Rutine med id=${id} finnes ikke`, { status: 404 })
			if (existing.archivedAt && existing.status === "deleted") return existing // idempotent: allerede slettet
			throw new Response(`Kan ikke slette rutine (status="${existing.status}", forventet "draft")`, { status: 409 })
		}

		await writeAuditLog(
			{
				action: "routine_deleted",
				entityType: "routine",
				entityId: id,
				previousValue: JSON.stringify({ name: deleted.name, status: "draft" }),
				newValue: JSON.stringify({ name: deleted.name, status: "deleted", archivedAt: deleted.archivedAt }),
				performedBy,
			},
			tx,
		)
		return deleted
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
		if (!existing) throw new Response(`Rutine med id=${id} finnes ikke`, { status: 404 })
		if (!existing.archivedAt) return existing // idempotent: allerede aktiv
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

	const [allParticipants, allAttachments, allLinks, allFollowUps] = await Promise.all([
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
		db
			.select()
			.from(routineReviewFollowUpPoints)
			.where(inArray(routineReviewFollowUpPoints.reviewId, reviewIds))
			.orderBy(routineReviewFollowUpPoints.createdAt),
	])

	const followUpIds = allFollowUps.map((f) => f.id)
	const allFollowUpAttachments =
		followUpIds.length > 0
			? await db
					.select()
					.from(routineReviewFollowUpPointAttachments)
					.where(inArray(routineReviewFollowUpPointAttachments.pointId, followUpIds))
					.orderBy(routineReviewFollowUpPointAttachments.uploadedAt)
			: []

	const attachmentsByPoint = new Map<string, (typeof allFollowUpAttachments)[number][]>()
	for (const a of allFollowUpAttachments) {
		const arr = attachmentsByPoint.get(a.pointId) ?? []
		arr.push(a)
		attachmentsByPoint.set(a.pointId, arr)
	}

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

	const followUpsByReview = new Map<string, (typeof allFollowUps)[number][]>()
	for (const f of allFollowUps) {
		const arr = followUpsByReview.get(f.reviewId) ?? []
		arr.push(f)
		followUpsByReview.set(f.reviewId, arr)
	}

	return reviews.map((review) => ({
		...review,
		participants: participantsByReview.get(review.id) ?? [],
		attachments: attachmentsByReview.get(review.id) ?? [],
		links: linksByReview.get(review.id) ?? [],
		followUpPoints: (followUpsByReview.get(review.id) ?? []).map((f) => ({
			...f,
			attachments: attachmentsByPoint.get(f.id) ?? [],
		})),
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
	if (existing.status !== "draft") return null

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
		if (snapshot.reviewStatus !== "draft") {
			// Status endret seg fra draft til noe annet (fullført / needs_follow_up
			// / discarded) inne i tx-vinduet (samtidig completeReview / discard
			// race) → 409 Conflict.
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
	if (existing.status !== "draft") return existing

	// Forretningsinvariant: alle oppfølgingspunkter må ha en lagret beskrivelse
	// før gjennomgangen kan fullføres. Dette sikrer at hvert punkt er
	// tilstrekkelig dokumentert for senere oppfølging.
	const pointsMissingDescription = existing.followUpPoints.filter(
		(p) => !p.description || p.description.trim().length === 0,
	)
	if (pointsMissingDescription.length > 0) {
		throw new Response(
			"Alle oppfølgingspunkter må ha en beskrivelse før gjennomgangen kan fullføres. Mangler beskrivelse på: " +
				pointsMissingDescription.map((p) => p.text).join(", "),
			{ status: 400 },
		)
	}

	const allActivities = await getReviewActivities(reviewId)
	for (const activity of allActivities) {
		if (
			activity.status === "pending" &&
			activity.type === "entra_id_group_maintenance" &&
			existing.applicationId &&
			!activity.stagedData
		) {
			await seedEntraActivity(activity.id, existing.applicationId, performedBy)
		}
	}

	// Atomisk: archive-guard + activity-complete + status UPDATE i samme tx
	// med FOR SHARE-lås på foreldre-rutinen så samtidig archiveRoutine()
	// blokkeres til vår tx er ferdig. Audit + compliance-sync hopper over
	// hvis status-UPDATE matchet 0 rader (samtidig completion-race).
	const result = await db.transaction(async (tx) => {
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

		// Fullfør alle ventende aktiviteter innenfor tx slik at de rolles
		// tilbake hvis status-UPDATE feiler eller archive-guarden kaster.
		for (const activity of allActivities) {
			if (activity.status === "pending") {
				await completeReviewActivity(activity.id, null, performedBy, tx)
			}
		}

		// Hvis det finnes uadresserte oppfølgingspunkter blir status
		// `needs_follow_up` heller enn `completed`. Når alle punktene
		// senere markeres som fullført/ikke relevant flyttes status til
		// `completed` av `updateFollowUpPointStatus`, som re-evaluerer
		// gjennomgangsstatusen basert på gjenværende uadresserte punkter.
		const unresolvedFollowUps = await tx
			.select({ id: routineReviewFollowUpPoints.id })
			.from(routineReviewFollowUpPoints)
			.where(
				and(
					eq(routineReviewFollowUpPoints.reviewId, reviewId),
					eq(routineReviewFollowUpPoints.status, "needs_follow_up"),
				),
			)
			.limit(1)
		const newStatus: "completed" | "needs_follow_up" = unresolvedFollowUps.length > 0 ? "needs_follow_up" : "completed"

		const updated = await tx
			.update(routineReviews)
			.set({ status: newStatus })
			.where(and(eq(routineReviews.id, reviewId), eq(routineReviews.status, "draft")))
			.returning({ id: routineReviews.id })

		// Status endret seg mellom pre-check og UPDATE (samtidig completeReview)
		// → hopp over audit; en annen request har allerede skrevet completion.
		if (updated.length === 0) return { statusChanged: false, newStatus }

		await writeAuditLog(
			{
				action: "routine_review_completed",
				entityType: "routine_review",
				entityId: reviewId,
				newValue: newStatus,
				performedBy,
			},
			tx,
		)
		return { statusChanged: true, newStatus }
	})

	// Sync materialiserte compliance-kontroller — utenfor tx fordi det er
	// en stor batch-operasjon. Kjør kun hvis review faktisk ble `completed`
	// (ikke `needs_follow_up`); compliance-syncen skal trigges senere
	// av recomputeReviewStatus() når alle oppfølgingspunkter er adressert.
	if (result.statusChanged && result.newStatus === "completed") {
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

// ─── Review Follow-up Points ─────────────────────────────────────────────

/**
 * Legger til et oppfølgingspunkt på en gjennomgang. Tillatt for
 * gjennomganger med status `draft` eller `needs_follow_up` — i sistnevnte
 * tilfelle kan brukerne legge til nye punkter som oppdages under arbeidet
 * med oppfølgingen. Punkter legges som `needs_follow_up` som default. Hvis
 * man legger til på en allerede `completed` review settes statusen tilbake
 * til `needs_follow_up` (og motsatt: når alle punkter er adressert
 * triggers `recomputeReviewStatus` til `completed`).
 */
export async function addFollowUpPoint(params: {
	reviewId: string
	text: string
	description?: string | null
	performedBy: string
}) {
	const { reviewId, text, description, performedBy } = params
	const trimmed = text.trim()
	if (!trimmed) {
		throw new Response("Oppfølgingspunkt kan ikke være tomt", { status: 400 })
	}
	const trimmedDescription = description?.trim() || null

	const inserted = await db.transaction(async (tx) => {
		const [snapshot] = await tx
			.select({ archivedAt: routines.archivedAt, reviewStatus: routineReviews.status })
			.from(routineReviews)
			.innerJoin(routines, eq(routineReviews.routineId, routines.id))
			.where(eq(routineReviews.id, reviewId))
			.for("share", { of: [routines] })
			.limit(1)
		if (!snapshot) {
			throw new Response("Gjennomgang ikke funnet", { status: 404 })
		}
		if (snapshot.archivedAt) {
			throw new Response("Kan ikke legge til oppfølgingspunkt på en arkivert rutine. Reaktiver rutinen først.", {
				status: 403,
			})
		}
		if (snapshot.reviewStatus === "discarded") {
			throw new Response("Kan ikke legge til oppfølgingspunkt på en kassert gjennomgang.", { status: 409 })
		}

		const [row] = await tx
			.insert(routineReviewFollowUpPoints)
			.values({
				reviewId,
				text: trimmed,
				description: trimmedDescription,
				status: "needs_follow_up",
				createdBy: performedBy,
				updatedBy: performedBy,
			})
			.returning()

		// Hvis review allerede var completed (alle tidligere punkter løst),
		// flytt den tilbake til needs_follow_up siden vi nå har et åpent punkt.
		if (snapshot.reviewStatus === "completed") {
			await tx.update(routineReviews).set({ status: "needs_follow_up" }).where(eq(routineReviews.id, reviewId))
		}

		await writeAuditLog(
			{
				action: "review_follow_up_added",
				entityType: "review_follow_up_point",
				entityId: row.id,
				newValue: trimmed,
				metadata: { reviewId },
				performedBy,
			},
			tx,
		)

		return { row, prevReviewStatus: snapshot.reviewStatus }
	})

	// Hvis review gikk fra completed → needs_follow_up må compliance-status
	// re-synkroniseres (review teller ikke lenger som fullført).
	if (inserted.prevReviewStatus === "completed") {
		await syncComplianceForReview(reviewId, performedBy)
	}

	return inserted.row
}

/**
 * Oppdaterer teksten på et oppfølgingspunkt. Kun tillatt så lenge
 * gjennomgangen er i `draft` (etter completion er teksten låst for
 * å bevare historikk).
 */
export async function updateFollowUpPointText(params: {
	pointId: string
	expectedReviewId: string
	text: string
	performedBy: string
}) {
	const { pointId, expectedReviewId, text, performedBy } = params
	const trimmed = text.trim()
	if (!trimmed) {
		throw new Response("Oppfølgingspunkt kan ikke være tomt", { status: 400 })
	}

	return db.transaction(async (tx) => {
		const [existing] = await tx
			.select()
			.from(routineReviewFollowUpPoints)
			.where(eq(routineReviewFollowUpPoints.id, pointId))
			.limit(1)
		if (!existing || existing.reviewId !== expectedReviewId) {
			throw new Response("Oppfølgingspunkt ikke funnet", { status: 404 })
		}

		const [snapshot] = await tx
			.select({ archivedAt: routines.archivedAt, reviewStatus: routineReviews.status })
			.from(routineReviews)
			.innerJoin(routines, eq(routineReviews.routineId, routines.id))
			.where(eq(routineReviews.id, expectedReviewId))
			.for("share", { of: [routines] })
			.limit(1)
		if (!snapshot) {
			throw new Response("Gjennomgang ikke funnet", { status: 404 })
		}
		if (snapshot.archivedAt) {
			throw new Response("Kan ikke endre oppfølgingspunkt på en arkivert rutine.", { status: 403 })
		}
		if (snapshot.reviewStatus !== "draft") {
			throw new Response("Teksten på et oppfølgingspunkt kan kun endres mens gjennomgangen er utkast.", {
				status: 409,
			})
		}

		if (existing.text === trimmed) {
			return existing
		}

		const [updated] = await tx
			.update(routineReviewFollowUpPoints)
			.set({ text: trimmed, updatedBy: performedBy, updatedAt: new Date() })
			.where(eq(routineReviewFollowUpPoints.id, pointId))
			.returning()

		await writeAuditLog(
			{
				action: "review_follow_up_updated",
				entityType: "review_follow_up_point",
				entityId: pointId,
				previousValue: existing.text,
				newValue: trimmed,
				metadata: { reviewId: expectedReviewId },
				performedBy,
			},
			tx,
		)

		return updated
	})
}

/**
 * Oppdaterer beskrivelsen (utdypende tekst) på et oppfølgingspunkt.
 * Tillatt kun mens gjennomgangen er `draft` — så snart gjennomgangen er
 * fullført (også når den har status `needs_follow_up` med åpne punkter)
 * låses beskrivelsen for å bevare historikk. En tom verdi tolkes som
 * «ingen beskrivelse» (NULL).
 */
export async function updateFollowUpPointDescription(params: {
	pointId: string
	expectedReviewId: string
	description: string | null
	performedBy: string
}) {
	const { pointId, expectedReviewId, description, performedBy } = params
	const trimmed = description?.trim() || null

	return db.transaction(async (tx) => {
		const [existing] = await tx
			.select()
			.from(routineReviewFollowUpPoints)
			.where(eq(routineReviewFollowUpPoints.id, pointId))
			.limit(1)
		if (!existing || existing.reviewId !== expectedReviewId) {
			throw new Response("Oppfølgingspunkt ikke funnet", { status: 404 })
		}

		const [snapshot] = await tx
			.select({ archivedAt: routines.archivedAt, reviewStatus: routineReviews.status })
			.from(routineReviews)
			.innerJoin(routines, eq(routineReviews.routineId, routines.id))
			.where(eq(routineReviews.id, expectedReviewId))
			.for("share", { of: [routines] })
			.limit(1)
		if (!snapshot) {
			throw new Response("Gjennomgang ikke funnet", { status: 404 })
		}
		if (snapshot.archivedAt) {
			throw new Response("Kan ikke endre oppfølgingspunkt på en arkivert rutine.", { status: 403 })
		}
		if (snapshot.reviewStatus !== "draft") {
			throw new Response("Beskrivelse kan kun endres mens gjennomgangen er utkast.", {
				status: 409,
			})
		}

		const [updated] = await tx
			.update(routineReviewFollowUpPoints)
			.set({ description: trimmed, updatedBy: performedBy, updatedAt: new Date() })
			.where(eq(routineReviewFollowUpPoints.id, pointId))
			.returning()

		await writeAuditLog(
			{
				action: "review_follow_up_description_updated",
				entityType: "review_follow_up_point",
				entityId: pointId,
				previousValue: existing.description,
				newValue: trimmed,
				metadata: { reviewId: expectedReviewId },
				performedBy,
			},
			tx,
		)

		return updated
	})
}

/**
 * Oppdaterer status på et oppfølgingspunkt og re-evaluerer review-status:
 * Hvis review er `needs_follow_up` og alle punkter nå er adressert
 * (`completed`/`not_relevant`) flyttes review til `completed` og
 * compliance-status synkroniseres.
 */
export async function updateFollowUpPointStatus(params: {
	pointId: string
	expectedReviewId: string
	status: FollowUpPointStatus
	resolution?: string | null
	performedBy: string
}) {
	const { pointId, expectedReviewId, status, resolution, performedBy } = params
	if (!FOLLOW_UP_POINT_STATUSES.includes(status)) {
		throw new Response("Ugyldig status", { status: 400 })
	}
	const resolutionProvided = resolution !== undefined
	const trimmedResolution = resolutionProvided ? resolution?.trim() || null : undefined

	const result = await db.transaction(async (tx) => {
		const [existing] = await tx
			.select()
			.from(routineReviewFollowUpPoints)
			.where(eq(routineReviewFollowUpPoints.id, pointId))
			.limit(1)
		if (!existing || existing.reviewId !== expectedReviewId) {
			throw new Response("Oppfølgingspunkt ikke funnet", { status: 404 })
		}

		const [snapshot] = await tx
			.select({ archivedAt: routines.archivedAt, reviewStatus: routineReviews.status })
			.from(routineReviews)
			.innerJoin(routines, eq(routineReviews.routineId, routines.id))
			.where(eq(routineReviews.id, expectedReviewId))
			.for("share", { of: [routines] })
			.limit(1)
		if (!snapshot) {
			throw new Response("Gjennomgang ikke funnet", { status: 404 })
		}
		if (snapshot.archivedAt) {
			throw new Response("Kan ikke endre oppfølgingspunkt på en arkivert rutine.", { status: 403 })
		}
		if (snapshot.reviewStatus === "discarded") {
			throw new Response("Kan ikke endre oppfølgingspunkt på en kassert gjennomgang.", { status: 409 })
		}

		const statusChanged = existing.status !== status
		const resolutionChanged = resolutionProvided && (existing.resolution ?? null) !== (trimmedResolution ?? null)

		if (!statusChanged && !resolutionChanged) {
			return { previousReviewStatus: snapshot.reviewStatus, newReviewStatus: snapshot.reviewStatus }
		}

		const isResolving = status !== "needs_follow_up"
		const setValues: {
			status: FollowUpPointStatus
			updatedBy: string
			updatedAt: Date
			resolvedAt?: Date | null
			resolvedBy?: string | null
			resolution?: string | null
		} = {
			status,
			updatedBy: performedBy,
			updatedAt: new Date(),
		}
		if (statusChanged) {
			setValues.resolvedAt = isResolving ? new Date() : null
			setValues.resolvedBy = isResolving ? performedBy : null
		}
		if (resolutionProvided) {
			setValues.resolution = trimmedResolution ?? null
		}

		await tx.update(routineReviewFollowUpPoints).set(setValues).where(eq(routineReviewFollowUpPoints.id, pointId))

		if (statusChanged) {
			await writeAuditLog(
				{
					action: "review_follow_up_status_changed",
					entityType: "review_follow_up_point",
					entityId: pointId,
					previousValue: existing.status,
					newValue: status,
					metadata: {
						reviewId: expectedReviewId,
						...(resolutionProvided ? { resolution: trimmedResolution } : {}),
					},
					performedBy,
				},
				tx,
			)
		}
		if (resolutionChanged) {
			await writeAuditLog(
				{
					action: "review_follow_up_resolution_updated",
					entityType: "review_follow_up_point",
					entityId: pointId,
					previousValue: existing.resolution,
					newValue: trimmedResolution ?? null,
					metadata: { reviewId: expectedReviewId },
					performedBy,
				},
				tx,
			)
		}

		// Recompute review-status hvis review er i et oppfølgingsfølsomt
		// stadium (needs_follow_up eller completed). Draft skal forbli draft.
		let newReviewStatus = snapshot.reviewStatus
		if (snapshot.reviewStatus === "needs_follow_up" || snapshot.reviewStatus === "completed") {
			const unresolved = await tx
				.select({ id: routineReviewFollowUpPoints.id })
				.from(routineReviewFollowUpPoints)
				.where(
					and(
						eq(routineReviewFollowUpPoints.reviewId, expectedReviewId),
						eq(routineReviewFollowUpPoints.status, "needs_follow_up"),
					),
				)
				.limit(1)
			const target: "completed" | "needs_follow_up" = unresolved.length > 0 ? "needs_follow_up" : "completed"
			if (target !== snapshot.reviewStatus) {
				await tx.update(routineReviews).set({ status: target }).where(eq(routineReviews.id, expectedReviewId))
				newReviewStatus = target
			}
		}

		return { previousReviewStatus: snapshot.reviewStatus, newReviewStatus }
	})

	if (result.previousReviewStatus !== result.newReviewStatus) {
		await syncComplianceForReview(expectedReviewId, performedBy)
	}
}

/**
 * Sletter et oppfølgingspunkt. Kun tillatt mens gjennomgangen er i `draft`.
 * Etter completion bevares punkter for historikkens skyld.
 */
export async function deleteFollowUpPoint(params: { pointId: string; expectedReviewId: string; performedBy: string }) {
	const { pointId, expectedReviewId, performedBy } = params

	return db.transaction(async (tx) => {
		const [existing] = await tx
			.select()
			.from(routineReviewFollowUpPoints)
			.where(eq(routineReviewFollowUpPoints.id, pointId))
			.limit(1)
		if (!existing || existing.reviewId !== expectedReviewId) {
			throw new Response("Oppfølgingspunkt ikke funnet", { status: 404 })
		}

		const [snapshot] = await tx
			.select({ archivedAt: routines.archivedAt, reviewStatus: routineReviews.status })
			.from(routineReviews)
			.innerJoin(routines, eq(routineReviews.routineId, routines.id))
			.where(eq(routineReviews.id, expectedReviewId))
			.for("share", { of: [routines] })
			.limit(1)
		if (!snapshot) {
			throw new Response("Gjennomgang ikke funnet", { status: 404 })
		}
		if (snapshot.archivedAt) {
			throw new Response("Kan ikke slette oppfølgingspunkt på en arkivert rutine.", { status: 403 })
		}
		if (snapshot.reviewStatus !== "draft") {
			throw new Response("Oppfølgingspunkt kan kun slettes mens gjennomgangen er utkast.", { status: 409 })
		}

		await tx.delete(routineReviewFollowUpPoints).where(eq(routineReviewFollowUpPoints.id, pointId))

		await writeAuditLog(
			{
				action: "review_follow_up_deleted",
				entityType: "review_follow_up_point",
				entityId: pointId,
				previousValue: existing.text,
				metadata: { reviewId: expectedReviewId, status: existing.status },
				performedBy,
			},
			tx,
		)

		return existing
	})
}

/** Synkroniser compliance-kontroller etter at en gjennomgang har fått ny status. */
async function syncComplianceForReview(reviewId: string, performedBy: string) {
	const review = await getReview(reviewId)
	if (!review) return
	if (review.applicationId) {
		const { syncApplicationControls } = await import("./application-controls.server")
		await syncApplicationControls(review.applicationId, performedBy)
	} else {
		const routine = await getRoutine(review.routineId)
		if (routine?.isSectionRoutine === 1 && routine.sectionId) {
			const { triggerSyncForSection } = await import("./application-controls.server")
			triggerSyncForSection(routine.sectionId, performedBy)
		}
	}
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

/**
 * Henter et oppfølgingspunkt-vedlegg med arkivert-status for foreldre-rutinen
 * og status for gjennomgangen. Brukes som soft-delete-/access-guard ved
 * opplasting av nye vedlegg.
 */
export async function getFollowUpPointAttachmentContext(pointId: string): Promise<{
	pointId: string
	reviewId: string
	routineId: string
	reviewStatus: ReviewStatus
	routineArchivedAt: Date | null
} | null> {
	const [row] = await db
		.select({
			pointId: routineReviewFollowUpPoints.id,
			reviewId: routineReviewFollowUpPoints.reviewId,
			routineId: routines.id,
			reviewStatus: routineReviews.status,
			routineArchivedAt: routines.archivedAt,
		})
		.from(routineReviewFollowUpPoints)
		.innerJoin(routineReviews, eq(routineReviewFollowUpPoints.reviewId, routineReviews.id))
		.innerJoin(routines, eq(routineReviews.routineId, routines.id))
		.where(eq(routineReviewFollowUpPoints.id, pointId))
		.limit(1)
	return row ?? null
}

export async function addFollowUpPointAttachment(params: {
	pointId: string
	kind: FollowUpPointAttachmentKind
	fileName: string
	bucketPath: string
	contentType: string
	sizeBytes: number | null
	uploadedBy: string
}) {
	const [attachment] = await db
		.insert(routineReviewFollowUpPointAttachments)
		.values({
			pointId: params.pointId,
			kind: params.kind,
			fileName: params.fileName,
			bucketPath: params.bucketPath,
			contentType: params.contentType,
			sizeBytes: params.sizeBytes,
			uploadedBy: params.uploadedBy,
		})
		.returning()

	await writeAuditLog({
		action: "review_follow_up_attachment_uploaded",
		entityType: "routine_review_follow_up_point_attachment",
		entityId: attachment.id,
		newValue: params.fileName,
		metadata: { pointId: params.pointId, kind: params.kind, contentType: params.contentType },
		performedBy: params.uploadedBy,
	})

	return attachment
}

// ─── Eligibility — which apps need a routine? ────────────────────────────

/**
 * Filters a list of candidate app IDs against a routine's optional constraints.
 * Applied as AND-logic: each non-empty constraint type must be satisfied independently.
 * If a routine has no constraints of a given type, that type is skipped (no-op).
 *
 * Reuses the same reverse-lookup helpers as the non-section routine paths so that
 * section routines and regular routines behave consistently.
 */
async function applyRoutineConstraintFilters(
	candidateIds: string[],
	constraints: {
		technologyElements: Array<{ id: string }>
		persistenceLinks: Array<{ persistenceType: PersistenceType | null; dataClassification: DataClassification | null }>
		oracleRoleCriticalities: Array<{ criticality: GroupCriticality | null }>
	},
): Promise<string[]> {
	let filtered = candidateIds

	// Technology elements: app must have ≥1 confirmed, non-rejected element from the routine's list
	if (constraints.technologyElements.length > 0) {
		const elementIds = constraints.technologyElements.map((e) => e.id)
		const rows = await db
			.selectDistinct({ applicationId: applicationTechnologyElements.applicationId })
			.from(applicationTechnologyElements)
			.where(
				and(
					inArray(applicationTechnologyElements.applicationId, filtered),
					inArray(applicationTechnologyElements.elementId, elementIds),
					isNull(applicationTechnologyElements.archivedAt),
					or(eq(applicationTechnologyElements.source, "auto"), isNotNull(applicationTechnologyElements.confirmedAt)),
					isNull(applicationTechnologyElements.rejectedAt),
				),
			)
		const passing = new Set(rows.map((r) => r.applicationId))
		filtered = filtered.filter((id) => passing.has(id))
		if (filtered.length === 0) return []
	}

	// Persistence: app must match ≥1 of the routine's persistence links, scoped to candidates
	if (constraints.persistenceLinks.length > 0) {
		const persAppIds = await findAppsByPersistenceMatch(constraints.persistenceLinks, filtered)
		const passing = new Set(persAppIds)
		filtered = filtered.filter((id) => passing.has(id))
		if (filtered.length === 0) return []
	}

	// Oracle role criticality: app must have a matching Oracle role assessment, scoped to candidates
	if (constraints.oracleRoleCriticalities.length > 0) {
		const orcAppIds = await findAppsByOracleRoleCriticalityMatch(constraints.oracleRoleCriticalities, filtered)
		const passing = new Set(orcAppIds)
		filtered = filtered.filter((id) => passing.has(id))
	}

	return filtered
}

type RoutineData = NonNullable<Awaited<ReturnType<typeof getRoutine>>>

export async function getAppsRequiringRoutine(
	routineId: string,
	opts?: {
		sectionAppIdsCache?: Map<string, string[]>
		routineData?: RoutineData
	},
) {
	const routine = opts?.routineData ?? (await getRoutine(routineId))
	if (!routine) return []
	if (opts?.routineData && opts.routineData.id !== routineId) {
		throw new Error(`routineData.id (${opts.routineData.id}) does not match routineId (${routineId})`)
	}

	// Section routines: start with all apps in the section, then apply constraints
	if (routine.isSectionRoutine === 1 && routine.sectionId) {
		const cache = opts?.sectionAppIdsCache
		let appIds: string[]
		if (cache?.has(routine.sectionId)) {
			appIds = cache.get(routine.sectionId) ?? []
		} else {
			appIds = await getAppIdsInSection(routine.sectionId)
			cache?.set(routine.sectionId, appIds)
		}
		if (appIds.length === 0) return []

		const filteredIds = await applyRoutineConstraintFilters(appIds, {
			technologyElements: routine.technologyElements,
			persistenceLinks: routine.persistenceLinks,
			oracleRoleCriticalities: routine.oracleRoleCriticalities,
		})
		if (filteredIds.length === 0) return []

		return db
			.select()
			.from(monitoredApplications)
			.where(and(inArray(monitoredApplications.id, filteredIds), isNull(monitoredApplications.archivedAt)))
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
			sectionAppIds = cache.get(routine.sectionId) ?? []
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

	// Apply tech element constraint filter (the only AND-filter for non-section routines;
	// persistence and oracle criticality are OR-inclusion paths above, not AND-filters here)
	const filteredIds = await applyRoutineConstraintFilters([...allMatchedAppIds], {
		technologyElements: routine.technologyElements,
		persistenceLinks: [],
		oracleRoleCriticalities: [],
	})

	if (filteredIds.length === 0) return []

	return db
		.select()
		.from(monitoredApplications)
		.where(and(inArray(monitoredApplications.id, filteredIds), isNull(monitoredApplications.archivedAt)))
		.orderBy(monitoredApplications.name)
}

/** Reverse lookup: find apps that have persistence matching the routine's persistence links.
 * Mirrors forward logic: type and classification are matched independently across
 * all of an app's persistence entries (cross-product), not within a single row.
 * If `candidateIds` is provided, the query is scoped to those apps only. */
async function findAppsByPersistenceMatch(
	persistenceLinks: Array<{ persistenceType: PersistenceType | null; dataClassification: DataClassification | null }>,
	candidateIds?: string[],
): Promise<string[]> {
	// If caller scoped to a candidate set that is empty, there can be no matches
	if (candidateIds !== undefined && candidateIds.length === 0) return []
	// Collect all required types and classifications from the routine's links
	const requiredTypes = [
		...new Set(persistenceLinks.map((l) => l.persistenceType).filter(Boolean)),
	] as PersistenceType[]
	const requiredClassifications = [
		...new Set(persistenceLinks.map((l) => l.dataClassification).filter(Boolean)),
	] as DataClassification[]

	// Pre-filter persistence entries by relevant types/classifications
	const filters = [isNull(applicationPersistence.archivedAt)]
	if (candidateIds && candidateIds.length > 0) {
		filters.push(inArray(applicationPersistence.applicationId, candidateIds))
	}
	if (requiredTypes.length > 0 && requiredClassifications.length > 0) {
		const combined = or(
			inArray(applicationPersistence.type, requiredTypes),
			inArray(applicationPersistence.dataClassification, requiredClassifications),
		)
		if (combined) filters.push(combined)
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

	// For each app, check if any routine link matches using cross-product logic.
	// Links with both fields null are skipped (no constraint → matches nothing),
	// consistent with getRoutineDeadlinesForAppBySection forward logic.
	const effectiveLinks = persistenceLinks.filter((l) => l.persistenceType !== null || l.dataClassification !== null)
	if (effectiveLinks.length === 0) return []

	const matchedApps = new Set<string>()
	for (const [appId, sets] of appSets) {
		for (const link of effectiveLinks) {
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

/** Reverse lookup: find apps with Oracle roles matching the routine's criticality links.
 * If `candidateIds` is provided, the query is scoped to those apps only. */
async function findAppsByOracleRoleCriticalityMatch(
	oracleRoleCriticalities: Array<{ criticality: GroupCriticality | null }>,
	candidateIds?: string[],
): Promise<string[]> {
	// If caller scoped to a candidate set that is empty, there can be no matches
	if (candidateIds !== undefined && candidateIds.length === 0) return []
	const criticalities = oracleRoleCriticalities
		.map((orc) => orc.criticality)
		.filter((c): c is GroupCriticality => c !== null)
	if (criticalities.length === 0) return []

	const filters = [inArray(oracleRoleAssessments.criticality, criticalities)]
	if (candidateIds && candidateIds.length > 0) {
		filters.push(inArray(oracleRoleAssessments.applicationId, candidateIds))
	}

	const matchingAssessments = await db
		.select({ applicationId: oracleRoleAssessments.applicationId })
		.from(oracleRoleAssessments)
		.where(and(...filters))

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
 * Henter den effektive siste gjennomgangsdatoen for fristberegning.
 *
 * Når en rutine erstatter en eksisterende rutine (har `sourceRoutineId`), bestemmer
 * `deadlinePolicy` om fristen skal fortsette fra den gamle rutinens gjennomganger
 * eller starte på nytt:
 *
 * - **`deadlinePolicy: "continue"`**: Den nye rutinens egne gjennomganger brukes alltid
 *   hvis de finnes. Kun når den nye rutinen ennå ikke har noen gjennomgang, arves siste
 *   gjennomgang fra den erstattede rutinen som startpunkt for fristberegningen.
 *   Fristen beregnes som: `(nyeste review på ny ELLER gammel rutine) + (nye rutinens frekvens)`.
 *
 * - **`deadlinePolicy: "reset"`** eller ingen policy: Returnerer den NYE rutinens egen siste
 *   gjennomgang (typisk null ved godkjenning). Brukes når rutinen krever nye gjennomganger.
 *   Fristen beregnes som: `(nye rutinens godkjenningsdato) + (nye rutinens frekvens)`.
 *
 * **Viktig**: Frekvensen kommer ALLTID fra den nye rutinen, ikke den gamle. Kun base-datoen
 * for fristberegningen påvirkes av `deadlinePolicy`. Og egne reviews på ny rutine har alltid
 * prioritet over arvede reviews fra kilderutinen.
 *
 * **Performance**: For å unngå N+1 queries, bruk `getEffectiveLastReviewDatesBatch()` når
 * du trenger review-datoer for flere rutiner samtidig.
 *
 * @param routineId - IDen til rutinen det skal beregnes frist for (typisk den NYE rutinen)
 * @param applicationId - App-ID for app-spesifikke rutiner, `null` for seksjonsrutiner
 * @returns Siste gjennomgangsdato å bruke som base i fristberegning, eller `null` hvis ingen finnes
 *
 * @example
 * // Rutine med "continue"-policy, ingen egne reviews ennå:
 * const lastReview = await getEffectiveLastReviewDate(newRoutineId, appId)
 * // → Returnerer gammel rutines siste gjennomgang (f.eks. 2025-01-15) som startpunkt
 * const deadline = calculateDeadline(lastReview, newRoutine.approvedAt ?? newRoutine.createdAt, newRoutine.frequency)
 * // → Frist = 2025-01-15 + nye rutinens frekvens
 *
 * @example
 * // Samme rutine etter at den nye rutinen selv er gjennomgått:
 * const lastReview = await getEffectiveLastReviewDate(newRoutineId, appId)
 * // → Returnerer NY rutines siste gjennomgang (egne reviews har alltid prioritet)
 *
 * @example
 * // Rutine med "reset"-policy eller ingen erstatning:
 * const lastReview = await getEffectiveLastReviewDate(routineId, appId)
 * // → Returnerer null (ingen gjennomganger ennå)
 * const deadline = calculateDeadline(lastReview, routine.approvedAt ?? routine.createdAt, routine.frequency)
 * // → Frist = routine.approvedAt (godkjenningsdato) + frekvens
 */
const MAX_REPLACEMENT_CHAIN_DEPTH = 10

export async function getEffectiveLastReviewDate(
	routineId: string,
	applicationId: string | null,
): Promise<Date | null> {
	const routine = await db
		.select({ id: routines.id, sourceRoutineId: routines.sourceRoutineId })
		.from(routines)
		.where(eq(routines.id, routineId))
		.limit(1)
		.then((rows) => rows[0])

	if (!routine) return null

	// Fast path: no replacement chain → return own review directly without full batch machinery
	if (!routine.sourceRoutineId) {
		if (applicationId !== null) {
			const review = await getLatestReviewForApp(routineId, applicationId)
			return review?.reviewedAt ?? null
		}
		const review = await getLatestSectionReview(routineId)
		return review?.reviewedAt ?? null
	}

	const results = await getEffectiveLastReviewDatesBatch([routine], applicationId)
	return results.get(routineId) ?? null
}

/**
 * Batch-variant av `getEffectiveLastReviewDate()` som henter review-datoer
 * for flere rutiner samtidig med minimalt antall database-queries.
 *
 * Unngår N+1 query-problem ved å batch-hente:
 * 1. Alle sourceRoutineId-er i én query
 * 2. Alle relevante audit_log-entries i én query
 * 3. Alle reviews (både for current og source routines) i én query
 *
 * @param routineRows - Rutiner med `id` og `sourceRoutineId`-felter
 * @param applicationId - App-ID for app-spesifikke rutiner, `null` for seksjonsrutiner
 * @returns Map fra routineId til siste gjennomgangsdato (eller null)
 *
 * @example
 * const reviewDateMap = await getEffectiveLastReviewDatesBatch(routineRows, appId)
 * for (const routine of routineRows) {
 *   const lastReviewDate = reviewDateMap.get(routine.id) ?? null
 *   const deadline = calculateDeadline(lastReviewDate, routine.approvedAt ?? routine.createdAt, routine.frequency)
 * }
 */
export async function getEffectiveLastReviewDatesBatch(
	routineRows: Array<{ id: string; sourceRoutineId: string | null }>,
	applicationId: string | null,
): Promise<Map<string, Date | null>> {
	const result = new Map<string, Date | null>()

	if (routineRows.length === 0) {
		return result
	}

	const currentRoutineIds = routineRows.map((r) => r.id)

	// Build initial source map from input
	const sourceMap = new Map<string, string>()
	for (const routine of routineRows) {
		if (routine.sourceRoutineId) {
			sourceMap.set(routine.id, routine.sourceRoutineId)
		}
	}

	// Fast path: no replacement chains → fetch own reviews directly, skip audit_log + BFS
	if (sourceMap.size === 0) {
		const ids = currentRoutineIds
		if (applicationId) {
			const reviews = await db
				.selectDistinctOn([routineReviews.routineId], {
					routineId: routineReviews.routineId,
					reviewedAt: routineReviews.reviewedAt,
				})
				.from(routineReviews)
				.where(
					and(
						inArray(routineReviews.routineId, ids),
						eq(routineReviews.applicationId, applicationId),
						eq(routineReviews.status, "completed"),
					),
				)
				.orderBy(routineReviews.routineId, desc(routineReviews.reviewedAt))
			for (const r of reviews) result.set(r.routineId, r.reviewedAt)
		} else {
			const reviews = await db
				.selectDistinctOn([routineReviews.routineId], {
					routineId: routineReviews.routineId,
					reviewedAt: routineReviews.reviewedAt,
				})
				.from(routineReviews)
				.where(
					and(
						inArray(routineReviews.routineId, ids),
						isNull(routineReviews.applicationId),
						eq(routineReviews.status, "completed"),
					),
				)
				.orderBy(routineReviews.routineId, desc(routineReviews.reviewedAt))
			for (const r of reviews) result.set(r.routineId, r.reviewedAt)
		}
		for (const id of ids) {
			if (!result.has(id)) result.set(id, null)
		}
		return result
	}

	// Collect all routine IDs we need to fetch (current + transitive sources)
	const allRoutineIds = new Set<string>(currentRoutineIds)
	const toProcess = [...currentRoutineIds]
	const maxChainDepth = MAX_REPLACEMENT_CHAIN_DEPTH

	// Fetch all source routines transitively (BFS traversal)
	for (let chainDepth = 0; chainDepth < maxChainDepth; chainDepth++) {
		// Collect all sourceIds from current level
		const sourceIdsAtThisLevel = new Set<string>()
		for (const id of toProcess) {
			const sourceId = sourceMap.get(id)
			if (sourceId && !allRoutineIds.has(sourceId)) {
				sourceIdsAtThisLevel.add(sourceId)
			}
		}

		if (sourceIdsAtThisLevel.size === 0) break

		// Clear toProcess for next level
		toProcess.length = 0

		// Fetch all sources at this level in batches of 100
		const sourceIdsArray = [...sourceIdsAtThisLevel]
		for (let i = 0; i < sourceIdsArray.length; i += 100) {
			const batch = sourceIdsArray.slice(i, i + 100)
			const sourceRoutines = await db
				.select({ id: routines.id, sourceRoutineId: routines.sourceRoutineId })
				.from(routines)
				.where(inArray(routines.id, batch))

			for (const r of sourceRoutines) {
				allRoutineIds.add(r.id)
				if (r.sourceRoutineId) {
					sourceMap.set(r.id, r.sourceRoutineId)
					toProcess.push(r.id) // Queue for next level
				}
			}
		}
	}

	// 1. Batch-fetch audit log entries for all routines (only most recent per routine)
	const policyMap = new Map<string, "continue" | "reset">()
	if (allRoutineIds.size > 0) {
		const auditEntries = await db
			.selectDistinctOn([auditLog.entityId], {
				routineId: auditLog.entityId,
				metadata: auditLog.metadata,
			})
			.from(auditLog)
			.where(
				and(
					eq(auditLog.action, "routine_replaced"),
					eq(auditLog.entityType, "routine"),
					inArray(auditLog.entityId, [...allRoutineIds]),
				),
			)
			.orderBy(auditLog.entityId, desc(auditLog.performedAt))

		for (const entry of auditEntries) {
			// audit_log.metadata is stored as JSON string - parse it
			let policy: "continue" | "reset" | undefined
			if (entry.metadata) {
				try {
					const parsed = JSON.parse(entry.metadata)
					const raw = parsed?.deadlinePolicy
					if (raw === "continue" || raw === "reset") {
						policy = raw
					}
				} catch {
					// Invalid JSON - treat as missing policy
				}
			}
			if (policy) {
				policyMap.set(entry.routineId, policy)
			}
		}
	}

	// 2. Batch-fetch reviews for all routines (current + all sources)
	let reviewMap: Map<string, Date>
	if (applicationId) {
		// App-specific routines
		const reviews = await db
			.selectDistinctOn([routineReviews.routineId], {
				routineId: routineReviews.routineId,
				reviewedAt: routineReviews.reviewedAt,
			})
			.from(routineReviews)
			.where(
				and(
					inArray(routineReviews.routineId, [...allRoutineIds]),
					eq(routineReviews.applicationId, applicationId),
					eq(routineReviews.status, "completed"),
				),
			)
			.orderBy(routineReviews.routineId, desc(routineReviews.reviewedAt))

		reviewMap = new Map(reviews.map((r) => [r.routineId, r.reviewedAt]))
	} else {
		// Section routines
		const reviews = await db
			.selectDistinctOn([routineReviews.routineId], {
				routineId: routineReviews.routineId,
				reviewedAt: routineReviews.reviewedAt,
			})
			.from(routineReviews)
			.where(
				and(
					inArray(routineReviews.routineId, [...allRoutineIds]),
					isNull(routineReviews.applicationId),
					eq(routineReviews.status, "completed"),
				),
			)
			.orderBy(routineReviews.routineId, desc(routineReviews.reviewedAt))

		reviewMap = new Map(reviews.map((r) => [r.routineId, r.reviewedAt]))
	}

	// 3. Build result map by applying deadlinePolicy logic
	// For "continue" policy, walk the replacement chain transitively until we find
	// a routine with reviews or reach the end of the chain
	for (const routine of routineRows) {
		const sourceRoutineId = sourceMap.get(routine.id)

		if (!sourceRoutineId) {
			// No replacement → use routine's own review
			result.set(routine.id, reviewMap.get(routine.id) ?? null)
			continue
		}

		const policy = policyMap.get(routine.id)

		if (policy === "continue") {
			// If the routine itself already has a review, use it directly —
			// "continue" only applies as a fallback base date when the new routine has no reviews yet
			if (reviewMap.has(routine.id)) {
				result.set(routine.id, reviewMap.get(routine.id) ?? null)
				continue
			}

			// No own review → walk the replacement chain to inherit from source
			let effectiveSourceId = sourceRoutineId
			let chainDepth = 0

			while (chainDepth < maxChainDepth) {
				// If this routine has reviews, use it
				if (reviewMap.has(effectiveSourceId)) {
					break
				}

				// Otherwise, check if this routine itself is a replacement
				const nextSource = sourceMap.get(effectiveSourceId)
				if (!nextSource) {
					// End of chain, no more sources
					break
				}

				// Check if the next source also has "continue" policy
				const nextPolicy = policyMap.get(effectiveSourceId)
				if (nextPolicy !== "continue") {
					// Chain broken by "reset" policy
					break
				}

				effectiveSourceId = nextSource
				chainDepth++
			}

			result.set(routine.id, reviewMap.get(effectiveSourceId) ?? null)
		} else {
			// Reset or missing policy → use current routine's review
			result.set(routine.id, reviewMap.get(routine.id) ?? null)
		}
	}

	return result
}

/**
 * Returns the latest review (any non-discarded status) for a given
 * routine + application. Used for UI labels like «Må følges opp» that
 * reflect the actual most recent gjennomgang regardless of completion
 * state. Deadline / compliance calculations should keep using
 * `getLatestReviewForApp` which is filtered to `completed`.
 */
export async function getLatestNonDiscardedReviewForApp(routineId: string, applicationId: string) {
	const [review] = await db
		.select()
		.from(routineReviews)
		.where(
			and(
				eq(routineReviews.routineId, routineId),
				eq(routineReviews.applicationId, applicationId),
				ne(routineReviews.status, "discarded"),
			),
		)
		.orderBy(desc(routineReviews.reviewedAt))
		.limit(1)

	return review ?? null
}

/** Section-level (applicationId IS NULL) variant of `getLatestNonDiscardedReviewForApp`. */
export async function getLatestNonDiscardedSectionReview(routineId: string) {
	const [review] = await db
		.select()
		.from(routineReviews)
		.where(
			and(
				eq(routineReviews.routineId, routineId),
				isNull(routineReviews.applicationId),
				ne(routineReviews.status, "discarded"),
			),
		)
		.orderBy(desc(routineReviews.reviewedAt))
		.limit(1)

	return review ?? null
}

/**
 * Returnerer settet av applicationId-er (eller `null` for seksjonsnivå) som har minst
 * én gjennomgang med status `needs_follow_up` for gitt rutine. Brukes til å vise
 * «Må følges opp»-badge på rutinestatus så lenge det finnes uadresserte punkter,
 * uavhengig av om siste gjennomgang er fullført.
 */
export async function getRoutineFollowUpApplicationIds(routineId: string): Promise<Set<string | null>> {
	const rows = await db
		.selectDistinct({ applicationId: routineReviews.applicationId })
		.from(routineReviews)
		.where(and(eq(routineReviews.routineId, routineId), eq(routineReviews.status, "needs_follow_up")))
	return new Set(rows.map((r) => r.applicationId))
}

/**
 * Beregner neste frist for en rutine basert på frekvens.
 *
 * **Viktig**: For rutiner som erstatter eksisterende rutiner (med `sourceRoutineId`),
 * skal `lastReviewDate` hentes via `getEffectiveLastReviewDate()` for å respektere
 * `deadlinePolicy` ("continue" vs "reset"). Ikke bruk `getLatestReviewForApp()` direkte
 * for slike rutiner.
 *
 * Fristberegning:
 * - Base-dato: `lastReviewDate` hvis tilgjengelig, ellers `routineApprovedAt` (godkjenningsdato)
 * - Frist: base-dato + antall dager basert på `frequency`
 *
 * For "reset"-policy (eller helt nye rutiner uten gjennomganger) starter fristen fra
 * godkjenningsdatoen (`approvedAt`), ikke opprettelsesdatoen (`createdAt`). Dette sikrer
 * at fristen ikke backdateres til perioden mellom oppretting og godkjenning.
 *
 * @param lastReviewDate - Siste gjennomgangsdato (hent via `getEffectiveLastReviewDate()`)
 * @param routineApprovedAt - Rutinens godkjenningsdato (fallback hvis ingen gjennomganger; bruk `routine.approvedAt ?? routine.createdAt`)
 * @param frequency - Rutinens frekvens (f.eks. "quarterly", "annually")
 * @returns Frist-dato, eller `null` for hendelsesbaserte rutiner (ingen periodisk frekvens)
 *
 * @example
 * // For rutiner som kan ha blitt erstattet:
 * const lastReview = await getEffectiveLastReviewDate(routineId, appId)
 * const deadline = calculateDeadline(lastReview, routine.approvedAt ?? routine.createdAt, routine.frequency)
 *
 * @example
 * // For helt nye rutiner (ingen sourceRoutineId):
 * const lastReview = await getLatestReviewForApp(routineId, appId)
 * const deadline = calculateDeadline(lastReview?.reviewedAt ?? null, routine.approvedAt ?? routine.createdAt, routine.frequency)
 */
export function calculateDeadline(
	lastReviewDate: Date | null,
	routineApprovedAt: Date,
	frequency: RoutineFrequency | null,
): Date | null {
	if (!frequency) return null
	const base = lastReviewDate ?? routineApprovedAt
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
	matchedPersistenceLinks?: Array<{
		persistenceType: PersistenceType | null
		dataClassification: DataClassification | null
	}>
	matchedTechElements?: Array<{ id: string; name: string }>
	matchedOracleCriticalities?: Array<{ criticality: GroupCriticality }>
}

export async function getRoutineDeadlinesForSection(sectionId: string): Promise<RoutineDeadlineInfo[]> {
	const sectionRoutines = await db
		.select()
		.from(routines)
		.where(and(eq(routines.sectionId, sectionId), and(eq(routines.status, "approved"), isNull(routines.archivedAt))))

	if (sectionRoutines.length === 0) return []

	const results: RoutineDeadlineInfo[] = []
	const sectionAppIdsCache = new Map<string, string[]>()
	const routineIds = sectionRoutines.map((r) => r.id)

	// Batch-fetch all routine-related data (technology elements, screening, persistence, controls, etc.)
	const [allElements, allScreeningLinks, allPersLinks, allControlRows, allGcLinks, allOrcLinks] = await Promise.all([
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
			.from(routineScreeningQuestions)
			.where(
				and(inArray(routineScreeningQuestions.routineId, routineIds), isNull(routineScreeningQuestions.archivedAt)),
			),
		db
			.select()
			.from(routinePersistenceLinks)
			.where(and(inArray(routinePersistenceLinks.routineId, routineIds), isNull(routinePersistenceLinks.archivedAt))),
		db
			.selectDistinct({
				routineId: routineControls.routineId,
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
			.where(and(inArray(routineControls.routineId, routineIds), isNull(routineControls.archivedAt))),
		db
			.select()
			.from(routineGroupClassificationLinks)
			.where(
				and(
					inArray(routineGroupClassificationLinks.routineId, routineIds),
					isNull(routineGroupClassificationLinks.archivedAt),
				),
			),
		db
			.select()
			.from(routineOracleRoleCriticalityLinks)
			.where(
				and(
					inArray(routineOracleRoleCriticalityLinks.routineId, routineIds),
					isNull(routineOracleRoleCriticalityLinks.archivedAt),
				),
			),
	])

	// Group by routineId
	const elementsByRoutine = new Map<string, typeof allElements>()
	for (const elem of allElements) {
		const list = elementsByRoutine.get(elem.routineId) ?? []
		list.push(elem)
		elementsByRoutine.set(elem.routineId, list)
	}

	const screeningByRoutine = new Map<string, typeof allScreeningLinks>()
	for (const link of allScreeningLinks) {
		const list = screeningByRoutine.get(link.routineId) ?? []
		list.push(link)
		screeningByRoutine.set(link.routineId, list)
	}

	const persByRoutine = new Map<string, typeof allPersLinks>()
	for (const link of allPersLinks) {
		const list = persByRoutine.get(link.routineId) ?? []
		list.push(link)
		persByRoutine.set(link.routineId, list)
	}

	const controlsByRoutine = new Map<
		string,
		Array<{ id: string; controlId: string; name: string; responsible: string | null; domainSlug: string }>
	>()
	for (const ctrl of allControlRows) {
		const list = controlsByRoutine.get(ctrl.routineId) ?? []
		list.push({
			id: ctrl.id,
			controlId: ctrl.controlId,
			name: ctrl.shortTitle ?? ctrl.controlId,
			responsible: ctrl.responsible,
			domainSlug: ctrl.domainSlug,
		})
		controlsByRoutine.set(ctrl.routineId, list)
	}

	const gcLinksByRoutine = new Map<string, typeof allGcLinks>()
	for (const link of allGcLinks) {
		const list = gcLinksByRoutine.get(link.routineId) ?? []
		list.push(link)
		gcLinksByRoutine.set(link.routineId, list)
	}

	const orcLinksByRoutine = new Map<string, typeof allOrcLinks>()
	for (const link of allOrcLinks) {
		const list = orcLinksByRoutine.get(link.routineId) ?? []
		list.push(link)
		orcLinksByRoutine.set(link.routineId, list)
	}

	// Build list of all (routine, app) pairs using pre-fetched data
	type RoutineAppPair = {
		routine: (typeof sectionRoutines)[number]
		appId: string
		appName: string
	}
	const routineAppPairs: RoutineAppPair[] = []

	for (const routine of sectionRoutines) {
		// Build routine data object from batch-fetched maps to avoid N+1 getRoutine() calls
		const routineData: RoutineData = {
			...routine,
			technologyElements: (elementsByRoutine.get(routine.id) ?? []).map((e) => ({
				id: e.id,
				name: e.name,
			})),
			screeningQuestions: screeningByRoutine.get(routine.id) ?? [],
			persistenceLinks: persByRoutine.get(routine.id) ?? [],
			controls: controlsByRoutine.get(routine.id) ?? [],
			groupClassifications: gcLinksByRoutine.get(routine.id) ?? [],
			oracleRoleCriticalities: orcLinksByRoutine.get(routine.id) ?? [],
		}

		const apps = await getAppsRequiringRoutine(routine.id, {
			sectionAppIdsCache,
			routineData,
		})

		for (const app of apps) {
			routineAppPairs.push({ routine, appId: app.id, appName: app.name })
		}
	}

	// Group routine-app pairs by applicationId to enable efficient batching
	// Section routines (isSectionRoutine === 1) all use null as applicationId
	const pairsByAppId = new Map<string | null, typeof routineAppPairs>()
	for (const pair of routineAppPairs) {
		const key = pair.routine.isSectionRoutine === 1 ? null : pair.appId
		const existing = pairsByAppId.get(key) ?? []
		existing.push(pair)
		pairsByAppId.set(key, existing)
	}

	// Batch-fetch effective review dates per unique applicationId
	const reviewDateLookup = new Map<string, Date | null>()

	for (const [applicationId, pairs] of pairsByAppId) {
		// Deduplicate routines (same routine can appear multiple times for different apps)
		const uniqueRoutines = new Map<string, { id: string; sourceRoutineId: string | null }>()
		for (const p of pairs) {
			if (!uniqueRoutines.has(p.routine.id)) {
				uniqueRoutines.set(p.routine.id, {
					id: p.routine.id,
					sourceRoutineId: p.routine.sourceRoutineId,
				})
			}
		}
		const routinesToBatch = [...uniqueRoutines.values()]

		const reviewDateMap = await getEffectiveLastReviewDatesBatch(routinesToBatch, applicationId)

		// Store results with composite key "routineId:appId"
		for (const pair of pairs) {
			const reviewDate = reviewDateMap.get(pair.routine.id) ?? null
			reviewDateLookup.set(`${pair.routine.id}:${pair.appId}`, reviewDate)
		}
	}

	// Build results
	for (const { routine, appId, appName } of routineAppPairs) {
		const fullRoutine = {
			...routine,
			technologyElements: elementsByRoutine.get(routine.id)?.map((e) => ({ id: e.id, name: e.name })) ?? [],
			screeningQuestions: screeningByRoutine.get(routine.id) ?? [],
			persistenceLinks: persByRoutine.get(routine.id) ?? [],
			controls: controlsByRoutine.get(routine.id) ?? [],
			groupClassifications: gcLinksByRoutine.get(routine.id) ?? [],
			oracleRoleCriticalities: orcLinksByRoutine.get(routine.id) ?? [],
		}

		const lastReviewDate = reviewDateLookup.get(`${routine.id}:${appId}`) ?? null
		const deadline = calculateDeadline(
			lastReviewDate,
			routine.approvedAt ?? routine.createdAt,
			routine.frequency as RoutineFrequency | null,
		)

		results.push({
			routine: fullRoutine,
			applicationId: appId,
			applicationName: appName,
			lastReviewDate,
			deadline,
			overdue: isOverdue(deadline),
		})
	}

	return results
}

export async function getRoutineDeadlinesForApp(applicationId: string, opts?: ResolverOpts) {
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

	// Step 2: Load matched routines with tech elements, screening questions, and persistence links in batch
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

	// Step 3: Filter by technology elements if required (skip query when no routines have tech elements)
	let appElementIds: Set<string>
	if (allElements.length === 0) {
		appElementIds = new Set()
	} else if (opts?.appElementIds !== undefined) {
		appElementIds = opts.appElementIds
	} else {
		const appTechElements = await db
			.select({ elementId: applicationTechnologyElements.elementId })
			.from(applicationTechnologyElements)
			.where(
				and(
					eq(applicationTechnologyElements.applicationId, applicationId),
					isNull(applicationTechnologyElements.archivedAt),
					or(eq(applicationTechnologyElements.source, "auto"), isNotNull(applicationTechnologyElements.confirmedAt)),
					isNull(applicationTechnologyElements.rejectedAt),
				),
			)
		appElementIds = new Set(appTechElements.map((e) => e.elementId))
	}

	const appName = await resolveAppName(applicationId, opts)

	// Step 4: Get effective review dates for all routines (respects deadlinePolicy)
	const reviewDateMap = await getEffectiveLastReviewDatesBatch(routineRows, applicationId)

	// Step 5: Build results
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

		const lastReviewDate = reviewDateMap.get(routine.id) ?? null
		const deadline = calculateDeadline(
			lastReviewDate,
			routine.approvedAt ?? routine.createdAt,
			routine.frequency as RoutineFrequency | null,
		)

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
	opts?: ResolverOpts,
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

	const appName = await resolveAppName(applicationId, opts)

	// Get effective review dates for all routines (respects deadlinePolicy)
	const routineRowsForBatch = matchingRoutines.map((m) => ({
		id: m.routine.id,
		sourceRoutineId: m.routine.sourceRoutineId,
	}))
	const reviewDateMap = await getEffectiveLastReviewDatesBatch(routineRowsForBatch, applicationId)

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

		const lastReviewDate = reviewDateMap.get(routine.id) ?? null
		const deadline = calculateDeadline(
			lastReviewDate,
			routine.approvedAt ?? routine.createdAt,
			routine.frequency as RoutineFrequency | null,
		)

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
	opts?: ResolverOpts,
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

	const appName = await resolveAppName(applicationId, opts)

	// Get effective review dates for all routines (respects deadlinePolicy)
	const routineRowsForBatch = matchingRoutines.map((m) => ({
		id: m.routine.id,
		sourceRoutineId: m.routine.sourceRoutineId,
	}))
	const reviewDateMap = await getEffectiveLastReviewDatesBatch(routineRowsForBatch, applicationId)

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

		const lastReviewDate = reviewDateMap.get(routine.id) ?? null
		const deadline = calculateDeadline(
			lastReviewDate,
			routine.approvedAt ?? routine.createdAt,
			routine.frequency as RoutineFrequency | null,
		)

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
	opts?: ResolverOpts,
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

	const appName = await resolveAppName(applicationId, opts)

	// Get effective review dates for all routines (respects deadlinePolicy)
	const routineRowsForBatch = candidateRoutines.map((r) => ({
		id: r.id,
		sourceRoutineId: r.sourceRoutineId,
	}))
	const reviewDateMap = await getEffectiveLastReviewDatesBatch(routineRowsForBatch, applicationId)

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

		const lastReviewDate = reviewDateMap.get(routine.id) ?? null
		const deadline = calculateDeadline(
			lastReviewDate,
			routine.approvedAt ?? routine.createdAt,
			routine.frequency as RoutineFrequency | null,
		)

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
	opts?: ResolverOpts,
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

	const appName = await resolveAppName(applicationId, opts)

	// Get effective review dates for all routines (respects deadlinePolicy)
	const routineRowsForBatch = routineRows.map((r) => ({
		id: r.id,
		sourceRoutineId: r.sourceRoutineId,
	}))
	const reviewDateMap = await getEffectiveLastReviewDatesBatch(routineRowsForBatch, applicationId)

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

		const lastReviewDate = reviewDateMap.get(routine.id) ?? null
		const deadline = calculateDeadline(
			lastReviewDate,
			routine.approvedAt ?? routine.createdAt,
			routine.frequency as RoutineFrequency | null,
		)

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
	opts?: ResolverOpts,
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

	// Load routine constraints and app's own attributes in parallel
	const [
		allElements,
		allScreeningLinks,
		allPersLinks,
		allOracleLinks,
		appTechElements,
		appPersistence,
		appOracleAssessments,
	] = await Promise.all([
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
		db
			.select()
			.from(routineOracleRoleCriticalityLinks)
			.where(
				and(
					inArray(routineOracleRoleCriticalityLinks.routineId, routineIdList),
					isNull(routineOracleRoleCriticalityLinks.archivedAt),
				),
			),
		// App's auto-detected or confirmed, non-rejected technology elements
		db
			.select({ elementId: applicationTechnologyElements.elementId })
			.from(applicationTechnologyElements)
			.where(
				and(
					eq(applicationTechnologyElements.applicationId, applicationId),
					isNull(applicationTechnologyElements.archivedAt),
					or(eq(applicationTechnologyElements.source, "auto"), isNotNull(applicationTechnologyElements.confirmedAt)),
					isNull(applicationTechnologyElements.rejectedAt),
				),
			),
		// App's non-archived persistence entries
		db
			.select({
				type: applicationPersistence.type,
				dataClassification: applicationPersistence.dataClassification,
			})
			.from(applicationPersistence)
			.where(and(eq(applicationPersistence.applicationId, applicationId), isNull(applicationPersistence.archivedAt))),
		// App's Oracle role assessments
		db
			.select({ criticality: oracleRoleAssessments.criticality })
			.from(oracleRoleAssessments)
			.where(eq(oracleRoleAssessments.applicationId, applicationId)),
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
	const oracleByRoutine = new Map<string, typeof allOracleLinks>()
	for (const o of allOracleLinks) {
		const list = oracleByRoutine.get(o.routineId) ?? []
		list.push(o)
		oracleByRoutine.set(o.routineId, list)
	}

	// Pre-build app attribute sets for O(1) constraint checks
	const appElementIds = new Set(appTechElements.map((e) => e.elementId))
	const appPersTypes = new Set(appPersistence.map((p) => p.type))
	const appPersClassifications = new Set(
		appPersistence.map((p) => p.dataClassification).filter((c): c is DataClassification => c !== null),
	)
	const appOracleCriticalities = new Set(appOracleAssessments.map((a) => a.criticality))

	const appName = await resolveAppName(applicationId, opts)

	// Get effective review dates for all routines (respects deadlinePolicy)
	const routineRowsForBatch = matchingRoutines.map((r) => ({
		id: r.id,
		sourceRoutineId: r.sourceRoutineId,
	}))
	const reviewDateMap = await getEffectiveLastReviewDatesBatch(routineRowsForBatch, applicationId)

	const results: RoutineDeadlineInfo[] = []
	for (const routine of matchingRoutines) {
		const routineElements = elemsByRoutine.get(routine.id) ?? []
		const routinePers = persByRoutine.get(routine.id) ?? []
		const routineOracle = oracleByRoutine.get(routine.id) ?? []

		// Constraints (tech elements, persistence, oracle criticality) only filter isSectionRoutine=1 routines.
		// Routines with appliesToAllInSection=1 but isSectionRoutine=0 apply to ALL apps in the section
		// regardless of the app's attributes — the constraints are informational only for those routines.
		const isStrict = routine.isSectionRoutine === 1

		// Technology element constraint: app must have ≥1 matching confirmed element
		const matchedTechElements = routineElements.filter((e) => appElementIds.has(e.id))
		if (isStrict && routineElements.length > 0) {
			if (matchedTechElements.length === 0) continue
		}

		// Persistence constraint: app must satisfy ≥1 persistence link (type AND classification, cross-product).
		// A link with both fields null is skipped (matches nothing — consistent with findAppsByPersistenceMatch).
		// App must have at least one persistence entry for any persistence link to fire.
		let matchedPersistenceLinks: Array<{
			persistenceType: PersistenceType | null
			dataClassification: DataClassification | null
		}> = []
		if (routinePers.length > 0) {
			const effectiveLinks = routinePers.filter((l) => l.persistenceType !== null || l.dataClassification !== null)
			matchedPersistenceLinks = effectiveLinks.filter((link) => {
				const typeOk = !link.persistenceType || appPersTypes.has(link.persistenceType)
				const classOk = !link.dataClassification || appPersClassifications.has(link.dataClassification)
				return typeOk && classOk
			}) as Array<{ persistenceType: PersistenceType | null; dataClassification: DataClassification | null }>
			if (isStrict && (effectiveLinks.length === 0 || appPersTypes.size === 0 || matchedPersistenceLinks.length === 0))
				continue
		}

		// Oracle criticality constraint: app must have ≥1 matching Oracle role assessment.
		// criticality is a NOT NULL enum, so every link always has a value.
		const matchedOracleCriticalities = routineOracle.filter((link) => appOracleCriticalities.has(link.criticality))
		if (isStrict && routineOracle.length > 0) {
			if (matchedOracleCriticalities.length === 0) continue
		}

		const fullRoutine = {
			...routine,
			technologyElements: routineElements,
			screeningQuestions: screenByRoutine.get(routine.id) ?? [],
			persistenceLinks: routinePers,
			controls: [],
			groupClassifications: [],
			oracleRoleCriticalities: routineOracle,
		}

		const lastReviewDate = reviewDateMap.get(routine.id) ?? null
		const deadline = calculateDeadline(
			lastReviewDate,
			routine.approvedAt ?? routine.createdAt,
			routine.frequency as RoutineFrequency | null,
		)

		results.push({
			routine: fullRoutine,
			applicationId,
			applicationName: appName,
			lastReviewDate,
			deadline,
			overdue: isOverdue(deadline),
			matchedTechElements:
				matchedTechElements.length > 0 ? matchedTechElements.map((e) => ({ id: e.id, name: e.name })) : undefined,
			matchedPersistenceLinks:
				matchedPersistenceLinks.length > 0
					? matchedPersistenceLinks.map((l) => ({
							persistenceType: l.persistenceType,
							dataClassification: l.dataClassification,
						}))
					: undefined,
			matchedOracleCriticalities:
				matchedOracleCriticalities.length > 0
					? matchedOracleCriticalities.map((l) => ({ criticality: l.criticality }))
					: undefined,
		})
	}

	return results
}

// ─── Routine matching path 5: Ruleset-linked routines ────────────────────

export async function getRoutineDeadlinesForAppByRuleset(
	applicationId: string,
	excludeRoutineIds: Set<string> = new Set(),
	opts?: ResolverOpts,
): Promise<RoutineDeadlineInfo[]> {
	const { getRulesetIdsSelectedByApp } = await import("./rulesets.server")
	const selectedRulesetIds = await getRulesetIdsSelectedByApp(applicationId)
	if (selectedRulesetIds.size === 0) return []

	// Scope to active, non-archived rulesets in the app's current sections
	const sectionIds = await getSectionIdsForApp(applicationId)
	if (sectionIds.length === 0) return []

	const { rulesets, rulesetRoutines } = await import("../schema/rulesets")
	const activeRulesets = await db
		.select({ id: rulesets.id })
		.from(rulesets)
		.where(
			and(
				inArray(rulesets.id, [...selectedRulesetIds]),
				inArray(rulesets.sectionId, sectionIds),
				eq(rulesets.status, "active"),
				isNull(rulesets.archivedAt),
			),
		)
	const answeredRulesetIds = activeRulesets.map((r) => r.id)
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

	const appName = await resolveAppName(applicationId, opts)

	// Get effective review dates for all routines (respects deadlinePolicy)
	const routineRowsForBatch = routineRows.map((r) => ({
		id: r.id,
		sourceRoutineId: r.sourceRoutineId,
	}))
	const reviewDateMap = await getEffectiveLastReviewDatesBatch(routineRowsForBatch, applicationId)

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

		const lastReviewDate = reviewDateMap.get(routine.id) ?? null
		const deadline = calculateDeadline(
			lastReviewDate,
			routine.approvedAt ?? routine.createdAt,
			routine.frequency as RoutineFrequency | null,
		)

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

	// Collect all routineIds that might have reviews (current + transitive sources)
	const routineIdsToFetchReviews = new Set<string>(routineIds)
	const policyMap = new Map<string, "continue" | "reset">()
	const sourceMap = new Map<string, string>()

	// For each routine with a sourceRoutineId, check deadlinePolicy and potentially add source
	const sourceRoutineIds = sectionRoutineRows.map((r) => r.sourceRoutineId).filter((id): id is string => id !== null)

	if (sourceRoutineIds.length > 0) {
		// Build initial sourceMap from active routines
		for (const routine of sectionRoutineRows) {
			if (routine.sourceRoutineId) {
				sourceMap.set(routine.id, routine.sourceRoutineId)
			}
		}

		// Fetch all transitive source routines FIRST (level-by-level BFS)
		// We need to know the full chain before we can fetch policies for all routines
		const allSourceIds = new Set<string>(sourceRoutineIds)
		const allRoutineIdsInChains = new Set<string>(routineIds)

		for (let chainDepth = 0; chainDepth < MAX_REPLACEMENT_CHAIN_DEPTH; chainDepth++) {
			if (allSourceIds.size === 0) break

			const currentLevel = [...allSourceIds].filter((id) => !allRoutineIdsInChains.has(id))
			if (currentLevel.length === 0) break

			allSourceIds.clear()

			// Fetch in batches of 100
			for (let i = 0; i < currentLevel.length; i += 100) {
				const batch = currentLevel.slice(i, i + 100)
				const sourceRoutines = await db
					.select({ id: routines.id, sourceRoutineId: routines.sourceRoutineId })
					.from(routines)
					.where(inArray(routines.id, batch))

				for (const r of sourceRoutines) {
					allRoutineIdsInChains.add(r.id)
					if (r.sourceRoutineId) {
						sourceMap.set(r.id, r.sourceRoutineId)
						allSourceIds.add(r.sourceRoutineId) // Queue for next level
					}
				}
			}
		}

		// NOW fetch audit log to determine policy for ALL routines in chains (current + sources)
		const auditEntries = await db
			.selectDistinctOn([auditLog.entityId], {
				routineId: auditLog.entityId,
				metadata: auditLog.metadata,
			})
			.from(auditLog)
			.where(
				and(
					eq(auditLog.action, "routine_replaced"),
					eq(auditLog.entityType, "routine"),
					inArray(auditLog.entityId, [...allRoutineIdsInChains]),
				),
			)
			.orderBy(auditLog.entityId, desc(auditLog.performedAt))

		for (const entry of auditEntries) {
			// audit_log.metadata is stored as JSON string - parse it
			let policy: "continue" | "reset" | undefined
			if (entry.metadata) {
				try {
					const parsed = JSON.parse(entry.metadata)
					const raw = parsed?.deadlinePolicy
					if (raw === "continue" || raw === "reset") {
						policy = raw
					}
				} catch {
					// Invalid JSON - treat as missing policy
				}
			}
			if (policy) {
				policyMap.set(entry.routineId, policy)
			}
		}

		// Walk chains to find all routines we need reviews from
		// Stop at any routine with "reset" policy or no policy
		for (const routine of sectionRoutineRows) {
			if (routine.sourceRoutineId && policyMap.get(routine.id) === "continue") {
				let current: string | undefined = routine.sourceRoutineId
				let depth = 0
				while (current && depth < MAX_REPLACEMENT_CHAIN_DEPTH) {
					routineIdsToFetchReviews.add(current)
					// Stop if this routine has "reset" policy (or no policy)
					if (policyMap.get(current) !== "continue") break
					current = sourceMap.get(current)
					depth++
				}
			}
		}
	}

	// Fetch reviews for all relevant routine IDs
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
				inArray(routineReviews.routineId, [...routineIdsToFetchReviews]),
				isNull(routineReviews.applicationId),
				eq(routineReviews.status, "completed"),
			),
		)
		.orderBy(routineReviews.routineId, desc(routineReviews.reviewedAt))

	const reviewByRoutine = new Map(latestReviews.map((r) => [r.routineId, r]))

	// Build result - determine effectiveRoutineId using chain walking with policyMap
	return sectionRoutineRows.map((routine) => {
		// Find which routine's review we should return by walking the chain
		let effectiveRoutineId = routine.id

		if (routine.sourceRoutineId) {
			const policy = policyMap.get(routine.id)
			// Only chain-walk when the routine itself has no review — "continue" provides a fallback
			// base date, but once the new routine has been reviewed, that review takes precedence
			if (policy === "continue" && !reviewByRoutine.has(routine.id)) {
				// Walk the chain to find the effective source using sourceMap
				let current = routine.sourceRoutineId
				let depth = 0
				while (depth < MAX_REPLACEMENT_CHAIN_DEPTH) {
					// Check if this routine has a review
					if (reviewByRoutine.has(current)) {
						effectiveRoutineId = current
						break
					}
					// Check if this routine also has a source with "continue"
					const nextSource = sourceMap.get(current)
					if (!nextSource || policyMap.get(current) !== "continue") {
						// No review found in chain, use current routine id
						break
					}
					current = nextSource
					depth++
				}
			}
		}

		const lastReview = reviewByRoutine.get(effectiveRoutineId) ?? null
		// lastReviewDate is derived from lastReview to ensure consistency (avoids duplicate chain-walking)
		const lastReviewDate = lastReview?.reviewedAt ?? null
		const deadline = calculateDeadline(
			lastReviewDate,
			routine.approvedAt ?? routine.createdAt,
			routine.frequency as RoutineFrequency | null,
		)

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

function parseEntraGroupIdsFromAuthIntegrations(authIntegrations: Array<{ groups: string | null }>): string[] {
	const groupIds: string[] = []

	for (const auth of authIntegrations) {
		if (!auth.groups) continue
		try {
			const parsed = JSON.parse(auth.groups) as unknown
			if (!Array.isArray(parsed)) continue
			groupIds.push(
				...parsed
					.filter((groupId): groupId is string => typeof groupId === "string" && groupId.trim().length > 0)
					.map((groupId) => groupId.trim()),
			)
		} catch {}
	}

	return [...new Set(groupIds)]
}

async function waitForEntraSeed(activityId: string): Promise<EntraStagedData | null> {
	for (let attempt = 0; attempt < 20; attempt++) {
		const [activity] = await db
			.select({ stagedData: routineReviewActivities.stagedData })
			.from(routineReviewActivities)
			.where(eq(routineReviewActivities.id, activityId))
			.limit(1)

		if (activity?.stagedData) {
			return parseEntraStagedData(activity.stagedData)
		}

		await new Promise((resolve) => setTimeout(resolve, 200))
	}

	return null
}

async function buildEntraSeedResult(
	applicationId: string,
): Promise<{ stagedData: EntraStagedData; snapshot: EntraGroupSnapshot }> {
	const [authIntegrations, manualGroups, groupAssessments] = await Promise.all([
		getAppAuthIntegrations(applicationId),
		getManualGroupsForApp(applicationId),
		getGroupAssessmentsForApp(applicationId),
	])

	const naisGroupIds = parseEntraGroupIdsFromAuthIntegrations(authIntegrations)
	const naisGroupIdSet = new Set(naisGroupIds)
	const manualGroupsByGroupId = new Map(manualGroups.map((group) => [group.groupId, group]))
	const manualGroupIdSet = new Set(manualGroupsByGroupId.keys())
	const assessmentByGroupId = new Map(groupAssessments.map((assessment) => [assessment.groupId, assessment]))
	const ghostGroupIds = groupAssessments
		.filter((assessment) => !naisGroupIdSet.has(assessment.groupId) && !manualGroupIdSet.has(assessment.groupId))
		.map((assessment) => assessment.groupId)
	const allGroupIds = [...new Set([...naisGroupIds, ...manualGroupIdSet, ...ghostGroupIds])]
	const groupNames = await resolveGroupNames(allGroupIds)

	const groups = [
		...naisGroupIds.map((groupId) => {
			const manualGroup = manualGroupsByGroupId.get(groupId) ?? null
			const assessment = assessmentByGroupId.get(groupId) ?? null
			return {
				groupId,
				groupName: groupNames[groupId]?.trim() || manualGroup?.groupName?.trim() || null,
				source: "nais_auth" as const,
				hasNaisSource: true,
				hasManualSource: manualGroup !== null,
				isNewAssessment: assessment === null,
				isAddedDuringReview: false,
				isGone: false,
				seededManualGroupId: manualGroup?.id ?? null,
				criticality: assessment?.criticality ?? null,
				criticalitySetBy: assessment?.assessedBy ?? null,
				criticalitySetAt: assessment?.assessedAt?.toISOString() ?? null,
			}
		}),
		...manualGroups
			.filter((group) => !naisGroupIdSet.has(group.groupId))
			.map((group) => {
				const assessment = assessmentByGroupId.get(group.groupId) ?? null
				return {
					groupId: group.groupId,
					groupName: groupNames[group.groupId]?.trim() || group.groupName?.trim() || null,
					source: "manual" as const,
					hasNaisSource: false,
					hasManualSource: true,
					isNewAssessment: assessment === null,
					isAddedDuringReview: false,
					isGone: false,
					seededManualGroupId: group.id,
					criticality: assessment?.criticality ?? null,
					criticalitySetBy: assessment?.assessedBy ?? null,
					criticalitySetAt: assessment?.assessedAt?.toISOString() ?? null,
				}
			}),
		...ghostGroupIds.map((groupId) => {
			const assessment = assessmentByGroupId.get(groupId)
			if (!assessment) {
				throw new Error(`Fant ikke lagret vurdering for ghost-gruppe ${groupId}`)
			}
			return {
				groupId,
				groupName: groupNames[groupId]?.trim() || null,
				source: "ghost" as const,
				hasNaisSource: false,
				hasManualSource: false,
				isNewAssessment: false,
				isAddedDuringReview: false,
				isGone: false,
				seededManualGroupId: null,
				criticality: assessment.criticality,
				criticalitySetBy: assessment.assessedBy,
				criticalitySetAt: assessment.assessedAt.toISOString(),
			}
		}),
	]

	const stagedData = parseEntraStagedData({
		activityType: ENTRA_STAGED_DATA_ACTIVITY_TYPE,
		schemaVersion: ENTRA_STAGED_DATA_SCHEMA_VERSION,
		seededAt: new Date().toISOString(),
		groups,
	})

	return {
		stagedData,
		snapshot: toEntraGroupSnapshot(stagedData),
	}
}

/**
 * Bygger et øyeblikksbilde av Entra ID-grupper for en applikasjon — inkluderer
 * Nais auth-grupper, manuelt registrerte grupper og lagrede vurderinger.
 * Eksternt kall: resolver gruppenavn via Microsoft Graph.
 */
export async function buildEntraGroupSnapshot(applicationId: string): Promise<EntraGroupSnapshot> {
	const { snapshot } = await buildEntraSeedResult(applicationId)
	return snapshot
}

export async function seedEntraActivity(
	activityId: string,
	applicationId: string,
	performedBy: string,
): Promise<EntraStagedData> {
	if (!applicationId) {
		throw new Error("Kan ikke seed'e Entra-aktivitet uten applikasjon")
	}

	// Quick check without lock — avoids Graph HTTP call if already seeded
	const [precheck] = await db
		.select({
			type: routineReviewActivities.type,
			status: routineReviewActivities.status,
			stagedData: routineReviewActivities.stagedData,
		})
		.from(routineReviewActivities)
		.where(eq(routineReviewActivities.id, activityId))
		.limit(1)

	if (!precheck) {
		throw new Error(`Fant ikke review-aktivitet ${activityId}`)
	}
	if (precheck.type !== "entra_id_group_maintenance") {
		throw new Error(`Aktivitet ${activityId} er ikke Entra-vedlikehold`)
	}
	if (precheck.status !== "pending") {
		throw new Response("Kan ikke seed'e en fullført aktivitet", { status: 409 })
	}
	if (precheck.stagedData) {
		return parseEntraStagedData(precheck.stagedData)
	}

	// Build seed result OUTSIDE lock — includes Graph HTTP calls (resolveGroupNames)
	const seeded = await buildEntraSeedResult(applicationId)

	const lockName = `entra_id_group_maintenance-activity-${activityId}`
	const result = await withAdvisoryLock(lockName, async () => {
		// Re-check under lock — another request may have seeded while we were building
		const [current] = await db
			.select({
				status: routineReviewActivities.status,
				stagedData: routineReviewActivities.stagedData,
			})
			.from(routineReviewActivities)
			.where(eq(routineReviewActivities.id, activityId))
			.limit(1)

		if (!current) {
			throw new Error(`Fant ikke review-aktivitet ${activityId}`)
		}
		if (current.status !== "pending") {
			throw new Response("Kan ikke seed'e en fullført aktivitet", { status: 409 })
		}
		if (current.stagedData) {
			return parseEntraStagedData(current.stagedData)
		}

		return db.transaction(async (tx) => {
			const [updated] = await tx
				.update(routineReviewActivities)
				.set({
					stagedData: seeded.stagedData,
					snapshotBefore: sql`COALESCE(${routineReviewActivities.snapshotBefore}, ${JSON.stringify(seeded.snapshot)}::jsonb)`,
				})
				.where(and(eq(routineReviewActivities.id, activityId), isNull(routineReviewActivities.stagedData)))
				.returning({ stagedData: routineReviewActivities.stagedData })

			if (updated?.stagedData) {
				await writeAuditLog(
					{
						action: "review_activity_seeded",
						entityType: "routine_review_activity",
						entityId: activityId,
						performedBy: performedBy,
					},
					tx,
				)
				return parseEntraStagedData(updated.stagedData)
			}

			const [current2] = await tx
				.select({ stagedData: routineReviewActivities.stagedData })
				.from(routineReviewActivities)
				.where(eq(routineReviewActivities.id, activityId))
				.limit(1)

			if (!current2?.stagedData) {
				throw new Error(`Kunne ikke seed'e Entra-aktivitet ${activityId}`)
			}

			return parseEntraStagedData(current2.stagedData)
		})
	})

	if (result !== null) {
		return result
	}

	const polled = await waitForEntraSeed(activityId)
	if (polled) {
		return polled
	}

	throw new Response("Gjennomgangen er låst av en annen operasjon. Prøv igjen.", { status: 409 })
}

export async function patchEntraActivity(
	activityId: string,
	patch: StagedDataPatch,
	performedBy: string,
): Promise<void> {
	// Quick pre-check without lock to decide if we need to build a seed result
	const [precheck] = await db
		.select({
			type: routineReviewActivities.type,
			status: routineReviewActivities.status,
			stagedData: routineReviewActivities.stagedData,
			applicationId: routineReviews.applicationId,
		})
		.from(routineReviewActivities)
		.innerJoin(routineReviews, eq(routineReviewActivities.reviewId, routineReviews.id))
		.where(eq(routineReviewActivities.id, activityId))
		.limit(1)

	if (!precheck) {
		throw new Error(`Fant ikke review-aktivitet ${activityId}`)
	}
	if (precheck.type !== "entra_id_group_maintenance") {
		throw new Error(`Aktivitet ${activityId} er ikke Entra-vedlikehold`)
	}
	if (precheck.status !== "pending") {
		throw new Response("Kan ikke endre en fullført aktivitet", { status: 409 })
	}

	// Build seed result OUTSIDE lock — includes Graph HTTP calls (resolveGroupNames)
	const seedResult =
		!precheck.stagedData && precheck.applicationId
			? await buildEntraSeedResult(precheck.applicationId)
			: !precheck.stagedData
				? (() => {
						throw new Error("Entra-aktiviteten mangler applikasjon")
					})()
				: null

	const lockName = `entra_id_group_maintenance-activity-${activityId}`
	const result = await withAdvisoryLock(lockName, async () => {
		return db.transaction(async (tx) => {
			const [activity] = await tx
				.select({
					status: routineReviewActivities.status,
					stagedData: routineReviewActivities.stagedData,
				})
				.from(routineReviewActivities)
				.where(eq(routineReviewActivities.id, activityId))
				.limit(1)

			if (!activity) {
				throw new Error(`Fant ikke review-aktivitet ${activityId}`)
			}
			if (activity.status !== "pending") {
				throw new Response("Kan ikke endre en fullført aktivitet", { status: 409 })
			}

			let stagedData = activity.stagedData ? parseEntraStagedData(activity.stagedData) : null
			let seededInThisCall = false
			if (!stagedData) {
				if (!seedResult) {
					throw new Error(`Mangler staged_data for Entra-aktivitet ${activityId}`)
				}
				stagedData = seedResult.stagedData
				await tx
					.update(routineReviewActivities)
					.set({
						stagedData: seedResult.stagedData,
						snapshotBefore: sql`COALESCE(${routineReviewActivities.snapshotBefore}, ${JSON.stringify(seedResult.snapshot)}::jsonb)`,
					})
					.where(and(eq(routineReviewActivities.id, activityId), isNull(routineReviewActivities.stagedData)))
				seededInThisCall = true
			}

			let updatedData: EntraStagedData
			try {
				updatedData = parseEntraStagedData(applyEntraStagedDataPatch(stagedData, patch))
			} catch (e) {
				throw new Response(e instanceof Error ? e.message : "Ugyldig patch-operasjon", { status: 400 })
			}
			await tx
				.update(routineReviewActivities)
				.set({ stagedData: updatedData })
				.where(eq(routineReviewActivities.id, activityId))

			// Audit-log seeding if it happened in this call
			if (seededInThisCall) {
				await writeAuditLog(
					{
						action: "review_activity_seeded",
						entityType: "routine_review_activity",
						entityId: activityId,
						performedBy,
					},
					tx,
				)
			}

			// Skip change logging if the patch was a no-op (staged_data identical before/after)
			const wasNoOp = JSON.stringify(stagedData.groups) === JSON.stringify(updatedData.groups)
			if (wasNoOp) {
				return
			}

			// Infer and record the change atomically within the same transaction
			const beforeGroup = stagedData.groups.find((g) => g.groupId === patch.groupId) ?? null
			type ChangeRecord = {
				changeType: EntraChangeType
				groupId: string
				groupName: string | null
				previousValue: string | null
				newValue: string | null
			}
			let change: ChangeRecord | null = null
			if (patch.op === "add-group") {
				if (!beforeGroup || beforeGroup.isGone || beforeGroup.source === "ghost") {
					change = {
						changeType: "added",
						groupId: patch.groupId,
						groupName: patch.groupName ?? null,
						previousValue: null,
						newValue: patch.groupName ?? patch.groupId,
					}
				}
			} else if (patch.op === "mark-gone" || patch.op === "remove-manual-source") {
				if (beforeGroup) {
					change = {
						changeType: "removed",
						groupId: patch.groupId,
						groupName: beforeGroup.groupName,
						previousValue: beforeGroup.groupName ?? patch.groupId,
						newValue: null,
					}
				}
			} else if (patch.op === "set-criticality") {
				if (beforeGroup) {
					change = {
						changeType: "criticality_changed",
						groupId: patch.groupId,
						groupName: beforeGroup.groupName,
						previousValue: beforeGroup.criticality,
						newValue: patch.criticality,
					}
				}
			}
			if (change) {
				await recordEntraChange({ activityId, performedBy, ...change }, tx)
			}
		})
	})

	if (result === null) {
		throw new Response("Gjennomgangen er låst av en annen operasjon. Prøv igjen.", { status: 409 })
	}
}

export async function createReviewActivity(
	reviewId: string,
	type: RoutineActivityType,
	snapshotBefore: EntraGroupSnapshot | null,
	performedBy: string,
	providerConfig: ReviewActivityProviderConfig | null = null,
) {
	const [activity] = await db
		.insert(routineReviewActivities)
		.values({
			reviewId,
			type,
			snapshotBefore,
			providerConfig,
		})
		.returning()

	await writeAuditLog({
		action: "review_activity_created",
		entityType: "routine_review_activity",
		entityId: activity.id,
		newValue: type,
		metadata: providerConfig ? { reviewId, providerConfig } : { reviewId },
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

export async function getReviewActivityByType(reviewId: string, type: RoutineActivityType) {
	const [activity] = await db
		.select()
		.from(routineReviewActivities)
		.where(and(eq(routineReviewActivities.reviewId, reviewId), eq(routineReviewActivities.type, type)))
		.limit(1)

	if (!activity) return null

	const changes = await db
		.select()
		.from(routineReviewActivityEntraChanges)
		.where(eq(routineReviewActivityEntraChanges.activityId, activity.id))
		.orderBy(routineReviewActivityEntraChanges.performedAt)

	return { ...activity, changes }
}

/**
 * Lightweight lookup: returns only the activity ID for a given review and type.
 * Use this instead of getReviewActivityByType when you only need the ID (e.g., for patches).
 */
export async function getReviewActivityIdByType(reviewId: string, type: RoutineActivityType): Promise<string | null> {
	const [row] = await db
		.select({ id: routineReviewActivities.id })
		.from(routineReviewActivities)
		.where(and(eq(routineReviewActivities.reviewId, reviewId), eq(routineReviewActivities.type, type)))
		.limit(1)
	return row?.id ?? null
}

export async function getReviewActivities(reviewId: string) {
	const activities = await db
		.select()
		.from(routineReviewActivities)
		.where(eq(routineReviewActivities.reviewId, reviewId))
		.orderBy(routineReviewActivities.sortOrder, routineReviewActivities.createdAt)

	if (activities.length === 0) return []

	const activityIds = activities.map((a) => a.id)
	const allChanges = await db
		.select()
		.from(routineReviewActivityEntraChanges)
		.where(inArray(routineReviewActivityEntraChanges.activityId, activityIds))
		.orderBy(routineReviewActivityEntraChanges.performedAt)

	const changesByActivity = new Map<string, (typeof allChanges)[number][]>()
	for (const c of allChanges) {
		const arr = changesByActivity.get(c.activityId) ?? []
		arr.push(c)
		changesByActivity.set(c.activityId, arr)
	}

	return activities.map((a) => ({ ...a, changes: changesByActivity.get(a.id) ?? [] }))
}

export async function autoCreateActivitiesForReview(
	reviewId: string,
	routineId: string,
	_applicationId: string | null,
	performedBy: string,
	providerConfigs?: Record<string, ReviewActivityProviderConfig>,
) {
	const activityLinks = await db
		.select({ activityType: routineActivityLinks.activityType })
		.from(routineActivityLinks)
		.where(and(eq(routineActivityLinks.routineId, routineId), isNull(routineActivityLinks.archivedAt)))
		.orderBy(routineActivityLinks.sortOrder)

	await db.transaction(async (tx) => {
		for (let i = 0; i < activityLinks.length; i++) {
			const link = activityLinks[i]
			const config = providerConfigs?.[link.activityType] ?? null
			// onConflictDoNothing: unique constraint on (review_id, type) handles race conditions
			const [inserted] = await tx
				.insert(routineReviewActivities)
				.values({
					reviewId,
					type: link.activityType as RoutineActivityType,
					sortOrder: i,
					snapshotBefore: null,
					providerConfig: config,
				})
				.onConflictDoNothing({ target: [routineReviewActivities.reviewId, routineReviewActivities.type] })
				.returning()

			if (inserted) {
				await writeAuditLog(
					{
						action: "review_activity_created",
						entityType: "routine_review_activity",
						entityId: inserted.id,
						newValue: link.activityType,
						metadata: config ? { reviewId, providerConfig: config } : { reviewId },
						performedBy,
					},
					tx,
				)
			}
		}
	})
}

export async function savePeriodConfig(activityId: string, periodConfig: PeriodConfig) {
	const [updated] = await db
		.update(routineReviewActivities)
		.set({ periodConfig })
		.where(eq(routineReviewActivities.id, activityId))
		.returning({ id: routineReviewActivities.id })

	if (!updated) {
		throw new Error(`Activity ${activityId} not found`)
	}
	return updated
}

export async function recordEntraChange(
	params: {
		activityId: string
		changeType: EntraChangeType
		groupId: string
		groupName: string | null
		previousValue: string | null
		newValue: string | null
		performedBy: string
	},
	tx?: DbExecutor,
) {
	const run = async (exec: DbExecutor) => {
		const [change] = await exec
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

		await writeAuditLog(
			{
				action: "review_activity_entra_change",
				entityType: "routine_review_activity",
				entityId: params.activityId,
				newValue: JSON.stringify({
					changeType: params.changeType,
					groupId: params.groupId,
					groupName: params.groupName,
				}),
				performedBy: params.performedBy,
			},
			exec,
		)

		return change
	}
	return tx ? run(tx) : db.transaction(run)
}

type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]

async function completeEntraReviewActivity(activityId: string, performedBy: string, executor: DbExecutor) {
	const [activity] = await executor
		.select({
			id: routineReviewActivities.id,
			status: routineReviewActivities.status,
			stagedData: routineReviewActivities.stagedData,
			applicationId: routineReviews.applicationId,
		})
		.from(routineReviewActivities)
		.innerJoin(routineReviews, eq(routineReviewActivities.reviewId, routineReviews.id))
		.where(eq(routineReviewActivities.id, activityId))
		.limit(1)

	if (!activity) {
		throw new Error(`Fant ikke review-aktivitet ${activityId}`)
	}
	if (activity.status !== "pending") {
		throw new Response("Aktiviteten er allerede fullført", { status: 409 })
	}
	if (!activity.applicationId) {
		throw new Response("Entra-aktiviteten mangler applikasjon", { status: 400 })
	}

	const stagedData = activity.stagedData ? parseEntraStagedData(activity.stagedData) : null
	if (!stagedData) {
		// staged_data skal alltid være satt før commit — seedEntraActivity() kalles av completeReview()
		// FØR transaksjonen starter. Å seede her ville gjort Microsoft Graph HTTP-kall inne i en
		// databasetransaksjon, noe som kan blokkere DB-koblinger unødvendig lenge.
		throw new Response("Entra-aktiviteten er ikke initialisert. Last gjennomgangssiden på nytt og prøv igjen.", {
			status: 409,
		})
	}

	const nonGoneGroups = stagedData.groups.filter((group) => !group.isGone)
	const groupsMissingCriticality = nonGoneGroups.filter((group) => group.criticality === null)
	if (groupsMissingCriticality.length > 0) {
		throw new Response(
			`Alle aktive Entra-grupper må ha kritikalitet før fullføring: ${groupsMissingCriticality
				.map((group) => group.groupId)
				.join(", ")}`,
			{ status: 400 },
		)
	}
	const activeGroups = nonGoneGroups.filter(
		(
			group,
		): group is (typeof nonGoneGroups)[number] & {
			criticality: NonNullable<(typeof nonGoneGroups)[number]["criticality"]>
		} => group.criticality !== null,
	)

	const existingAssessments =
		activeGroups.length > 0
			? await executor
					.select()
					.from(applicationGroupAssessments)
					.where(
						and(
							eq(applicationGroupAssessments.applicationId, activity.applicationId),
							inArray(
								applicationGroupAssessments.groupId,
								activeGroups.map((group) => group.groupId),
							),
							isNull(applicationGroupAssessments.archivedAt),
						),
					)
			: []
	const assessmentsByGroupId = new Map(existingAssessments.map((assessment) => [assessment.groupId, assessment]))

	for (const group of activeGroups) {
		const existingAssessment = assessmentsByGroupId.get(group.groupId) ?? null
		if (existingAssessment && existingAssessment.criticality === group.criticality) {
			continue
		}

		const performedAt = group.criticalitySetAt ? new Date(group.criticalitySetAt) : new Date()
		const performedByForAssessment = group.criticalitySetBy ?? performedBy
		const nextValue = JSON.stringify({ groupId: group.groupId, criticality: group.criticality })

		if (existingAssessment) {
			await executor
				.update(applicationGroupAssessments)
				.set({
					criticality: group.criticality,
					assessedBy: performedByForAssessment,
					assessedAt: performedAt,
					updatedBy: performedByForAssessment,
					updatedAt: performedAt,
					archivedAt: null,
					archivedBy: null,
				})
				.where(eq(applicationGroupAssessments.id, existingAssessment.id))

			await writeAuditLog(
				{
					action: "group_criticality_updated",
					entityType: "application",
					entityId: activity.applicationId,
					previousValue: JSON.stringify({ groupId: group.groupId, criticality: existingAssessment.criticality }),
					newValue: nextValue,
					performedBy: performedByForAssessment,
				},
				executor,
			)
			continue
		}

		await executor.insert(applicationGroupAssessments).values({
			applicationId: activity.applicationId,
			groupId: group.groupId,
			criticality: group.criticality,
			assessedBy: performedByForAssessment,
			assessedAt: performedAt,
			updatedBy: performedByForAssessment,
			updatedAt: performedAt,
		})

		await writeAuditLog(
			{
				action: "group_criticality_updated",
				entityType: "application",
				entityId: activity.applicationId,
				newValue: nextValue,
				performedBy: performedByForAssessment,
			},
			executor,
		)
	}

	for (const group of stagedData.groups.filter(
		(entry) => entry.isAddedDuringReview && entry.hasManualSource && !entry.isGone,
	)) {
		const [insertedManualGroup] = await executor
			.insert(applicationManualGroups)
			.values({
				applicationId: activity.applicationId,
				groupId: group.groupId,
				groupName: group.groupName,
				createdBy: performedBy,
			})
			.onConflictDoNothing({
				target: [applicationManualGroups.applicationId, applicationManualGroups.groupId],
				where: isNull(applicationManualGroups.archivedAt),
			})
			.returning()

		if (!insertedManualGroup) {
			continue
		}

		await writeAuditLog(
			{
				action: "manual_group_added",
				entityType: "application",
				entityId: activity.applicationId,
				newValue: JSON.stringify({ groupId: group.groupId, groupName: group.groupName }),
				performedBy,
			},
			executor,
		)
	}

	for (const group of stagedData.groups.filter((entry) => entry.source === "ghost" && entry.isGone)) {
		const [archivedAssessment] = await executor
			.update(applicationGroupAssessments)
			.set({ archivedAt: new Date(), archivedBy: performedBy })
			.where(
				and(
					eq(applicationGroupAssessments.applicationId, activity.applicationId),
					eq(applicationGroupAssessments.groupId, group.groupId),
					isNull(applicationGroupAssessments.archivedAt),
				),
			)
			.returning({
				groupId: applicationGroupAssessments.groupId,
				criticality: applicationGroupAssessments.criticality,
				assessedBy: applicationGroupAssessments.assessedBy,
			})

		if (!archivedAssessment) {
			continue
		}

		await writeAuditLog(
			{
				action: "ghost_group_archived",
				entityType: "application",
				entityId: activity.applicationId,
				previousValue: JSON.stringify({
					groupId: archivedAssessment.groupId,
					criticality: archivedAssessment.criticality,
					assessedBy: archivedAssessment.assessedBy,
				}),
				performedBy,
			},
			executor,
		)
	}

	for (const group of stagedData.groups) {
		// Archive when: (1) mark-gone was applied (isGone=true), OR
		// (2) remove-manual-source was applied (hasManualSource=false, isGone=false).
		// In both cases a seededManualGroupId must be present.
		if (!group.seededManualGroupId || (!group.isGone && group.hasManualSource)) {
			continue
		}

		const [archivedManualGroup] = await executor
			.update(applicationManualGroups)
			.set({ archivedAt: new Date(), archivedBy: performedBy })
			.where(
				and(
					eq(applicationManualGroups.id, group.seededManualGroupId),
					eq(applicationManualGroups.applicationId, activity.applicationId),
					isNull(applicationManualGroups.archivedAt),
				),
			)
			.returning()

		if (!archivedManualGroup) {
			continue
		}

		await writeAuditLog(
			{
				action: "manual_group_removed",
				entityType: "application",
				entityId: activity.applicationId,
				previousValue: JSON.stringify({
					groupId: archivedManualGroup.groupId,
					groupName: archivedManualGroup.groupName,
				}),
				performedBy,
			},
			executor,
		)
	}

	return toEntraGroupSnapshot(stagedData)
}

export async function completeReviewActivity(
	activityId: string,
	snapshotAfter: EntraGroupSnapshot | null,
	performedBy: string,
	tx?: DbExecutor,
) {
	const [activity] = await (tx ?? db)
		.select({
			type: routineReviewActivities.type,
			status: routineReviewActivities.status,
			stagedData: routineReviewActivities.stagedData,
			applicationId: routineReviews.applicationId,
			reviewId: routineReviews.id,
		})
		.from(routineReviewActivities)
		.innerJoin(routineReviews, eq(routineReviewActivities.reviewId, routineReviews.id))
		.where(eq(routineReviewActivities.id, activityId))
		.limit(1)

	if (!activity) {
		throw new Error(`Fant ikke review-aktivitet ${activityId}`)
	}
	if (activity.status !== "pending") {
		throw new Response("Aktiviteten er allerede fullført", { status: 409 })
	}

	// Use the Entra staged_data commit path for entra_id_group_maintenance activities that have an
	// application. Section-level Entra activities (applicationId = null) fall through to generic completion.
	// completeEntraReviewActivity kaster 409 hvis staged_data er null — seedEntraActivity() MÅ kalles
	// før commit. completeReview() håndterer dette i pre-seed-løkken før transaksjonen.
	if (activity.type === "entra_id_group_maintenance" && activity.applicationId !== null) {
		const lockName = `entra_id_group_maintenance-activity-${activityId}`
		const result = await withAdvisoryLock(lockName, async () => {
			const run = async (exec: DbExecutor) => {
				const snapshot = await completeEntraReviewActivity(activityId, performedBy, exec)

				const [updated] = await exec
					.update(routineReviewActivities)
					.set({ status: "completed", snapshotAfter: snapshot, completedAt: new Date() })
					.where(and(eq(routineReviewActivities.id, activityId), eq(routineReviewActivities.status, "pending")))
					.returning()

				if (!updated) {
					throw new Response("Aktiviteten er allerede fullført", { status: 409 })
				}

				await writeAuditLog(
					{
						action: "review_activity_completed",
						entityType: "routine_review_activity",
						entityId: activityId,
						performedBy,
					},
					exec,
				)

				return updated
			}

			return tx ? run(tx) : db.transaction(run)
		})

		if (result === null) {
			throw new Response("Gjennomgangen er låst av en annen operasjon. Prøv igjen.", { status: 409 })
		}

		return result
	}

	// Use the RPA staged_data commit path for rpa_user_maintenance activities that have an application.
	if (activity.type === "rpa_user_maintenance" && activity.applicationId !== null) {
		const lockName = `rpa_user_maintenance-activity-${activityId}`
		const result = await withAdvisoryLock(lockName, async () => {
			const run = async (exec: DbExecutor) => {
				const snapshot = await completeRpaReviewActivity(activityId, activity.reviewId, performedBy, exec)

				const [updated] = await exec
					.update(routineReviewActivities)
					.set({ status: "completed", snapshotAfter: snapshot, completedAt: new Date() })
					.where(and(eq(routineReviewActivities.id, activityId), eq(routineReviewActivities.status, "pending")))
					.returning()

				if (!updated) {
					throw new Response("Aktiviteten er allerede fullført", { status: 409 })
				}

				await writeAuditLog(
					{
						action: "review_activity_completed",
						entityType: "routine_review_activity",
						entityId: activityId,
						performedBy,
					},
					exec,
				)

				return updated
			}

			return tx ? run(tx) : db.transaction(run)
		})

		if (result === null) {
			throw new Response("Gjennomgangen er låst av en annen operasjon. Prøv igjen.", { status: 409 })
		}

		return result
	}

	const runGeneric = async (exec: DbExecutor) => {
		const [updated] = await exec
			.update(routineReviewActivities)
			.set({
				status: "completed",
				snapshotAfter,
				completedAt: new Date(),
			})
			.where(and(eq(routineReviewActivities.id, activityId), eq(routineReviewActivities.status, "pending")))
			.returning()

		if (!updated) {
			throw new Response("Aktiviteten er allerede fullført", { status: 409 })
		}

		await writeAuditLog(
			{
				action: "review_activity_completed",
				entityType: "routine_review_activity",
				entityId: activityId,
				performedBy,
			},
			exec,
		)

		return updated
	}

	return tx ? runGeneric(tx) : db.transaction(runGeneric)
}

export async function getActivitiesForReviews(reviewIds: string[]) {
	if (reviewIds.length === 0) return []

	const activities = await db
		.select()
		.from(routineReviewActivities)
		.where(inArray(routineReviewActivities.reviewId, reviewIds))
		.orderBy(routineReviewActivities.reviewId, routineReviewActivities.sortOrder, routineReviewActivities.createdAt)

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
				name: source.name,
				description: source.description,
				frequency: source.frequency,
				eventFrequency: source.eventFrequency,
				responsibleRole: source.responsibleRole,
				appliesToAllInSection: source.appliesToAllInSection,
				isSectionRoutine: source.isSectionRoutine,
				sectionRoutineOwnerRole: source.sectionRoutineOwnerRole,
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

		// Copy activity links (multi-activity support)
		const sourceActivityLinks = await tx
			.select()
			.from(routineActivityLinks)
			.where(and(eq(routineActivityLinks.routineId, routineId), isNull(routineActivityLinks.archivedAt)))
			.orderBy(routineActivityLinks.sortOrder)
		if (sourceActivityLinks.length > 0) {
			await tx.insert(routineActivityLinks).values(
				sourceActivityLinks.map((link) => ({
					routineId: copy.id,
					activityType: link.activityType,
					sortOrder: link.sortOrder,
					createdBy: performedBy,
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
	// Validate IDs are different
	if (newRoutineId === oldRoutineId) {
		throw new Response("Ny og gammel rutine kan ikke være den samme", { status: 400 })
	}

	return db.transaction(async (tx) => {
		// Lock and validate new routine (must be ready, not archived, and point to old routine)
		const [newLocked] = await tx
			.select({
				status: routines.status,
				archivedAt: routines.archivedAt,
				name: routines.name,
				sourceRoutineId: routines.sourceRoutineId,
			})
			.from(routines)
			.where(eq(routines.id, newRoutineId))
			.for("share")
			.limit(1)
		if (!newLocked) {
			throw new Response("Rutinen som skal godkjennes ble ikke funnet", { status: 404 })
		}
		if (newLocked.archivedAt) {
			throw new Response("Arkiverte rutiner kan ikke godkjennes. Reaktiver rutinen først.", { status: 403 })
		}
		if (newLocked.status !== "ready") {
			throw new Response("Kun ferdige rutiner kan godkjennes", { status: 400 })
		}
		// Verify that the new routine actually points to the old routine we're replacing
		if (newLocked.sourceRoutineId !== oldRoutineId) {
			throw new Response("Rutinen peker ikke på den opprinnelige rutinen som skal erstattes", { status: 400 })
		}

		// Lock and validate old routine (must be approved, not archived)
		const [oldLocked] = await tx
			.select({ status: routines.status, archivedAt: routines.archivedAt, name: routines.name })
			.from(routines)
			.where(eq(routines.id, oldRoutineId))
			.for("share")
			.limit(1)
		if (!oldLocked) {
			throw new Response("Rutinen som skal erstattes ble ikke funnet", { status: 404 })
		}
		if (oldLocked.archivedAt) {
			throw new Response("Kan ikke erstatte en arkivert rutine.", { status: 400 })
		}
		if (oldLocked.status !== "approved") {
			throw new Response("Kun godkjente rutiner kan erstattes", { status: 400 })
		}

		const now = new Date()

		// Approve the new routine (with WHERE guards for TOCTOU protection)
		const [updatedNew] = await tx
			.update(routines)
			.set({ status: "approved", approvedBy: performedBy, approvedAt: now, updatedBy: performedBy, updatedAt: now })
			.where(and(eq(routines.id, newRoutineId), eq(routines.status, "ready"), isNull(routines.archivedAt)))
			.returning()
		if (!updatedNew) {
			throw new Response("Rutinen kan ikke godkjennes lenger (status eller archived_at endret seg).", {
				status: 409,
			})
		}

		// Archive the old routine and mark replacement (with WHERE guards)
		const [updatedOld] = await tx
			.update(routines)
			.set({
				status: "archived",
				archivedAt: now,
				archivedBy: performedBy,
				replacedByRoutineId: newRoutineId,
				replacedAt: now,
				updatedBy: performedBy,
				updatedAt: now,
			})
			.where(and(eq(routines.id, oldRoutineId), eq(routines.status, "approved"), isNull(routines.archivedAt)))
			.returning()
		if (!updatedOld) {
			throw new Response("Den gamle rutinen kan ikke erstattes lenger (status eller archived_at endret seg).", {
				status: 409,
			})
		}

		// Store replacement metadata for audit trail
		await writeAuditLog(
			{
				action: "routine_replaced",
				entityType: "routine",
				entityId: newRoutineId,
				metadata: {
					replacedRoutineId: oldRoutineId,
					replacedRoutineName: oldLocked.name,
					newRoutineName: newLocked.name,
					deadlinePolicy,
				},
				performedBy,
			},
			tx,
		)

		return { newRoutine: newRoutineId, oldRoutine: oldRoutineId, deadlinePolicy }
	})
}

// ─── Routine Activity Links ──────────────────────────────────────────────

export async function getRoutineActivityLinks(routineId: string) {
	return db
		.select({
			id: routineActivityLinks.id,
			activityType: routineActivityLinks.activityType,
			sortOrder: routineActivityLinks.sortOrder,
		})
		.from(routineActivityLinks)
		.where(and(eq(routineActivityLinks.routineId, routineId), isNull(routineActivityLinks.archivedAt)))
		.orderBy(routineActivityLinks.sortOrder)
}

export async function reorderRoutineActivities(routineId: string, orderedIds: string[], performedBy: string) {
	await db.transaction(async (tx) => {
		// Validate that orderedIds exactly matches the routine's active link set
		const activeLinks = await tx
			.select({ id: routineActivityLinks.id, activityType: routineActivityLinks.activityType })
			.from(routineActivityLinks)
			.where(and(eq(routineActivityLinks.routineId, routineId), isNull(routineActivityLinks.archivedAt)))

		const activeLinkIds = new Set(activeLinks.map((l) => l.id))
		const suppliedIds = new Set(orderedIds)

		if (
			orderedIds.length !== activeLinkIds.size ||
			suppliedIds.size !== activeLinkIds.size ||
			[...activeLinkIds].some((id) => !suppliedIds.has(id))
		) {
			throw new Error("orderedIds must exactly match the routine's active activity links")
		}

		for (let i = 0; i < orderedIds.length; i++) {
			await tx
				.update(routineActivityLinks)
				.set({ sortOrder: i })
				.where(and(eq(routineActivityLinks.id, orderedIds[i]), eq(routineActivityLinks.routineId, routineId)))
		}

		await writeAuditLog(
			{
				action: "routine_updated",
				entityType: "routine",
				entityId: routineId,
				newValue: `Activity order: ${orderedIds.join(", ")}`,
				performedBy,
			},
			tx,
		)
	})
}

export async function hasReviewActivityType(reviewId: string, type: RoutineActivityType) {
	const result = await db
		.select({ id: routineReviewActivities.id })
		.from(routineReviewActivities)
		.where(and(eq(routineReviewActivities.reviewId, reviewId), eq(routineReviewActivities.type, type)))
		.limit(1)
	return result.length > 0
}

/**
 * Sjekker om det finnes en aktiv gjennomgang (status 'draft' eller 'needs_follow_up') for
 * samme applicationId og minst én av de oppgitte aktivitetstypene.
 *
 * Brukes som guard ved opprettelse av ny gjennomgang for å hindre duplikater.
 * applicationId=null representerer seksjonsrutiner og behandles som egen scope.
 *
 * @returns Første konflikt funnet, eller null hvis ingen konflikt.
 */
export async function findActiveReviewConflict(
	routineId: string,
	applicationId: string | null,
	activityTypes: RoutineActivityType[],
): Promise<{ activityType: RoutineActivityType | null; reviewId: string } | null> {
	const appFilter =
		applicationId !== null ? eq(routineReviews.applicationId, applicationId) : isNull(routineReviews.applicationId)

	if (activityTypes.length === 0) {
		// No activity types on the routine → guard by routine identity instead of activity type
		const [conflict] = await db
			.select({ reviewId: routineReviews.id })
			.from(routineReviews)
			.where(
				and(
					eq(routineReviews.routineId, routineId),
					appFilter,
					inArray(routineReviews.status, ["draft", "needs_follow_up"] as ReviewStatus[]),
				),
			)
			.limit(1)
		return conflict ? { activityType: null, reviewId: conflict.reviewId } : null
	}

	const [conflict] = await db
		.select({
			activityType: routineReviewActivities.type,
			reviewId: routineReviews.id,
		})
		.from(routineReviews)
		.innerJoin(routineReviewActivities, eq(routineReviewActivities.reviewId, routineReviews.id))
		.where(
			and(
				appFilter,
				// For section routines (applicationId = null) the appFilter matches all section reviews
				// globally. Scope to this routine to avoid cross-section false conflicts.
				applicationId === null ? eq(routineReviews.routineId, routineId) : undefined,
				inArray(routineReviews.status, ["draft", "needs_follow_up"] as ReviewStatus[]),
				inArray(routineReviewActivities.type, activityTypes),
			),
		)
		.limit(1)

	return conflict ?? null
}
