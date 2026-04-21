import { BodyShort, Heading, type SortState, Table, Tag, VStack } from "@navikt/ds-react"
import { useMemo, useState } from "react"
import type { LoaderFunctionArgs } from "react-router"
import { data, Link, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getSectionOracleProfiles } from "~/db/queries/oracle-profiles.server"
import { getSectionBySlug } from "~/db/queries/sections.server"
import { type GroupCriticality, groupCriticalityLabels } from "~/db/schema/applications"

const criticalityTagVariant: Record<string, "success" | "warning" | "error" | "neutral"> = {
	low: "success",
	medium: "neutral",
	high: "warning",
	very_high: "error",
}

const criticalityOrder: Record<string, number> = { very_high: 0, high: 1, medium: 2, low: 3 }

export async function loader({ params }: LoaderFunctionArgs) {
	const { seksjon } = params
	if (!seksjon) throw data({ message: "Mangler seksjonsparameter" }, { status: 400 })

	const section = await getSectionBySlug(seksjon)
	if (!section) throw data({ message: `Fant ikke seksjon: ${seksjon}` }, { status: 404 })

	const profiles = await getSectionOracleProfiles(section.id)

	return data({
		section,
		seksjon,
		profiles: profiles.map((p) => ({
			...p,
			assessedAt: p.assessedAt.toISOString(),
		})),
	})
}

type SortKey = "instans" | "profil" | "kritikalitet" | "applikasjoner"

export default function SeksjonOracleProfiler() {
	const { section, seksjon, profiles } = useLoaderData<typeof loader>()
	const [sort, setSort] = useState<SortState>({ orderBy: "instans", direction: "ascending" })

	const sorted = useMemo(() => {
		const dir = sort.direction === "ascending" ? 1 : -1
		return [...profiles].sort((a, b) => {
			switch (sort.orderBy as SortKey) {
				case "instans":
					return a.instanceId.localeCompare(b.instanceId, "nb") * dir
				case "profil":
					return a.profileName.localeCompare(b.profileName, "nb") * dir
				case "kritikalitet": {
					const ordA = a.criticality ? (criticalityOrder[a.criticality] ?? 99) : 99
					const ordB = b.criticality ? (criticalityOrder[b.criticality] ?? 99) : 99
					return (ordA - ordB) * dir
				}
				case "applikasjoner":
					return (a.applications.length - b.applications.length) * dir
				default:
					return 0
			}
		})
	}, [profiles, sort])

	const handleSort = (sortKey: string) => {
		setSort((prev) =>
			prev.orderBy === sortKey
				? { orderBy: sortKey, direction: prev.direction === "ascending" ? "descending" : "ascending" }
				: { orderBy: sortKey, direction: "ascending" },
		)
	}

	return (
		<VStack gap="space-6">
			<VStack gap="space-2">
				<Heading size="large">Oracle Database-profiler — {section.name}</Heading>
				<BodyShort textColor="subtle">
					Oversikt over Oracle Database-profiler som er vurdert for applikasjoner i seksjonen.
				</BodyShort>
			</VStack>

			{profiles.length === 0 ? (
				<BodyShort textColor="subtle">Ingen Oracle-profiler er vurdert for denne seksjonen ennå.</BodyShort>
			) : (
				<div className="table-scroll">
					<Table size="small" zebraStripes sort={sort} onSortChange={handleSort}>
						<Table.Header>
							<Table.Row>
								<Table.ColumnHeader scope="col" sortKey="instans" sortable>
									Instans
								</Table.ColumnHeader>
								<Table.ColumnHeader scope="col" sortKey="profil" sortable>
									Profil
								</Table.ColumnHeader>
								<Table.HeaderCell scope="col">Applikasjoner</Table.HeaderCell>
								<Table.ColumnHeader scope="col" sortKey="kritikalitet" sortable>
									Kritikalitet
								</Table.ColumnHeader>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{sorted.map((p) => (
								<Table.Row key={`${p.instanceId}:${p.profileName}`}>
									<Table.DataCell>
										<BodyShort size="small" style={{ fontFamily: "monospace" }}>
											{p.instanceId}
										</BodyShort>
									</Table.DataCell>
									<Table.DataCell>
										<BodyShort size="small" style={{ fontFamily: "monospace" }}>
											{p.profileName}
										</BodyShort>
									</Table.DataCell>
									<Table.DataCell>
										<VStack gap="space-1">
											{p.applications.map((app) => (
												<Link
													key={app.applicationId}
													to={`/seksjoner/${seksjon}/applikasjoner/${app.applicationId}/detaljer`}
													style={{ fontSize: "var(--ax-font-size-small)" }}
												>
													{app.applicationName}
												</Link>
											))}
										</VStack>
									</Table.DataCell>
									<Table.DataCell>
										<Tag variant={criticalityTagVariant[p.criticality] ?? "neutral"} size="xsmall">
											{groupCriticalityLabels[p.criticality as GroupCriticality] ?? p.criticality}
										</Tag>
									</Table.DataCell>
								</Table.Row>
							))}
						</Table.Body>
					</Table>
				</div>
			)}
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
