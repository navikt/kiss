export function formatUserRef(navIdent: string, nameByNavIdent: ReadonlyMap<string, string>): string {
	const trimmed = navIdent.trim()
	const name = nameByNavIdent.get(trimmed.toUpperCase())
	return name ? `${name} (${trimmed})` : trimmed
}
