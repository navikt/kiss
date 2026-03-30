import { eq, ilike, or } from "drizzle-orm"
import type { LoaderFunctionArgs } from "react-router"
import { db } from "~/db/connection.server"
import {
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
}

export async function loader({ request }: LoaderFunctionArgs) {
	const url = new URL(request.url)
	const query = url.searchParams.get("q")?.trim()

	if (!query || query.length < 2) {
		return Response.json({ results: [] })
	}

	const pattern = `%${query}%`
	const limit = 8

	const [appResults, teamResults, sectionResults, riskResults, controlResults] = await Promise.all([
		// Applications
		db
			.select({
				id: monitoredApplications.id,
				name: monitoredApplications.name,
				description: monitoredApplications.description,
			})
			.from(monitoredApplications)
			.where(or(ilike(monitoredApplications.name, pattern), ilike(monitoredApplications.description, pattern)))
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

		// Controls (join with domains to get domain code)
		db
			.select({
				id: frameworkControls.id,
				controlId: frameworkControls.controlId,
				requirement: frameworkControls.requirement,
				shortTitle: frameworkControls.shortTitle,
				domainCode: frameworkDomains.code,
				domainName: frameworkDomains.name,
			})
			.from(frameworkControls)
			.innerJoin(frameworkDomains, eq(frameworkControls.domainId, frameworkDomains.id))
			.where(
				or(
					ilike(frameworkControls.controlId, pattern),
					ilike(frameworkControls.requirement, pattern),
					ilike(frameworkControls.shortTitle, pattern),
				),
			)
			.limit(limit),
	])

	const results: SearchResult[] = [
		...appResults.map((app: (typeof appResults)[number]) => ({
			type: "application" as const,
			id: app.id,
			url: `/applikasjoner/${app.id}/detaljer`,
			title: app.name,
			subtitle: app.description ?? undefined,
		})),
		...teamResults.map((team: (typeof teamResults)[number]) => ({
			type: "team" as const,
			id: team.slug,
			url: `/nais-overvaking/${team.slug}`,
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
			subtitle: risk.domainName,
		})),
		...controlResults.map((control: (typeof controlResults)[number]) => ({
			type: "control" as const,
			id: control.id,
			url: `/kontrollrammeverk/${control.domainCode}/${control.controlId}`,
			title: `${control.controlId}: ${control.shortTitle ?? control.requirement}`,
			subtitle: control.domainName,
		})),
	]

	return Response.json({ results: results.slice(0, 20) })
}
