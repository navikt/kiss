/**
 * Single source of truth for routine frequency values.
 *
 * Import from here instead of using string literals.
 * The schema in app/db/schema/routines.ts re-exports the enum array
 * for Drizzle column definitions.
 */

export const ROUTINE_FREQUENCIES = ["weekly", "monthly", "quarterly", "semi_annually", "annually"] as const

export type RoutineFrequency = (typeof ROUTINE_FREQUENCIES)[number]

/** Norwegian display labels for each frequency value. */
export const frequencyLabels: Record<RoutineFrequency, string> = {
	weekly: "Ukentlig",
	monthly: "Månedlig",
	quarterly: "Kvartalsvis",
	semi_annually: "Halvårlig",
	annually: "Årlig",
}

/** Approximate number of days per frequency period (for deadline calculation). */
export const frequencyDays: Record<RoutineFrequency, number> = {
	weekly: 7,
	monthly: 30,
	quarterly: 91,
	semi_annually: 182,
	annually: 365,
}

/** Type guard — returns true when the value is a valid RoutineFrequency. */
export function isRoutineFrequency(value: unknown): value is RoutineFrequency {
	return typeof value === "string" && (ROUTINE_FREQUENCIES as readonly string[]).includes(value)
}

/** Get the Norwegian label for a frequency value, with fallback. */
export function getFrequencyLabel(frequency: string | null | undefined, fallback = "Ukjent"): string {
	if (frequency && isRoutineFrequency(frequency)) return frequencyLabels[frequency]
	return fallback
}
