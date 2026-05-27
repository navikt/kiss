/**
 * Shared routine deadline pipeline for compliance computation.
 *
 * Encapsulates the 7-step sequential deadline resolution + control/technology-element
 * enrichment. Used by:
 * - App detail page loader (for on-the-fly compliance display)
 * - syncApplicationControls (for persisting compliance cache)
 * - Control routines page (for showing matched routines per control)
 *
 * Single source of truth — avoids divergence between these consumers.
 */
import { and, desc, eq, inArray, isNull, or, type SQL } from "drizzle-orm"
import { db } from "../connection.server"
import { monitoredApplications } from "../schema/applications"
import { routineControls, routineReviews, routineTechnologyElements } from "../schema/routines"
import {
	calculateDeadline,
	getEffectiveLastReviewDatesBatch,
	isOverdue,
	type ResolverOpts,
	type RoutineDeadlineInfo,
} from "./routines.server"

export type MatchSource =
	| "screening"
	| "persistence"
	| "group_classification"
	| "oracle_role_criticality"
	| "screening_selection"
	| "section"
	| "ruleset"

export interface DeadlineWithControls {
	routine:
		| (Omit<NonNullable<RoutineDeadlineInfo["routine"]>, "controls"> & {
				controls: Array<{ id: string }>
				technologyElementIds: string[]
		  })
		| null
	applicationId: string
	applicationName: string
	lastReviewDate: Date | null
	deadline: Date | null
	overdue: boolean
	needsFollowUp?: boolean
	matchedPersistenceLinks?: Array<{ persistenceType: string | null; dataClassification: string | null }>
	matchSource: MatchSource
	isSectionRoutine?: boolean
	sectionRoutineOwnerRole?: string | null
}

/**
 * Resolve all routine deadlines for an application, enriched with control and
 * technology-element mappings. This is the canonical pipeline that all compliance
 * consumers should use.
 */
