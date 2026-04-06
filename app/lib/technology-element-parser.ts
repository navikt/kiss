export interface ParsedTechnologyElement {
	name: string
	description: string | null
}

/**
 * Parses a comma/semicolon-separated technology element string,
 * respecting parenthesized descriptions.
 *
 * Text inside parentheses after an element name is extracted as a
 * description for that element — commas inside parentheses do NOT
 * split into separate elements.
 *
 * Example:
 *   "Active Directory, Applikasjon, Støtteverktøy (Eks. Passordhvelv, Git, Jira)"
 * Produces:
 *   [
 *     { name: "Active Directory", description: null },
 *     { name: "Applikasjon", description: null },
 *     { name: "Støtteverktøy", description: "Eks. Passordhvelv, Git, Jira" },
 *   ]
 */
export function parseTechnologyElements(text: string | null): ParsedTechnologyElement[] {
	if (!text) return []

	const results: ParsedTechnologyElement[] = []
	let current = ""
	let depth = 0

	for (const ch of text) {
		if (ch === "(") {
			depth++
			current += ch
		} else if (ch === ")") {
			depth = Math.max(0, depth - 1)
			current += ch
		} else if ((ch === "," || ch === ";") && depth === 0) {
			const parsed = extractNameAndDescription(current)
			if (parsed) results.push(parsed)
			current = ""
		} else {
			current += ch
		}
	}

	const parsed = extractNameAndDescription(current)
	if (parsed) results.push(parsed)

	return results
}

function extractNameAndDescription(raw: string): ParsedTechnologyElement | null {
	const trimmed = raw.trim()
	if (!trimmed) return null

	const match = trimmed.match(/^(.+?)\s*\((.+)\)\s*$/)
	if (match) {
		const name = match[1].trim()
		const description = match[2].trim()
		return name ? { name, description: description || null } : null
	}

	return { name: trimmed, description: null }
}
