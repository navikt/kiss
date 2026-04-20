/**
 * Automatic compliance status computation.
 *
 * Derives a suggested compliance status per (control, technologyElement) for an application
 * based on routine matching and screening effects. This is computed on-the-fly and never
 * persisted.
 *
 * Two-dimensional model:
 * - Akse 1 (establishment): Has the control got a matching routine?
 * - Akse 2 (compliance): Has the routine been executed on time?
 */
import type { ComplianceStatus, RoutineCompliance, RoutineEstablishment } from "./compliance-status"

export interface AutoComplianceResult {
	/** The automatically derived compliance status, or null if undeterminable */
	autoStatus: ComplianceStatus | null
	/** Human-readable reason for the auto-status */
	reason: string
	/** Which matching source(s) contributed */
	sources: Array<"screening" | "persistence" | "group_classification" | "screening_selection" | "section" | "ruleset">
	/** IDs of matching routines */
	matchingRoutineIds: string[]
	/** Whether at least one matching routine is overdue */
	hasOverdueRoutine: boolean

	// ─── Two-dimensional model ───────────────────────────────────
	/** Akse 1: Er en rutine etablert for denne kontrollen? */
	establishment: RoutineEstablishment
	/** Akse 2: Er rutinen gjennomført i henhold til frist? */
	compliance: RoutineCompliance
	/** Antall rutiner som er koblet til kontrollen */
	routinesEstablished: number
	/** Antall rutiner gjennomført innen frist */
	routinesCompleted: number
	/** Antall rutiner som er forfalt */
	routinesOverdue: number

	// ─── Screening details ──────────────────────────────────────
	/** Which screening questions/answers contributed to this status */
	screeningDetails: Array<{ questionTitle: string; answer: string; effect: string }>
}

interface RoutineMatch {
	routineId: string
	controlIds: string[]
	technologyElementIds: string[]
	matchSource: "screening" | "persistence" | "group_classification" | "screening_selection" | "section" | "ruleset"
	overdue: boolean
	lastReviewDate: Date | null
}

interface ScreeningEffectsForControl {
	effects: string[]
	allQuestionsAnswered: boolean
	hasQuestions: boolean
	details: Array<{ questionTitle: string; answer: string; effect: string }>
}

/**
 * Compute auto-compliance status for all (control, techElement) assessment pairs.
 *
 * Takes already-loaded data (routine deadlines + screening effects) and returns
 * a map keyed by `${controlUuid}:${technologyElementId ?? "null"}`.
 *
 * Rules:
 * - "not_relevant": No routines match via any path + screening explicitly says not_relevant
 * - "implemented": At least one routine matches + no screening says "not_implemented"
 * - "partially_implemented": Routine matches but is overdue
 * - "not_implemented": Routine matches but never reviewed, or screening says not_implemented
 * - null: Cannot determine (no screening data and no routine matches)
 */
export function computeAutoCompliance(
	assessments: Array<{
		controlUuid: string
		technologyElementId: string | null
		status: ComplianceStatus | null
	}>,
	routineDeadlines: Array<{
		routine: {
			id: string
			controls?: Array<{ id: string }>
			technologyElementIds?: string[]
		} | null
		matchSource: "screening" | "persistence" | "group_classification" | "screening_selection" | "section" | "ruleset"
		overdue: boolean
		lastReviewDate: Date | null
	}>,
	screeningEffectsByControl: Map<string, ScreeningEffectsForControl>,
): Map<string, AutoComplianceResult> {
	// Step 1: Build routine → control mapping
	const routineMatches: RoutineMatch[] = []
	for (const dl of routineDeadlines) {
		if (!dl.routine) continue
		const controlIds = (dl.routine.controls ?? []).map((c) => c.id)
		routineMatches.push({
			routineId: dl.routine.id,
			controlIds,
			technologyElementIds: dl.routine.technologyElementIds ?? [],
			matchSource: dl.matchSource,
			overdue: dl.overdue,
			lastReviewDate: dl.lastReviewDate,
		})
	}

	// Step 2: Group routine matches by control UUID
	const routinesByControl = new Map<string, RoutineMatch[]>()
	for (const match of routineMatches) {
		for (const controlId of match.controlIds) {
			const list = routinesByControl.get(controlId) ?? []
			list.push(match)
			routinesByControl.set(controlId, list)
		}
	}

	// Step 3: Compute auto-status for each assessment
	const result = new Map<string, AutoComplianceResult>()

	for (const assessment of assessments) {
		const key = `${assessment.controlUuid}:${assessment.technologyElementId ?? "null"}`
		const controlRoutines = routinesByControl.get(assessment.controlUuid) ?? []

		// Filter routines by technology element:
		// - Routines with NO tech elements → match all assessment rows (general routine)
		// - Routines WITH tech elements → only match assessment rows whose technologyElementId is in the list
		const filteredRoutines = controlRoutines.filter((r) => {
			if (r.technologyElementIds.length === 0) return true
			if (!assessment.technologyElementId) return true
			return r.technologyElementIds.includes(assessment.technologyElementId)
		})

		const screening = screeningEffectsByControl.get(assessment.controlUuid)

		const autoResult = computeStatusForAssessment(filteredRoutines, screening)
		result.set(key, autoResult)
	}

	return result
}

