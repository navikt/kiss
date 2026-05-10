/**
 * Single source of truth for routine frequency values.
 *
 * Import from here instead of using string literals.
 * The schema in app/db/schema/routines.ts re-exports the enum array
 * for Drizzle column definitions.
 */

export const ROUTINE_FREQUENCIES = ["weekly", "monthly", "quarterly", "tertially", "semi_annually", "annually"] as const

export type RoutineFrequency = (typeof ROUTINE_FREQUENCIES)[number]

/** Norwegian display labels for each frequency value. */
export const frequencyLabels: Record<RoutineFrequency, string> = {
	weekly: "Ukentlig",
	monthly: "Månedlig",
	quarterly: "Kvartalsvis",
	tertially: "Tertialsvis",
	semi_annually: "Halvårlig",
	annually: "Årlig",
}

/** Approximate number of days per frequency period (for deadline calculation). */
export const frequencyDays: Record<RoutineFrequency, number> = {
	weekly: 7,
	monthly: 30,
	quarterly: 91,
	tertially: 122,
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

/**
 * Numeric rank for a frequency — lower means more frequent.
 * Used to compare and validate frequency choices.
 */
export function frequencyRank(freq: RoutineFrequency): number {
	return ROUTINE_FREQUENCIES.indexOf(freq)
}

/**
 * Map from control cronFrequency values to RoutineFrequency.
 * Controls store free-text frequency that gets derived into cronFrequency.
 */
const cronToRoutineFrequency: Record<string, RoutineFrequency> = {
	monthly: "monthly",
	quarterly: "quarterly",
	tertiary: "tertially",
	biannual: "semi_annually",
	annual: "annually",
}

/**
 * Parse a control's free-text frequency into a RoutineFrequency.
 * First tries matching Norwegian labels, then cronFrequency values.
 * Returns null if no match is found.
 */
export function parseControlFrequency(freqText: string | null | undefined): RoutineFrequency | null {
	if (!freqText) return null
	const lower = freqText.toLowerCase()

	// Direct match against Norwegian labels
	for (const [freq, label] of Object.entries(frequencyLabels)) {
		if (lower.includes(label.toLowerCase())) return freq as RoutineFrequency
	}

	// Match against cronFrequency values
	for (const [cron, routine] of Object.entries(cronToRoutineFrequency)) {
		if (lower.includes(cron)) return routine
	}

	return null
}

/**
 * Get the strictest (most frequent) RoutineFrequency from a list.
 * Returns null if the list is empty or contains no parseable values.
 */
export function getStrictestFrequency(frequencies: (string | null | undefined)[]): RoutineFrequency | null {
	let strictest: RoutineFrequency | null = null
	for (const f of frequencies) {
		const parsed = isRoutineFrequency(f) ? f : parseControlFrequency(f)
		if (!parsed) continue
		if (!strictest || frequencyRank(parsed) < frequencyRank(strictest)) {
			strictest = parsed
		}
	}
	return strictest
}

/**
 * Check if a frequency is at least as often as the minimum.
 * Returns true if freq is more frequent than or equal to minFreq.
 */
export function isFrequencyAtLeastAsOften(freq: RoutineFrequency, minFreq: RoutineFrequency): boolean {
	return frequencyRank(freq) <= frequencyRank(minFreq)
}

// ─── Event-based frequency ───────────────────────────────────────────────

/** Predefined event-based frequency suggestions (mirrors control framework). */
export const EVENT_FREQUENCY_SUGGESTIONS = [
	"Ved behov",
	"Ved endring",
	"Ved vesentlige endringer",
	"Kontinuerlig",
	"For hver produksjonssetting",
	"For hver ny bruker og/eller rettighet",
	"For hver bruker som slutter eller bytter roller/ansvar/oppgaver",
	"For hver endring",
	"Risikobasert",
] as const

export type EventFrequencySuggestion = (typeof EVENT_FREQUENCY_SUGGESTIONS)[number]

/**
 * Check if a routine is event-based only (no periodic frequency).
 * Event-only routines have no deadlines and are excluded from compliance counting.
 */
export function isEventOnlyRoutine(frequency: RoutineFrequency | null | undefined): frequency is null | undefined {
	return frequency === null || frequency === undefined
}

/** Composite frequency display label matching UI rendering logic. */
export function getCompositeFrequencyLabel(
	frequency: string | null | undefined,
	eventFrequency: string | null | undefined,
): string {
	if (frequency) {
		const label = getFrequencyLabel(frequency)
		return eventFrequency ? `${label} (også ${eventFrequency.toLowerCase()})` : label
	}
	return eventFrequency ?? "—"
}
