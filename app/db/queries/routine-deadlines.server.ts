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
import { and, inArray, isNull } from "drizzle-orm"
import { db } from "../connection.server"
import { routineControls, routineTechnologyElements } from "../schema/routines"
import type { RoutineDeadlineInfo } from "./routines.server"

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
	deadline: Date
	overdue: boolean
	matchedPersistenceLinks?: Array<{ persistenceType: string | null; dataClassification: string | null }>
	matchSource: MatchSource
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

	// Step 1: Resolve all deadline sources with deduplication
	const screeningRoutines = await getRoutineDeadlinesForApp(appId)
	const screeningRoutineIds = new Set(screeningRoutines.map((d) => d.routine?.id).filter(Boolean) as string[])

	const persistenceRoutines = await getRoutineDeadlinesForAppByPersistence(appId, screeningRoutineIds)
	const afterPersistenceIds = new Set([
		...screeningRoutineIds,
		...(persistenceRoutines.map((d) => d.routine?.id).filter(Boolean) as string[]),
	])

	const groupClassificationRoutines = await getRoutineDeadlinesForAppByGroupClassification(appId, afterPersistenceIds)
	const afterGroupIds = new Set([
		...afterPersistenceIds,
		...(groupClassificationRoutines.map((d) => d.routine?.id).filter(Boolean) as string[]),
	])

	const oracleRoleCriticalityRoutines = await getRoutineDeadlinesForAppByOracleRoleCriticality(appId, afterGroupIds)
	const alreadyMatchedIds = new Set([
		...afterGroupIds,
		...(oracleRoleCriticalityRoutines.map((d) => d.routine?.id).filter(Boolean) as string[]),
	])

	const screeningSelectionRoutines = await getRoutineDeadlinesForAppByScreeningSelection(appId, alreadyMatchedIds)
	const allMatchedIds = new Set([
		...alreadyMatchedIds,
		...(screeningSelectionRoutines.map((d) => d.routine?.id).filter(Boolean) as string[]),
	])

	const sectionWideRoutines = await getRoutineDeadlinesForAppBySection(appId, allMatchedIds)
	const allMatchedBeforeRuleset = new Set([
		...allMatchedIds,
		...(sectionWideRoutines.map((d) => d.routine?.id).filter(Boolean) as string[]),
	])

	const rulesetRoutines = await getRoutineDeadlinesForAppByRuleset(appId, allMatchedBeforeRuleset)

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
	return routineDeadlines.map((d) => ({
		...d,
		routine: d.routine
			? {
					...d.routine,
					controls: routineControlsMap.get(d.routine.id) ?? [],
					technologyElementIds: routineTechElementsMap.get(d.routine.id) ?? [],
				}
			: d.routine,
	})) satisfies DeadlineWithControls[]
}