export async function getRoutineDeadlinesWithControls(appId: string): Promise<DeadlineWithControls[]> {
	const {
		getRoutineDeadlinesForApp,
		getRoutineDeadlinesForAppByGroupClassification,
		getRoutineDeadlinesForAppByOracleRoleCriticality,
		getRoutineDeadlinesForAppByPersistence,
		getRoutineDeadlinesForAppByScreeningSelection,
		getRoutineDeadlinesForAppBySection,
		getRoutineDeadlinesForAppByRuleset,
	} = await import("./routines.server")

	const [appRow] = await db
		.select({ name: monitoredApplications.name })
		.from(monitoredApplications)
		.where(eq(monitoredApplications.id, appId))
		.limit(1)
	const appName = appRow?.name ?? ""
	const resolverOpts: ResolverOpts = { appName }

	// Step 1: Resolve all deadline sources with deduplication
	const screeningRoutines = await getRoutineDeadlinesForApp(appId, resolverOpts)
	const screeningRoutineIds = new Set(screeningRoutines.map((d) => d.routine?.id).filter(Boolean) as string[])

	const persistenceRoutines = await getRoutineDeadlinesForAppByPersistence(appId, screeningRoutineIds, resolverOpts)
	const afterPersistenceIds = new Set([
		...screeningRoutineIds,
		...(persistenceRoutines.map((d) => d.routine?.id).filter(Boolean) as string[]),
	])

	const groupClassificationRoutines = await getRoutineDeadlinesForAppByGroupClassification(
		appId,
		afterPersistenceIds,
		resolverOpts,
	)
	const afterGroupIds = new Set([
		...afterPersistenceIds,
		...(groupClassificationRoutines.map((d) => d.routine?.id).filter(Boolean) as string[]),
	])

	const oracleRoleCriticalityRoutines = await getRoutineDeadlinesForAppByOracleRoleCriticality(
		appId,
		afterGroupIds,
		resolverOpts,
	)
	const alreadyMatchedIds = new Set([
		...afterGroupIds,
		...(oracleRoleCriticalityRoutines.map((d) => d.routine?.id).filter(Boolean) as string[]),
	])

	const screeningSelectionRoutines = await getRoutineDeadlinesForAppByScreeningSelection(
		appId,
		alreadyMatchedIds,
		resolverOpts,
	)
	const allMatchedIds = new Set([
		...alreadyMatchedIds,
		...(screeningSelectionRoutines.map((d) => d.routine?.id).filter(Boolean) as string[]),
	])

	const sectionWideRoutines = await getRoutineDeadlinesForAppBySection(appId, allMatchedIds, resolverOpts)
	const allMatchedBeforeRuleset = new Set([
		...allMatchedIds,
		...(sectionWideRoutines.map((d) => d.routine?.id).filter(Boolean) as string[]),
	])

	const rulesetRoutines = await getRoutineDeadlinesForAppByRuleset(appId, allMatchedBeforeRuleset, resolverOpts)

	// Step 2: Tag each deadline with its match source
	const routineDeadlines = [
		...screeningRoutines.map((d) => ({ ...d, matchSource: "screening" as const })),
		...persistenceRoutines.map((d) => ({ ...d, matchSource: "persistence" as const })),
		...groupClassificationRoutines.map((d) => ({ ...d, matchSource: "group_classification" as const })),
		...oracleRoleCriticalityRoutines.map((d) => ({ ...d, matchSource: "oracle_role_criticality" as const })),
		...screeningSelectionRoutines.map((d) => ({ ...d, matchSource: "screening_selection" as const })),
		...sectionWideRoutines.map((d) => ({ ...d, matchSource: "section" as const })),
		...rulesetRoutines.map((d) => ({ ...d, matchSource: "ruleset" as const })),
	]

	// Step 3: Load routine → control and routine → technology element mappings
	const allRoutineIds = [...new Set(routineDeadlines.map((d) => d.routine?.id).filter(Boolean) as string[])]
	const routineControlsMap = new Map<string, Array<{ id: string }>>()
	const routineTechElementsMap = new Map<string, string[]>()

	if (allRoutineIds.length > 0) {
		const [controlRows, techElementRows] = await Promise.all([
			db
				.select({
					routineId: routineControls.routineId,
					controlId: routineControls.controlId,
				})
				.from(routineControls)
				.where(and(inArray(routineControls.routineId, allRoutineIds), isNull(routineControls.archivedAt))),
			db
				.select({
					routineId: routineTechnologyElements.routineId,
					elementId: routineTechnologyElements.elementId,
				})
				.from(routineTechnologyElements)
				.where(
					and(
						inArray(routineTechnologyElements.routineId, allRoutineIds),
						isNull(routineTechnologyElements.archivedAt),
					),
				),
		])

		for (const row of controlRows) {
			const list = routineControlsMap.get(row.routineId) ?? []
			list.push({ id: row.controlId })
			routineControlsMap.set(row.routineId, list)
		}
		for (const row of techElementRows) {
			const list = routineTechElementsMap.get(row.routineId) ?? []
			list.push(row.elementId)
			routineTechElementsMap.set(row.routineId, list)
		}
	}

	// Step 4: Enrich deadlines with control and technology element mappings
	const enriched: DeadlineWithControls[] = routineDeadlines.map((d) => ({
		...d,
		isSectionRoutine: d.routine?.isSectionRoutine === 1,
		sectionRoutineOwnerRole: d.routine?.sectionRoutineOwnerRole ?? null,
		needsFollowUp: false,
		routine: d.routine
			? {
					...d.routine,
					controls: routineControlsMap.get(d.routine.id) ?? [],
					technologyElementIds: routineTechElementsMap.get(d.routine.id) ?? [],
				}
			: d.routine,
	}))

	// Step 5: For section routines, override lastReviewDate with section-level review
	// Uses getEffectiveLastReviewDatesBatch (null applicationId) to respect deadlinePolicy
	// and correctly inherit reviews from replacement chains.
	const sectionRoutineRows = enriched
		.filter(
			(d): d is typeof d & { routine: NonNullable<typeof d.routine> } =>
				Boolean(d.isSectionRoutine) && d.routine != null,
		)
		.map((d) => ({ id: d.routine.id, sourceRoutineId: d.routine.sourceRoutineId }))

	if (sectionRoutineRows.length > 0) {
		const sectionReviewMap = await getEffectiveLastReviewDatesBatch(sectionRoutineRows, null)

		for (const d of enriched) {
			if (d.isSectionRoutine && d.routine) {
				const sectionReviewDate = sectionReviewMap.get(d.routine.id) ?? null
				d.lastReviewDate = sectionReviewDate
				d.deadline = calculateDeadline(sectionReviewDate, d.routine.createdAt, d.routine.frequency)
				d.overdue = isOverdue(d.deadline)
			}
		}
	}

	// Step 6: Compute `needsFollowUp` from any non-discarded review with status
	// `needs_follow_up`. Vi viser «Må følges opp»-badgen så lenge det finnes
	// minst én gjennomgang med uadresserte oppfølgingspunkter — ikke bare
	// dersom siste gjennomgang har den statusen.
	// For app-level routines: matcher på (routineId, applicationId).
	// For section-level routines: matcher på (routineId, applicationId IS NULL).
	const appLevelRoutineIds = enriched
		.filter((d): d is typeof d & { routine: NonNullable<typeof d.routine> } => !d.isSectionRoutine && d.routine != null)
		.map((d) => d.routine.id)
	const sectionRoutineIdsForFollowUp = enriched
		.filter(
			(d): d is typeof d & { routine: NonNullable<typeof d.routine> } =>
				Boolean(d.isSectionRoutine) && d.routine != null,
		)
		.map((d) => d.routine.id)

	if (appLevelRoutineIds.length > 0 || sectionRoutineIdsForFollowUp.length > 0) {
		const conditions: SQL[] = []
		if (appLevelRoutineIds.length > 0) {
			conditions.push(
				and(inArray(routineReviews.routineId, appLevelRoutineIds), eq(routineReviews.applicationId, appId)) as SQL,
			)
		}
		if (sectionRoutineIdsForFollowUp.length > 0) {
			conditions.push(
				and(
					inArray(routineReviews.routineId, sectionRoutineIdsForFollowUp),
					isNull(routineReviews.applicationId),
				) as SQL,
			)
		}
		const followUpReviews = await db
			.select({ routineId: routineReviews.routineId })
			.from(routineReviews)
			.where(and(or(...conditions), eq(routineReviews.status, "needs_follow_up")))

		const followUpRoutineIds = new Set(followUpReviews.map((r) => r.routineId))
		for (const d of enriched) {
			if (d.routine && followUpRoutineIds.has(d.routine.id)) {
				d.needsFollowUp = true
			}
		}
	}

	return enriched
}
