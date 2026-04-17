import { useLocation } from "react-router"

/**
 * Returns the section slug from the current URL, if present.
 * Looks for the pattern `/seksjoner/:seksjon/` in the pathname.
 *
 * Example outputs:
 *  - "pensjon-og-ufore"  (from /seksjoner/pensjon-og-ufore/team/...)
 *  - null                (from /applikasjoner/... without section context)
 */
export function useSectionSlug(): string | null {
	const { pathname } = useLocation()
	const match = pathname.match(/\/seksjoner\/([^/]+)/)
	return match ? match[1] : null
}
