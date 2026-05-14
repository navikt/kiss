/** Calculate compliance percentage from implementation counts.
 *  notRelevant assessments are excluded from the denominator. */
export function compliancePercent(implemented: number, partial: number, total: number, notRelevant = 0): number {
	const denominator = total - notRelevant
	return denominator > 0 ? Math.round(((implemented + partial * 0.5) / denominator) * 100) : 0
}

/** Create a URL-friendly slug from Norwegian text. */
export function slugify(text: string) {
	return text
		.toLowerCase()
		.replace(/[æ]/g, "ae")
		.replace(/[ø]/g, "oe")
		.replace(/[å]/g, "aa")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/(^-|-$)/g, "")
}

/** Safely parse JSON, returning undefined on invalid input. */
export function safeJsonParse(raw: string): unknown {
	try {
		return JSON.parse(raw)
	} catch {
		return undefined
	}
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Validate that a value is a valid UUID string. Accepts `unknown` for type-safe usage with formData/JSON. */
export function isValidUuid(value: unknown): value is string {
	return typeof value === "string" && UUID_RE.test(value)
}

/** Validate UUID format, throwing a 400 Response if invalid. Accepts `unknown` for type-safe usage with formData/JSON. */
export function requireUuid(value: unknown, label = "ID"): string {
	if (!isValidUuid(value)) throw new Response(`Ugyldig ${label}-format`, { status: 400 })
	return value
}

/** Format date-time in Norwegian locale and Europe/Oslo timezone. */
export function formatDateTimeOslo(value: string | Date): string {
	return new Date(value).toLocaleString("nb-NO", {
		timeZone: "Europe/Oslo",
	})
}
