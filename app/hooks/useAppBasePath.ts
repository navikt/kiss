import { useLocation, useParams } from "react-router"

/**
 * Returns the base path for the current app context.
 * Extracts the URL prefix up to and including `/applikasjoner/:appId`,
 * so that links within app pages (detaljer, rediger, compliance, etc.)
 * preserve the navigation context (team, mine-team, or direct).
 *
 * Example outputs:
 *  - "/applikasjoner/abc-123"
 *  - "/seksjoner/pensjon/team/starte-pensjon/applikasjoner/abc-123"
 *  - "/mine-team/applikasjoner/abc-123"
 */
export function useAppBasePath(): string {
	const { appId } = useParams()
	const { pathname } = useLocation()

	if (!appId) return "/"

	const marker = `/applikasjoner/${appId}`
	const idx = pathname.indexOf(marker)
	if (idx !== -1) {
		return pathname.slice(0, idx + marker.length)
	}

	return `/applikasjoner/${appId}`
}
