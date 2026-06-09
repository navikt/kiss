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
import { and, eq, inArray, isNull, or, type SQL } from "drizzle-orm"
import { db } from "../connection.server"
import { monitoredApplications } from "../schema/applications"
import { frameworkControls } from "../schema/framework"
import type { ReviewStatus } from "../schema/routines"
import { routineControls, routineReviews, routineTechnologyElements } from "../schema/routines"
import {
	screeningChoiceEffects,
	screeningQuestionChoices,
	screeningQuestions,
	screeningRoutineSelections,
} from "../schema/screening"
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
				controls: Array<{ id: string; controlId: string; shortTitle: string | null }>
				technologyElementIds: string[]
		  })
		| null
	applicationId: string
	applicationName: string
	lastReviewDate: Date | null
	deadline: Date | null
	overdue: boolean
	needsFollowUp?: boolean
	draftReviewId?: string
	matchedPersistenceLinks?: RoutineDeadlineInfo["matchedPersistenceLinks"]
	matchedTechElements?: RoutineDeadlineInfo["matchedTechElements"]
	matchedOracleCriticalities?: RoutineDeadlineInfo["matchedOracleCriticalities"]
	matchSource: MatchSource
	isSectionRoutine?: boolean
	sectionRoutineOwnerRole?: string | null
	screeningSelectionQuestion?: { id: string; questionText: string; sectionId: string | null } | null
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

	// Fetch the screening question that triggered each screening_selection routine for this app
	const screeningSelectionQuestionRows =
		screeningSelectionRoutines.length > 0
			? await db
					.select({
						routineId: screeningRoutineSelections.routineId,
						questionId: screeningQuestions.id,
						questionText: screeningQuestions.questionText,
						sectionId: screeningQuestions.sectionId,
					})
					.from(screeningRoutineSelections)
					.innerJoin(screeningChoiceEffects, eq(screeningRoutineSelections.choiceEffectId, screeningChoiceEffects.id))
					.innerJoin(screeningQuestionChoices, eq(screeningChoiceEffects.choiceId, screeningQuestionChoices.id))
					.innerJoin(screeningQuestions, eq(screeningQuestionChoices.questionId, screeningQuestions.id))
					.where(
						and(eq(screeningRoutineSelections.applicationId, appId), isNull(screeningRoutineSelections.archivedAt)),
					)
			: []
	const screeningSelectionQuestionMap = new Map<
		string,
		{ id: string; questionText: string; sectionId: string | null }
	>()
	for (const row of screeningSelectionQuestionRows) {
		if (row.routineId && !screeningSelectionQuestionMap.has(row.routineId)) {
			screeningSelectionQuestionMap.set(row.routineId, {
				id: row.questionId,
				questionText: row.questionText,
				sectionId: row.sectionId,
			})
		}
	}

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
		...screeningSelectionRoutines.map((d) => ({
			...d,
			matchSource: "screening_selection" as const,
			screeningSelectionQuestion: d.routine ? (screeningSelectionQuestionMap.get(d.routine.id) ?? null) : null,
		})),
		...sectionWideRoutines.map((d) => ({ ...d, matchSource: "section" as const })),
		...rulesetRoutines.map((d) => ({ ...d, matchSource: "ruleset" as const })),
	]

	// Step 3: Load routine → control and routine → technology element mappings
	const allRoutineIds = [...new Set(routineDeadlines.map((d) => d.routine?.id).filter(Boolean) as string[])]
	const routineControlsMap = new Map<string, Array<{ id: string; controlId: string; shortTitle: string | null }>>()
	const routineTechElementsMap = new Map<string, string[]>()

	if (allRoutineIds.length > 0) {
		const [controlRows, techElementRows] = await Promise.all([
			db
				.select({
					routineId: routineControls.routineId,
					id: routineControls.controlId,
					controlId: frameworkControls.controlId,
					shortTitle: frameworkControls.shortTitle,
				})
				.from(routineControls)
				.innerJoin(frameworkControls, eq(routineControls.controlId, frameworkControls.id))
				.where(
					and(
						inArray(routineControls.routineId, allRoutineIds),
						isNull(routineControls.archivedAt),
						isNull(frameworkControls.archivedAt),
					),
				),
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
			list.push({ id: row.id, controlId: row.controlId, shortTitle: row.shortTitle })
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
				d.deadline = calculateDeadline(
					sectionReviewDate,
					d.routine.approvedAt ?? d.routine.createdAt,
					d.routine.frequency,
				)
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

	// Step 7: Fetch active draft reviews for all routines and attach draftReviewId
	if (allRoutineIds.length > 0) {
		const draftConditions: SQL[] = []
		if (appLevelRoutineIds.length > 0) {
			draftConditions.push(
				and(inArray(routineReviews.routineId, appLevelRoutineIds), eq(routineReviews.applicationId, appId)) as SQL,
			)
		}
		if (sectionRoutineIdsForFollowUp.length > 0) {
			draftConditions.push(
				and(
					inArray(routineReviews.routineId, sectionRoutineIdsForFollowUp),
					isNull(routineReviews.applicationId),
				) as SQL,
			)
		}
		if (draftConditions.length > 0) {
			const draftReviews = await db
				.select({ routineId: routineReviews.routineId, id: routineReviews.id })
				.from(routineReviews)
				.where(and(or(...draftConditions), eq(routineReviews.status, "draft" as ReviewStatus)))
			const draftReviewMap = new Map<string, string>()
			for (const r of draftReviews) {
				if (!draftReviewMap.has(r.routineId)) draftReviewMap.set(r.routineId, r.id)
			}
			for (const d of enriched) {
				if (d.routine) {
					const draftId = draftReviewMap.get(d.routine.id)
					if (draftId) d.draftReviewId = draftId
				}
			}
		}
	}

	return enriched
}
