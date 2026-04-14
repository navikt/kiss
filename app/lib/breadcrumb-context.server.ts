import { getSectionBySlug, getTeamBySlug } from "~/db/queries/sections.server"

/**
 * Fetches section and team names for breadcrumb display in team-context routes.
 * Returns { seksjonName, teamName } to be merged into loader data.
 */
export async function getTeamBreadcrumbContext(seksjonSlug: string, teamSlug: string) {
	const [section, team] = await Promise.all([getSectionBySlug(seksjonSlug), getTeamBySlug(teamSlug)])
	return {
		seksjonName: section?.name ?? seksjonSlug,
		teamName: team?.name ?? teamSlug,
	}
}
