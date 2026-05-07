import { BodyShort, Heading, HStack, Table, Tag, VStack } from "@navikt/ds-react"
import type { LoaderFunctionArgs } from "react-router"
import { data, Link, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { economySystemTypeLabels } from "~/db/schema/applications"

export async function loader({ params }: LoaderFunctionArgs) {
	const seksjonSlug = params.seksjon
	if (!seksjonSlug) throw new Response("Mangler seksjon", { status: 400 })

	const { db } = await import("~/db/connection.server")
	const { sections, devTeams } = await import("~/db/schema/organization")
	const { eq, isNull, inArray, and } = await import("drizzle-orm")

	const [section] = await db.select().from(sections).where(eq(sections.slug, seksjonSlug)).limit(1)
	if (!section) throw new Response("Seksjon ikke funnet", { status: 404 })

	const { monitoredApplications, sectionIgnoredApplications, applicationTeamMappings } = await import(
		"~/db/schema/applications"
	)

	// Use getSectionAppIds which includes both dev team and Nais team apps
	const { getSectionAppIds } = await import("~/db/queries/nais.server")
	const allAppIds = [...(await getSectionAppIds(section.id))]

	if (allAppIds.length === 0) {
		return data({ seksjonSlug, seksjonName: section.name, items: [] })
	}

	// Load excluded environments for this section
	const { sectionEnvironments } = await import("~/db/schema/organization")
	const excludedEnvRows = await db
		.select({ cluster: sectionEnvironments.cluster })
		.from(sectionEnvironments)
		.where(and(eq(sectionEnvironments.sectionId, section.id), eq(sectionEnvironments.included, false)))
	const excludedEnvs = new Set(excludedEnvRows.map((r) => r.cluster))

	// Exclude ignored apps, archived apps, and secondary apps
	const ignoredRows = await db
		.select({ appId: sectionIgnoredApplications.applicationId })
		.from(sectionIgnoredApplications)
		.where(and(eq(sectionIgnoredApplications.sectionId, section.id), isNull(sectionIgnoredApplications.archivedAt)))
	const ignoredIds = new Set(ignoredRows.map((r) => r.appId))

	const eligibleApps = await db
		.select({ id: monitoredApplications.id, name: monitoredApplications.name })
		.from(monitoredApplications)
		.where(
			and(
				inArray(monitoredApplications.id, allAppIds),
				isNull(monitoredApplications.archivedAt),
				isNull(monitoredApplications.primaryApplicationId),
			),
		)

	let filteredApps = eligibleApps.filter((app) => !ignoredIds.has(app.id))

	// Filter out apps whose only environments are in excluded clusters
	if (excludedEnvs.size > 0 && filteredApps.length > 0) {
		const { applicationEnvironments } = await import("~/db/schema/applications")
		const appEnvRows = await db
			.select({
				appId: applicationEnvironments.applicationId,
				cluster: applicationEnvironments.cluster,
			})
			.from(applicationEnvironments)
			.where(
				inArray(
					applicationEnvironments.applicationId,
					filteredApps.map((a) => a.id),
				),
			)
		const appEnvMap = new Map<string, Set<string>>()
		for (const row of appEnvRows) {
			if (!appEnvMap.has(row.appId)) appEnvMap.set(row.appId, new Set())
			appEnvMap.get(row.appId)?.add(row.cluster)
		}
		filteredApps = filteredApps.filter((app) => {
			const clusters = appEnvMap.get(app.id)
			if (!clusters || clusters.size === 0) return true
			return ![...clusters].every((c) => excludedEnvs.has(c))
		})
	}

	const filteredAppIds = filteredApps.map((a) => a.id)

	if (filteredAppIds.length === 0) {
		return data({ seksjonSlug, seksjonName: section.name, items: [] })
	}

	const { getEconomyClassifications } = await import("~/db/queries/economy-classification.server")
	const economyMap = await getEconomyClassifications(filteredAppIds)

	// Only show apps with economy classification = true
	const economyAppIds = [...economyMap.entries()].filter(([, ec]) => ec.isEconomySystem).map(([id]) => id)
	if (economyAppIds.length === 0) {
		return data({ seksjonSlug, seksjonName: section.name, items: [] })
	}

	// Get team names — scoped to this section's active teams only
	const teamRows = await db
		.select({
			appId: applicationTeamMappings.applicationId,
			teamName: devTeams.name,
		})
		.from(applicationTeamMappings)
		.innerJoin(devTeams, eq(applicationTeamMappings.devTeamId, devTeams.id))
		.where(
			and(
				inArray(applicationTeamMappings.applicationId, economyAppIds),
				isNull(applicationTeamMappings.archivedAt),
				isNull(devTeams.archivedAt),
				eq(devTeams.sectionId, section.id),
			),
		)

	const teamsByApp = new Map<string, string[]>()
	for (const row of teamRows) {
		if (!teamsByApp.has(row.appId)) teamsByApp.set(row.appId, [])
		teamsByApp.get(row.appId)?.push(row.teamName)
	}

	const now = new Date()
	const items = filteredApps
		.filter((app) => economyMap.has(app.id) && economyMap.get(app.id)?.isEconomySystem)
		.map((app) => {
			// biome-ignore lint/style/noNonNullAssertion: guaranteed by .filter() above
			const ec = economyMap.get(app.id)!
			return {
				appId: app.id,
				appName: app.name,
				team: teamsByApp.get(app.id)?.join(", ") || null,
				economySystemType: ec.economySystemType,
				justification: ec.justification,
				validUntil: ec.validUntil.toISOString(),
				isExpired: ec.validUntil < now,
			}
		})

	return data({
		seksjonSlug,
		seksjonName: section.name,
		items,
	})
}

export default function SeksjonOkonomisystemer() {
	const { seksjonName, items } = useLoaderData<typeof loader>()

	return (
		<VStack gap="space-8">
			<Heading size="xlarge" level="2">
				Økonomisystemer – {seksjonName}
			</Heading>
			<BodyShort>
				Applikasjoner i seksjonen som er klassifisert som økonomisystem. Klassifiseringen revideres årlig.
			</BodyShort>

			{items.length === 0 ? (
				<BodyShort>Ingen applikasjoner i denne seksjonen er klassifisert som økonomisystem.</BodyShort>
			) : (
				// biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable table needs keyboard access
				<section className="table-scroll" tabIndex={0} aria-label="Økonomisystemer i seksjonen">
					<Table>
						<Table.Header>
							<Table.Row>
								<Table.HeaderCell>Applikasjon</Table.HeaderCell>
								<Table.HeaderCell>Team</Table.HeaderCell>
								<Table.HeaderCell>Type</Table.HeaderCell>
								<Table.HeaderCell>Begrunnelse</Table.HeaderCell>
								<Table.HeaderCell>Status</Table.HeaderCell>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{items.map((item) => (
								<Table.Row key={item.appId}>
									<Table.DataCell>
										<Link to={`/applikasjoner/${item.appId}/detaljer`}>{item.appName}</Link>
									</Table.DataCell>
									<Table.DataCell>{item.team ?? "–"}</Table.DataCell>
									<Table.DataCell>
										{item.economySystemType
											? economySystemTypeLabels[item.economySystemType as keyof typeof economySystemTypeLabels]
											: "–"}
									</Table.DataCell>
									<Table.DataCell>
										<BodyShort size="small" truncate style={{ maxWidth: "300px" }}>
											{item.justification}
										</BodyShort>
									</Table.DataCell>
									<Table.DataCell>
										<HStack gap="space-2">
											{item.isExpired ? (
												<Tag variant="error" size="xsmall">
													Utløpt
												</Tag>
											) : (
												<Tag variant="success" size="xsmall">
													Gyldig
												</Tag>
											)}
											<BodyShort size="small" textColor="subtle">
												{new Date(item.validUntil).toLocaleDateString("nb-NO")}
											</BodyShort>
										</HStack>
									</Table.DataCell>
								</Table.Row>
							))}
						</Table.Body>
					</Table>
				</section>
			)}
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
