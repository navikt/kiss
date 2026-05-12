import { and, eq, ilike, inArray, isNull, or } from "drizzle-orm"
import type { LoaderFunctionArgs } from "react-router"
import { db } from "~/db/connection.server"
import { getControlDomainMap } from "~/db/queries/framework.server"
import {
	applicationTeamMappings,
	devTeams,
	frameworkControls,
	frameworkDomains,
	frameworkRisks,
	monitoredApplications,
	naisTeams,
	sections,
} from "~/db/schema"

interface SearchResult {
	type: "application" | "team" | "section" | "risk" | "control"
	id: string
	url: string
	title: string
	subtitle?: string
	teams?: Array<{ teamSlug: string; sectionSlug: string }>
}

/** Score a result by how closely it matches the query (lower = better). */
function searchScore(name: string, query: string): number {
	const n = name.toLowerCase()
	const q = query.toLowerCase()

	if (n === q) return 0
	if (n.startsWith(q)) return 1 + n.length / 1000
	// Word-boundary match (segment after - or space starts with query)
	const segments = n.split(/[-\s]/)
	if (segments.some((s) => s === q)) return 2 + n.length / 1000
	if (segments.some((s) => s.startsWith(q))) return 3 + n.length / 1000
	// Contains anywhere
	const idx = n.indexOf(q)
	if (idx >= 0) return 4 + idx / n.length + n.length / 1000
	return 100
}

export async function loader({ request }: LoaderFunctionArgs) {
	const url = new URL(request.url)
	const query = url.searchParams.get("q")?.trim()

	if (!query || query.length < 2) {
		return Response.json({ results: [] })
	}

	const pattern = `%${query}%`
	const limit = 200

	const [appResults, teamResults, sectionResults, riskResults, controlResults] = await Promise.all([
		// Applications
		db
			.select({
				id: monitoredApplications.id,
				name: monitoredApplications.name,
				description: monitoredApplications.description,
			})
			.from(monitoredApplications)
			.where(
				and(
					isNull(monitoredApplications.archivedAt),
					or(ilike(monitoredApplications.name, pattern), ilike(monitoredApplications.description, pattern)),
				),
			)
			.limit(limit),

		// Nais teams
		db
			.select({
				slug: naisTeams.slug,
				displayName: naisTeams.displayName,
			})
			.from(naisTeams)
			.where(or(ilike(naisTeams.slug, pattern), ilike(naisTeams.displayName, pattern)))
			.limit(limit),

		// Sections
		db
			.select({
				id: sections.id,
				slug: sections.slug,
				name: sections.name,
				description: sections.description,
			})
			.from(sections)
			.where(or(ilike(sections.name, pattern), ilike(sections.slug, pattern), ilike(sections.description, pattern)))
			.limit(limit),

		// Risks (join with domains to get domain code)
		db
			.select({
				id: frameworkRisks.id,
				riskId: frameworkRisks.riskId,
				description: frameworkRisks.description,
				shortTitle: frameworkRisks.shortTitle,
				domainCode: frameworkDomains.code,
				domainName: frameworkDomains.name,
			})
			.from(frameworkRisks)
			.innerJoin(frameworkDomains, eq(frameworkRisks.domainId, frameworkDomains.id))
			.where(
				or(
					ilike(frameworkRisks.riskId, pattern),
					ilike(frameworkRisks.description, pattern),
					ilike(frameworkRisks.shortTitle, pattern),
				),
			)
			.limit(limit),

		// Controls (domain derived from risks)
		db
			.select({
				id: frameworkControls.id,
				controlId: frameworkControls.controlId,
				requirement: frameworkControls.requirement,
				shortTitle: frameworkControls.shortTitle,
				technologyElement: frameworkControls.technologyElement,
			})
			.from(frameworkControls)
			.where(
				and(
					isNull(frameworkControls.archivedAt),
					or(
						ilike(frameworkControls.controlId, pattern),
						ilike(frameworkControls.shortTitle, pattern),
						ilike(frameworkControls.requirement, pattern),
						ilike(frameworkControls.technologyElement, pattern),
					),
				),
			)
			.limit(limit),
	])

	// Batch-lookup domains for controls via risk mappings
	const controlUuids = controlResults.map((c: (typeof controlResults)[number]) => c.id)
	const controlDomains = await getControlDomainMap(controlUuids)

	// Batch-lookup team/section memberships for applications
	const appIds = appResults.map((a: (typeof appResults)[number]) => a.id)
	const appTeamRows =
		appIds.length > 0
			? await db
					.select({
						applicationId: applicationTeamMappings.applicationId,
						teamSlug: devTeams.slug,
						sectionSlug: sections.slug,
					})
					.from(applicationTeamMappings)
					.innerJoin(devTeams, eq(applicationTeamMappings.devTeamId, devTeams.id))
					.innerJoin(sections, eq(devTeams.sectionId, sections.id))
					.where(
						and(inArray(applicationTeamMappings.applicationId, appIds), isNull(applicationTeamMappings.archivedAt)),
					)
			: []

	const teamsByApp = new Map<string, Array<{ teamSlug: string; sectionSlug: string }>>()
	for (const row of appTeamRows) {
		const list = teamsByApp.get(row.applicationId) ?? []
		list.push({ teamSlug: row.teamSlug, sectionSlug: row.sectionSlug })
		teamsByApp.set(row.applicationId, list)
	}

	const results: SearchResult[] = [
		...appResults.map((app: (typeof appResults)[number]) => ({
			type: "application" as const,
			id: app.id,
			url: `/applikasjoner/${app.id}/detaljer`,
			title: app.name,
			subtitle: app.description ?? undefined,
			teams: teamsByApp.get(app.id),
		})),
		...teamResults.map((team: (typeof teamResults)[number]) => ({
			type: "team" as const,
			id: team.slug,
			url: `/admin/nais-overvaking/${team.slug}`,
			title: team.displayName ?? team.slug,
			subtitle: team.slug,
		})),
		...sectionResults.map((section: (typeof sectionResults)[number]) => ({
			type: "section" as const,
			id: section.id,
			url: `/seksjoner/${section.slug}`,
			title: section.name,
			subtitle: section.description ?? undefined,
		})),
		...riskResults.map((risk: (typeof riskResults)[number]) => ({
			type: "risk" as const,
			id: risk.id,
			url: `/kontrollrammeverk/risiko/${risk.riskId}`,
			title: `${risk.riskId}: ${risk.shortTitle ?? risk.description}`,
			subtitle: risk.shortTitle ? risk.description : risk.domainName,
		})),
		...controlResults.map((control: (typeof controlResults)[number]) => {
			const domains = controlDomains.get(control.id) ?? []
			const primary = domains.sort((a, b) => a.displayOrder - b.displayOrder)[0]
			return {
				type: "control" as const,
				id: control.id,
				url: `/kontrollrammeverk/${primary?.domainCode ?? "unknown"}/${control.controlId}`,
				title: `${control.controlId}: ${control.shortTitle ?? control.requirement}`,
				subtitle: control.shortTitle ? (control.requirement ?? primary?.domainName) : primary?.domainName,
			}
		}),
	]

	results.sort((a, b) => searchScore(a.title, query) - searchScore(b.title, query))

	return Response.json({ results: results.slice(0, 20) })
}
