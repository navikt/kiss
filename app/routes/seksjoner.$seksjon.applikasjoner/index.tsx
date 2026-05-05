import type { SortState } from "@navikt/ds-react"
import { BodyLong, Box, Detail, Heading, HGrid, Search, Table, Tag, VStack } from "@navikt/ds-react"
import { useMemo, useState } from "react"
import type { LoaderFunctionArgs } from "react-router"
import { data, Link, useLoaderData } from "react-router"
import { ComplianceStatsPlaceholder } from "~/components/ComplianceStatsPlaceholder"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getSectionApps } from "~/db/queries/sections.server"
import { economySystemTypeLabels } from "~/db/schema/applications"
import { useFeatureFlags } from "~/hooks/useFeatureFlags"
import { compliancePercent } from "~/lib/utils"

export async function loader({ params }: LoaderFunctionArgs) {
	const seksjon = params.seksjon
	if (!seksjon) throw new Response("Mangler seksjon", { status: 400 })

	const result = await getSectionApps(seksjon)
	if (!result) throw new Response("Seksjon ikke funnet", { status: 404 })

	const appIds = result.apps.map((a) => a.appId)
	const { getEconomyClassifications } = await import("~/db/queries/economy-classification.server")
	const economyMap = await getEconomyClassifications(appIds)

	const totalImplemented = result.apps.reduce((sum, a) => sum + a.implemented, 0)
	const totalPartial = result.apps.reduce((sum, a) => sum + a.partial, 0)
	const totalNotRelevant = result.apps.reduce((sum, a) => sum + a.notRelevant, 0)
	const totalControls = result.apps.reduce((sum, a) => sum + a.total, 0)
	const overallPercent = compliancePercent(totalImplemented, totalPartial, totalControls, totalNotRelevant)

	return data({
		seksjon,
		seksjonName: result.section.name,
		apps: result.apps.map((a) => {
			const ec = economyMap.get(a.appId)
			const now = new Date()
			return {
				...a,
				economySystem: ec
					? {
							isEconomySystem: ec.isEconomySystem,
							type: ec.economySystemType,
							isExpired: ec.validUntil < now,
						}
					: null,
			}
		}),
		totalApps: result.apps.length,
		totalImplemented,
		totalPartial,
		totalControls,
		overallPercent,
	})
}

type SortKey = "appName" | "team" | "implemented" | "partial" | "notImplemented" | "unanswered" | "pct"

