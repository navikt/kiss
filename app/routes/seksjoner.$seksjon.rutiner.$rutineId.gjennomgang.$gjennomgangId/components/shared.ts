export type ReviewStep = {
	id: string
	label: string
	/** Whether this step is conditionally hidden */
	hidden?: boolean
}

/**
 * Builds the list of wizard steps, conditionally including/excluding
 * steps based on routine configuration.
 */
export function buildSteps(options: {
	hasControls: boolean
	hasRulesets: boolean
	hasActivity: boolean
}): ReviewStep[] {
	const steps: ReviewStep[] = [
		{ id: "innledning", label: "Innledning" },
		{ id: "krav", label: "Krav", hidden: !options.hasControls },
		{ id: "regelsett", label: "Regelsett", hidden: !options.hasRulesets },
		{ id: "rutine", label: "Rutine" },
		{ id: "aktivitet", label: "Vedlikeholdsaktivitet", hidden: !options.hasActivity },
		{ id: "dokumentasjon", label: "Dokumentasjon" },
		{ id: "oppfolging", label: "Oppfølgingspunkter" },
		{ id: "fullfor", label: "Fullfør" },
	]
	return steps.filter((s) => !s.hidden)
}

export function getStepIndex(steps: ReviewStep[], stepId: string): number {
	return steps.findIndex((s) => s.id === stepId)
}
