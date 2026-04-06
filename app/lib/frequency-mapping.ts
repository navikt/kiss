/** Mapping from cronFrequency values to Norwegian labels. */
export const cronFrequencyLabels: Record<string, string> = {
	monthly: "Månedlig",
	quarterly: "Kvartalsvis",
	tertiary: "Tertialsvis",
	biannual: "Halvårsvis",
	annual: "Årlig",
}

/** Reverse mapping: Norwegian label (lowercase) → cronFrequency value. */
export const labelToCronFrequency: Record<string, string> = Object.fromEntries(
	Object.entries(cronFrequencyLabels).map(([value, label]) => [label.toLowerCase(), value]),
)

/**
 * Derive a cronFrequency value from free-text frequency.
 * Matches if the text contains one of the known labels (case-insensitive).
 * Returns `null` if no match is found.
 */
export function deriveCronFrequency(frequencyText: string | null): string | null {
	if (!frequencyText) return null
	const lower = frequencyText.toLowerCase()
	for (const [label, value] of Object.entries(labelToCronFrequency)) {
		if (lower.includes(label)) return value
	}
	return null
}