export default function SeksjonApplikasjoner() {
	const { seksjon, seksjonName, apps, totalApps, totalImplemented, totalPartial, overallPercent } =
		useLoaderData<typeof loader>()
	const [search, setSearch] = useState("")
	const [sort, setSort] = useState<SortState>({ orderBy: "appName", direction: "ascending" })
	const { showComplianceStats } = useFeatureFlags()

	const filtered = useMemo(() => {
		const q = search.toLowerCase()
		return apps.filter(
			(a) => a.appName.toLowerCase().includes(q) || a.teamNames.some((t) => t.toLowerCase().includes(q)),
		)
	}, [apps, search])

	const sorted = useMemo(() => {
		const dir = sort.direction === "ascending" ? 1 : -1
		return [...filtered].sort((a, b) => {
			switch (sort.orderBy as SortKey) {
				case "appName":
					return dir * a.appName.localeCompare(b.appName, "nb")
				case "team":
					return dir * (a.teamNames[0] ?? "").localeCompare(b.teamNames[0] ?? "", "nb")
				case "implemented":
					return dir * (a.implemented - b.implemented)
				case "partial":
					return dir * (a.partial - b.partial)
				case "notImplemented":
					return dir * (a.notImplemented - b.notImplemented)
				case "unanswered": {
					const uA = Math.max(0, a.total - a.implemented - a.partial - a.notImplemented - a.notRelevant)
					const uB = Math.max(0, b.total - b.implemented - b.partial - b.notImplemented - b.notRelevant)
					return dir * (uA - uB)
				}
				case "pct": {
					const pA = compliancePercent(a.implemented, a.partial, a.total, a.notRelevant)
					const pB = compliancePercent(b.implemented, b.partial, b.total, b.notRelevant)
					return dir * (pA - pB)
				}
				default:
					return 0
			}
		})
	}, [filtered, sort])

	const handleSort = (sortKey: string) => {
		setSort((prev) =>
			prev.orderBy === sortKey
				? { orderBy: sortKey, direction: prev.direction === "ascending" ? "descending" : "ascending" }
				: { orderBy: sortKey, direction: "ascending" },
		)
	}

	return (
		<VStack gap="space-8" style={{ maxWidth: "80rem" }}>
			<Heading size="xlarge" level="2">
				Applikasjoner i {seksjonName}
			</Heading>

			{showComplianceStats ? (
				<HGrid gap="space-6" columns={{ xs: 2, sm: 4 }}>
					<Box padding="space-6" borderRadius="8" background="sunken">
						<VStack align="center">
							<Heading size="xlarge" level="3">
								{totalApps}
							</Heading>
							<Detail>Applikasjoner</Detail>
						</VStack>
					</Box>
					<Box padding="space-6" borderRadius="8" background="sunken">
						<VStack align="center">
							<Heading size="xlarge" level="3">
								{totalImplemented}
							</Heading>
							<Detail>Implementert</Detail>
						</VStack>
					</Box>
					<Box padding="space-6" borderRadius="8" background="sunken">
						<VStack align="center">
							<Heading size="xlarge" level="3">
								{totalPartial}
							</Heading>
							<Detail>Delvis</Detail>
						</VStack>
					</Box>
					<Box padding="space-6" borderRadius="8" background="sunken">
						<VStack align="center">
							<Heading size="xlarge" level="3">
								{overallPercent}%
							</Heading>
							<Detail>Total compliance</Detail>
						</VStack>
					</Box>
				</HGrid>
			) : (
				<ComplianceStatsPlaceholder />
			)}

			<Search
				label="Søk etter applikasjon eller team"
				value={search}
				onChange={setSearch}
				onClear={() => setSearch("")}
				style={{ maxWidth: "24rem" }}
			/>

			{sorted.length > 0 ? (
				/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */
				<section className="table-scroll" tabIndex={0} aria-label="Alle applikasjoner i seksjonen">
					<Table sort={sort} onSortChange={handleSort}>
						<Table.Header>
							<Table.Row>
								<Table.ColumnHeader scope="col" sortKey="appName" sortable>
									Applikasjon
								</Table.ColumnHeader>
								<Table.ColumnHeader scope="col" sortKey="team" sortable>
									Team
								</Table.ColumnHeader>
								{showComplianceStats && (
									<>
										<Table.ColumnHeader scope="col" align="right" sortKey="implemented" sortable>
											Implementert
										</Table.ColumnHeader>
										<Table.ColumnHeader scope="col" align="right" sortKey="partial" sortable>
											Delvis
										</Table.ColumnHeader>
										<Table.ColumnHeader scope="col" align="right" sortKey="notImplemented" sortable>
											Ikke impl.
										</Table.ColumnHeader>
										<Table.ColumnHeader scope="col" align="right" sortKey="unanswered" sortable>
											Ikke besvart
										</Table.ColumnHeader>
										<Table.ColumnHeader scope="col" align="right" sortKey="pct" sortable>
											Status %
										</Table.ColumnHeader>
									</>
								)}
								<Table.ColumnHeader scope="col" sortKey="economySystem">
									Øk.system
								</Table.ColumnHeader>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{sorted.map((app) => {
								const answered = app.implemented + app.partial + app.notImplemented + app.notRelevant
								const unanswered = Math.max(0, app.total - answered)
								const pct = compliancePercent(app.implemented, app.partial, app.total, app.notRelevant)
								return (
									<Table.Row key={app.appId}>
										<Table.DataCell>
											<Link to={`/seksjoner/${seksjon}/applikasjoner/${app.appId}/detaljer`}>{app.appName}</Link>
										</Table.DataCell>
										<Table.DataCell>
											{app.teamNames.length > 0 ? app.teamNames.join(", ") : "Ikke tildelt"}
										</Table.DataCell>
										{showComplianceStats && (
											<>
												<Table.DataCell align="right">{app.implemented}</Table.DataCell>
												<Table.DataCell align="right">{app.partial}</Table.DataCell>
												<Table.DataCell align="right">{app.notImplemented}</Table.DataCell>
												<Table.DataCell align="right">{unanswered}</Table.DataCell>
												<Table.DataCell align="right">{pct}%</Table.DataCell>
											</>
										)}
										<Table.DataCell>
											{app.economySystem ? (
												app.economySystem.isEconomySystem ? (
													<Tag variant={app.economySystem.isExpired ? "error" : "warning"} size="xsmall">
														{app.economySystem.type
															? economySystemTypeLabels[app.economySystem.type as keyof typeof economySystemTypeLabels]
															: "Ja"}
														{app.economySystem.isExpired ? " ⚠" : ""}
													</Tag>
												) : (
													<Tag variant={app.economySystem.isExpired ? "error" : "neutral"} size="xsmall">
														Nei{app.economySystem.isExpired ? " ⚠" : ""}
													</Tag>
												)
											) : null}
										</Table.DataCell>
									</Table.Row>
								)
							})}
						</Table.Body>
					</Table>
				</section>
			) : (
				<BodyLong>{search ? "Ingen applikasjoner matcher søket." : "Ingen applikasjoner i denne seksjonen."}</BodyLong>
			)}
		</VStack>
	)
}

export const ErrorBoundary = RouteErrorBoundary
