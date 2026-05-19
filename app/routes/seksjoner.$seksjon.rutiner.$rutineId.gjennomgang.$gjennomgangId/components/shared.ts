import { activityTypeLabels, type RoutineActivityType } from "~/lib/activity-types"

export type ReviewStep = {
	id: string
	label: string
	/** Whether this step is conditionally hidden */
	hidden?: boolean
}

export type ActivityStepInfo = {
	id: string
	activityType: RoutineActivityType
}

/**
 * Builds the list of wizard steps, conditionally including/excluding
 * steps based on routine configuration. Generates one step per activity.
 */
export function buildSteps(options: {
	hasControls: boolean
	hasRulesets: boolean
	activities: ActivityStepInfo[]
}): ReviewStep[] {
	const activitySteps: ReviewStep[] = options.activities.map((activity, index) => ({
		id: `aktivitet-${index}`,
		label: activityTypeLabels[activity.activityType],
	}))

	const steps: ReviewStep[] = [
		{ id: "innledning", label: "Innledning" },
		{ id: "krav", label: "Krav", hidden: !options.hasControls },
		{ id: "regelsett", label: "Regelsett", hidden: !options.hasRulesets },
		{ id: "rutine", label: "Rutine" },
		...activitySteps,
		{ id: "dokumentasjon", label: "Dokumentasjon" },
		{ id: "oppfolging", label: "Oppfølgingspunkter" },
		{ id: "fullfor", label: "Fullfør" },
	]
	return steps.filter((s) => !s.hidden)
}

export function getStepIndex(steps: ReviewStep[], stepId: string): number {
	return steps.findIndex((s) => s.id === stepId)
}

/** Parses an activity step ID (e.g., "aktivitet-2") and returns the index, or null if not an activity step. */
export function parseActivityStepIndex(stepId: string): number | null {
	const match = stepId.match(/^aktivitet-(\d+)$/)
	return match ? Number.parseInt(match[1], 10) : null
}
