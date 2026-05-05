export interface ParsedParticipant {
	userIdent: string
	userName: string | null
}

function parseLegacyCommaSeparated(value: string): ParsedParticipant[] {
	return value
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean)
		.map((ident) => ({ userIdent: ident, userName: null }))
}

/**
 * Parses participants form value submitted by ParticipantsCombobox.
 * Accepts a JSON array (new format) or a comma-separated string (legacy
 * fallback). Trims, normalizes idents to uppercase, dedupes case-insensitively
 * and drops empty entries. Accepts any FormDataEntryValue or unknown shape and
 * safely returns [] for non-string input. If a JSON-looking value fails to
 * parse, falls back to the legacy comma-separated parser rather than silently
 * returning an empty list (which could wipe participants on update).
 */
export function parseParticipantsFormValue(raw: unknown): ParsedParticipant[] {
	if (typeof raw !== "string") return []
	const value = raw.trim()
	if (!value) return []

	let entries: ParsedParticipant[] = []
	if (value.startsWith("[")) {
		try {
			const parsed = JSON.parse(value) as Array<{ navIdent?: unknown; displayName?: unknown }>
			if (!Array.isArray(parsed)) {
				entries = parseLegacyCommaSeparated(value)
			} else {
				entries = parsed
					.map((p) => {
						const ident = typeof p?.navIdent === "string" ? p.navIdent.trim() : ""
						const name = typeof p?.displayName === "string" ? p.displayName.trim() : ""
						return { userIdent: ident, userName: name || null }
					})
					.filter((p) => p.userIdent.length > 0)
			}
		} catch {
			entries = parseLegacyCommaSeparated(value)
		}
	} else {
		entries = parseLegacyCommaSeparated(value)
	}

	const seen = new Set<string>()
	const result: ParsedParticipant[] = []
	for (const entry of entries) {
		const normalizedIdent = entry.userIdent.toUpperCase()
		if (seen.has(normalizedIdent)) continue
		seen.add(normalizedIdent)
		result.push({ userIdent: normalizedIdent, userName: entry.userName })
	}
	return result
}
