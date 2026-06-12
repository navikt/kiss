import { activityTypeLabels, type RoutineActivityType } from "~/lib/activity-types"

export type ActionResult = {
	success: boolean
	error?: string
	intent?: string
	pointId?: string
}

export type ActivityProp = {
	id: string
	type: RoutineActivityType
	status: string
	completedAt: string | null
	createdAt: string
	changes: Array<{
		id: string
		changeType: string
		groupId: string
		groupName: string | null
		previousValue: string | null
		newValue: string | null
		performedBy: string
		performedAt: string
	}>
}

export type ReviewStep = {
	id: string
	label: string
	/** Whether this step is conditionally hidden */
	hidden?: boolean
}

export type ActivityStepInfo = {
	id: string
	activityType: RoutineActivityType
	/** For manual_activity: the ordered list of steps from staged_data */
	activitySteps?: Array<{ stepId: string; title: string }>
}

/**
 * Builds the list of wizard steps, conditionally including/excluding
 * steps based on routine configuration. Generates one step per activity,
 * except for manual_activity which expands into one step per checklist item.
 */
export function buildSteps(options: {
	hasControls: boolean
	hasRulesets: boolean
	activities: ActivityStepInfo[]
}): ReviewStep[] {
	const activitySteps: ReviewStep[] = []
	for (const activity of options.activities) {
		if (activity.activityType === "manual_activity" && activity.activitySteps?.length) {
			for (const step of activity.activitySteps) {
				activitySteps.push({ id: `sjekkliste-steg-${step.stepId}`, label: step.title })
			}
		} else {
			activitySteps.push({ id: `aktivitet-${activitySteps.length}`, label: activityTypeLabels[activity.activityType] })
		}
	}

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

/** Parses a checklist step ID (e.g., "sjekkliste-steg-<uuid>") and returns the stepId, or null. */
export function parseActivityStepId(stepId: string): string | null {
	const match = stepId.match(/^sjekkliste-steg-([0-9a-f-]{36})$/i)
	return match ? match[1] : null
}
