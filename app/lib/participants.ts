/**
 * Adds a NAV-ident to a comma-separated list of participants, deduplicating
 * case-insensitively. Returns the updated string.
 */
export function addParticipant(current: string, navIdent: string): string {
	const idents = current
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean)
	if (idents.some((i) => i.toUpperCase() === navIdent.toUpperCase())) return current
	idents.push(navIdent)
	return idents.join(", ")
}