function computeStatusForAssessment(
	controlRoutines: RoutineMatch[],
	screening: ScreeningEffectsForControl | undefined,
): AutoComplianceResult {
	const hasRoutines = controlRoutines.length > 0
	const hasScreening = screening?.hasQuestions ?? false
	const screeningDetails = screening?.details ?? []

	// Two-dimensional counts
	const routinesEstablished = new Set(controlRoutines.map((r) => r.routineId)).size
	const routinesCompleted = new Set(
		controlRoutines.filter((r) => r.lastReviewDate !== null && !r.overdue).map((r) => r.routineId),
	).size
	const routinesOverdue = new Set(controlRoutines.filter((r) => r.overdue).map((r) => r.routineId)).size

	// Case 1: No data at all — cannot determine
	if (!hasRoutines && !hasScreening) {
		return {
			autoStatus: null,
			reason: "Ingen rutiner eller screeningspørsmål treffer denne kontrollen",
			sources: [],
			matchingRoutineIds: [],
			hasOverdueRoutine: false,
			establishment: "not_established",
			compliance: "not_applicable",
			routinesEstablished: 0,
			routinesCompleted: 0,
			routinesOverdue: 0,
			screeningDetails,
		}
	}

	// Case 2: No routines match, but screening exists
	if (!hasRoutines && hasScreening) {
		if (!screening?.allQuestionsAnswered) {
			return {
				autoStatus: null,
				reason: "Screeningspørsmål er ikke ferdig besvart",
				sources: [],
				matchingRoutineIds: [],
				hasOverdueRoutine: false,
				establishment: "not_established",
				compliance: "not_applicable",
				routinesEstablished: 0,
				routinesCompleted: 0,
				routinesOverdue: 0,
				screeningDetails,
			}
		}

		// All screening questions answered — check what the effects say
		const effects = screening?.effects
		if (effects.length === 0) {
			return {
				autoStatus: null,
				reason: "Screeningsvar ga ingen effekter for denne kontrollen",
				sources: [],
				matchingRoutineIds: [],
				hasOverdueRoutine: false,
				establishment: "not_established",
				compliance: "not_applicable",
				routinesEstablished: 0,
				routinesCompleted: 0,
				routinesOverdue: 0,
				screeningDetails,
			}
		}

		const allNotRelevant = effects.every((e) => e === "not_relevant")
		if (allNotRelevant) {
			return {
				autoStatus: "not_relevant",
				reason: "Alle screeningsvar indikerer at kontrollen ikke er relevant",
				sources: [],
				matchingRoutineIds: [],
				hasOverdueRoutine: false,
				establishment: "not_relevant",
				compliance: "not_applicable",
				routinesEstablished: 0,
				routinesCompleted: 0,
				routinesOverdue: 0,
				screeningDetails,
			}
		}

		const anyNotImplemented = effects.some((e) => e === "not_implemented")
		if (anyNotImplemented) {
			return {
				autoStatus: "not_implemented",
				reason: "Screeningsvar indikerer at kontrollen ikke er implementert",
				sources: [],
				matchingRoutineIds: [],
				hasOverdueRoutine: false,
				establishment: "not_established",
				compliance: "not_applicable",
				routinesEstablished: 0,
				routinesCompleted: 0,
				routinesOverdue: 0,
				screeningDetails,
			}
		}

		const allImplemented = effects.every((e) => e === "implemented" || e === "partially_implemented")
		if (allImplemented) {
			const hasPartial = effects.some((e) => e === "partially_implemented")
			return {
				autoStatus: hasPartial ? "partially_implemented" : "implemented",
				reason: hasPartial
					? "Screeningsvar indikerer delvis implementering"
					: "Screeningsvar indikerer full implementering",
				sources: [],
				matchingRoutineIds: [],
				hasOverdueRoutine: false,
				establishment: "not_established",
				compliance: "not_applicable",
				routinesEstablished: 0,
				routinesCompleted: 0,
				routinesOverdue: 0,
				screeningDetails,
			}
		}

		return {
			autoStatus: "partially_implemented",
			reason: "Blandede screeningsvar for denne kontrollen",
			sources: [],
			matchingRoutineIds: [],
			hasOverdueRoutine: false,
			establishment: "not_established",
			compliance: "not_applicable",
			routinesEstablished: 0,
			routinesCompleted: 0,
			routinesOverdue: 0,
			screeningDetails,
		}
	}

	// Case 3: Routines match (with or without screening)
	const sources = [...new Set(controlRoutines.map((r) => r.matchSource))]
	const matchingRoutineIds = [...new Set(controlRoutines.map((r) => r.routineId))]
	const hasOverdueRoutine = controlRoutines.some((r) => r.overdue)
	const allOverdue = controlRoutines.every((r) => r.overdue)
	const anyNeverReviewed = controlRoutines.some((r) => r.lastReviewDate === null)

	// Base two-dimensional fields for established routines
	const baseDimensions = {
		establishment: "established" as RoutineEstablishment,
		routinesEstablished,
		routinesCompleted,
		routinesOverdue,
	}

	// Check if screening contradicts
	if (hasScreening && screening) {
		const allNotRelevant = screening.effects.every((e) => e === "not_relevant")
		if (allNotRelevant && screening.effects.length > 0 && screening.allQuestionsAnswered) {
			// Screening explicitly says not relevant — this is a conscious human decision
			// that should override automatic routine matching
			return {
				autoStatus: "not_relevant",
				reason: "Screeningsvar indikerer at kontrollen ikke er relevant",
				sources: [],
				matchingRoutineIds: [],
				hasOverdueRoutine: false,
				establishment: "not_relevant",
				compliance: "not_applicable",
				routinesEstablished: 0,
				routinesCompleted: 0,
				routinesOverdue: 0,
				screeningDetails,
			}
		}

		const anyNotImplemented = screening.effects.some((e) => e === "not_implemented")
		if (anyNotImplemented) {
			return {
				autoStatus: "not_implemented",
				reason: "Screeningsvar indikerer at kontrollen ikke er implementert",
				sources,
				matchingRoutineIds,
				hasOverdueRoutine,
				...baseDimensions,
				compliance: "never_reviewed",
				screeningDetails,
			}
		}
	}

	// All routines have never been reviewed
	if (anyNeverReviewed && controlRoutines.every((r) => r.lastReviewDate === null)) {
		if (allOverdue) {
			return {
				autoStatus: "not_implemented",
				reason: "Rutiner treffer men er aldri gjennomgått og forfalt",
				sources,
				matchingRoutineIds,
				hasOverdueRoutine: true,
				...baseDimensions,
				compliance: "never_reviewed",
				screeningDetails,
			}
		}
		return {
			autoStatus: "partially_implemented",
			reason: "Rutiner treffer men er ikke gjennomgått ennå",
			sources,
			matchingRoutineIds,
			hasOverdueRoutine: false,
			...baseDimensions,
			compliance: "never_reviewed",
			screeningDetails,
		}
	}

	// All matching routines are overdue (but at least some have been reviewed before)
	if (allOverdue) {
		return {
			autoStatus: "partially_implemented",
			reason: "Rutiner treffer men alle er forfalt",
			sources,
			matchingRoutineIds,
			hasOverdueRoutine: true,
			...baseDimensions,
			compliance: "overdue",
			screeningDetails,
		}
	}

	// Some overdue, some not
	if (hasOverdueRoutine) {
		return {
			autoStatus: "partially_implemented",
			reason: "Noen rutiner er forfalt",
			sources,
			matchingRoutineIds,
			hasOverdueRoutine: true,
			...baseDimensions,
			compliance: "overdue",
			screeningDetails,
		}
	}

	// Routines match, screening OK or absent, no overdue — implemented
	return {
		autoStatus: "implemented",
		reason: "Rutiner dekker denne kontrollen",
		sources,
		matchingRoutineIds,
		hasOverdueRoutine: false,
		...baseDimensions,
		compliance: "completed",
		screeningDetails,
	}
}
