/**
 * Pure computation of routine-based compliance counts.
 *
 * - `routinesGjennomfort` / `routinesIkkeGjennomfort` / `routineCompliancePercent`:
 *   based on periodic routines only (frequency !== null). Event-only routines have
 *   no periodic deadline and do not affect the compliance percentage.
 *
 * - `routinesMaaFolgesOpp`: counts ALL routines with an unaddressed follow-up point,
 *   regardless of frequency, because an open follow-up is actionable even for
 *   event-only routines.
 */

type RoutineComplianceInput = {
	routine: { frequency: string | null } | null
	overdue: boolean
	lastReviewDate: Date | string | null
	needsFollowUp?: boolean
}

export type RoutineComplianceCounts = {
	routinesGjennomfort: number
	routinesIkkeGjennomfort: number
	routinesMaaFolgesOpp: number
	routineCompliancePercent: number
}

export function computeRoutineComplianceCounts(deadlines: RoutineComplianceInput[]): RoutineComplianceCounts {
	const periodic = deadlines.filter((d) => d.routine != null && d.routine.frequency !== null)
	const routinesGjennomfort = periodic.filter((d) => !d.overdue && d.lastReviewDate !== null).length
	const routinesIkkeGjennomfort = periodic.filter((d) => d.overdue || d.lastReviewDate === null).length
	// Count follow-up across all routines — an open follow-up is actionable regardless of frequency.
	const routinesMaaFolgesOpp = deadlines.filter((d) => d.needsFollowUp).length
	const routineCompliancePercent =
		routinesGjennomfort + routinesIkkeGjennomfort > 0
			? Math.round((routinesGjennomfort / (routinesGjennomfort + routinesIkkeGjennomfort)) * 100)
			: 0
	return { routinesGjennomfort, routinesIkkeGjennomfort, routinesMaaFolgesOpp, routineCompliancePercent }
}
