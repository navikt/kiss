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
