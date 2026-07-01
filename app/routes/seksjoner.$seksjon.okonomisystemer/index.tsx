import type { SortState } from "@navikt/ds-react"
import { BodyShort, Heading, HStack, Search, Select, Table, Tag, VStack } from "@navikt/ds-react"
import { useMemo, useState } from "react"
import { data, Link, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { economySystemTypeEnum, economySystemTypeLabels } from "~/db/schema/applications"
import type { Route } from "./+types/index"

export async function loader({ params }: Route.LoaderArgs) {
	const seksjonSlug = params.seksjon
	if (!seksjonSlug) throw new Response("Mangler seksjon", { status: 400 })

	const { db } = await import("~/db/connection.server")
	const { sections, devTeams } = await import("~/db/schema/organization")
	const { eq, isNull, inArray, and } = await import("drizzle-orm")

	const [section] = await db.select().from(sections).where(eq(sections.slug, seksjonSlug)).limit(1)
	if (!section) throw new Response("Seksjon ikke funnet", { status: 404 })

	const { monitoredApplications, applicationTeamMappings } = await import("~/db/schema/applications")

	// Use getFilteredSectionAppIds — the same shared path as countSectionEconomySystems
	const { getFilteredSectionAppIds } = await import("~/db/queries/nais.server")
	const filteredAppIds = await getFilteredSectionAppIds(section.id)

	if (filteredAppIds.length === 0) {
		return data({ seksjonSlug, seksjonName: section.name, items: [] })
	}

	const eligibleApps = await db
		.select({ id: monitoredApplications.id, name: monitoredApplications.name })
		.from(monitoredApplications)
		.where(inArray(monitoredApplications.id, filteredAppIds))

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
	const items = eligibleApps
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

type SortKey = "appName" | "team" | "type" | "status"

export default function SeksjonOkonomisystemer() {
	const { seksjonName, items } = useLoaderData<typeof loader>()
	const [search, setSearch] = useState("")
	const [typeFilter, setTypeFilter] = useState("")
	const [statusFilter, setStatusFilter] = useState("")
	const [sort, setSort] = useState<SortState>({ orderBy: "appName", direction: "ascending" })

	const filtered = useMemo(() => {
		const q = search.toLowerCase()
		return items.filter((item) => {
			const matchesSearch = item.appName.toLowerCase().includes(q) || (item.team ?? "").toLowerCase().includes(q)
			const matchesType = typeFilter === "" || item.economySystemType === typeFilter
			const matchesStatus =
				statusFilter === "" ||
				(statusFilter === "gyldig" && !item.isExpired) ||
				(statusFilter === "utlopt" && item.isExpired)
			return matchesSearch && matchesType && matchesStatus
		})
	}, [items, search, typeFilter, statusFilter])

	const sorted = useMemo(() => {
		const dir = sort.direction === "ascending" ? 1 : -1
		return [...filtered].sort((a, b) => {
			switch (sort.orderBy as SortKey) {
				case "appName":
					return dir * a.appName.localeCompare(b.appName, "nb")
				case "team":
					return dir * (a.team ?? "").localeCompare(b.team ?? "", "nb")
				case "type": {
					const labelA = a.economySystemType
						? (economySystemTypeLabels[a.economySystemType as keyof typeof economySystemTypeLabels] ?? "")
						: ""
					const labelB = b.economySystemType
						? (economySystemTypeLabels[b.economySystemType as keyof typeof economySystemTypeLabels] ?? "")
						: ""
					return dir * labelA.localeCompare(labelB, "nb")
				}
				case "status": {
					// Utløpt < Gyldig ascending, then by date
					if (a.isExpired !== b.isExpired) return dir * (a.isExpired ? -1 : 1)
					return dir * a.validUntil.localeCompare(b.validUntil)
				}
				default:
					return 0
			}
		})
	}, [filtered, sort])

	const handleSort = (sortKey: string | undefined) => {
		const key = sortKey ?? "appName"
		setSort((prev) => {
			if (prev.orderBy !== key) return { orderBy: key, direction: "ascending" }
			if (prev.direction === "ascending") return { orderBy: key, direction: "descending" }
			// Third click or undefined: reset to default sort (appName ascending)
			return { orderBy: "appName", direction: "ascending" }
		})
	}

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
				<VStack gap="space-4">
					<HStack gap="space-4" align="end" wrap>
						<Search
							label="Søk etter applikasjon eller team"
							value={search}
							onChange={setSearch}
							onClear={() => setSearch("")}
							style={{ maxWidth: "20rem" }}
						/>
						<Select
							label="Type"
							value={typeFilter}
							onChange={(e) => setTypeFilter(e.target.value)}
							style={{ maxWidth: "16rem" }}
						>
							<option value="">Alle typer</option>
							{economySystemTypeEnum.map((type) => (
								<option key={type} value={type}>
									{economySystemTypeLabels[type]}
								</option>
							))}
						</Select>
						<Select
							label="Status"
							value={statusFilter}
							onChange={(e) => setStatusFilter(e.target.value)}
							style={{ maxWidth: "10rem" }}
						>
							<option value="">Alle statuser</option>
							<option value="gyldig">Gyldig</option>
							<option value="utlopt">Utløpt</option>
						</Select>
					</HStack>
					{sorted.length === 0 ? (
						<BodyShort textColor="subtle">Ingen applikasjoner matcher valgte filtre.</BodyShort>
					) : (
						// biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable table needs keyboard access
						<section className="table-scroll" tabIndex={0} aria-label="Økonomisystemer i seksjonen">
							<Table sort={sort} onSortChange={handleSort}>
								<Table.Header>
									<Table.Row>
										<Table.ColumnHeader sortKey="appName" sortable>
											Applikasjon
										</Table.ColumnHeader>
										<Table.ColumnHeader sortKey="team" sortable>
											Team
										</Table.ColumnHeader>
										<Table.ColumnHeader sortKey="type" sortable>
											Type
										</Table.ColumnHeader>
										<Table.HeaderCell>Begrunnelse</Table.HeaderCell>
										<Table.ColumnHeader sortKey="status" sortable>
											Status
										</Table.ColumnHeader>
									</Table.Row>
								</Table.Header>
								<Table.Body>
									{sorted.map((item) => (
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
			)}
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
