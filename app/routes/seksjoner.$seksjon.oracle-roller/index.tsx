import { BodyShort, Heading, type SortState, Table, Tag, VStack } from "@navikt/ds-react"
import { useMemo, useState } from "react"
import type { LoaderFunctionArgs } from "react-router"
import { data, Link, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getSectionOracleRoles } from "~/db/queries/oracle-roles.server"
import { getSectionBySlug } from "~/db/queries/sections.server"
import { type GroupCriticality, groupCriticalityLabels } from "~/db/schema/applications"

const criticalityTagVariant: Record<string, "success" | "warning" | "error" | "neutral"> = {
	low: "success",
	medium: "neutral",
	high: "warning",
	very_high: "error",
}

const criticalityOrder: Record<string, number> = { very_high: 0, high: 1, medium: 2, low: 3 }

export async function loader({ request, params }: LoaderFunctionArgs) {
	const { seksjon } = params
	if (!seksjon) throw data({ message: "Mangler seksjonsparameter" }, { status: 400 })

	const section = await getSectionBySlug(seksjon)
	if (!section) throw data({ message: `Fant ikke seksjon: ${seksjon}` }, { status: 404 })

	const roles = await getSectionOracleRoles(section.id)

	const { getAuthenticatedUser } = await import("~/lib/auth.server")
	const { getOracleInstances } = await import("~/lib/oracle-revisjon.server")
	const { canUserSeeInstance } = await import("~/lib/oracle-access.server")

	const user = await getAuthenticatedUser(request)
	const allInstances = await getOracleInstances()
	const instanceGroupMap = new Map(allInstances.map((i) => [i.id, i]))

	const filteredRoles = roles.filter((r) => {
		const inst = instanceGroupMap.get(r.instanceId)
		if (!inst) return false
		return canUserSeeInstance({ group: inst.group ?? null }, user?.groups ?? [])
	})

	return data({
		section,
		seksjon,
		roles: filteredRoles.map((r) => ({
			...r,
			assessedAt: r.assessedAt.toISOString(),
		})),
	})
}

type SortKey = "instans" | "rolle" | "kritikalitet" | "applikasjoner"

export default function SeksjonOracleRoller() {
	const { section, seksjon, roles } = useLoaderData<typeof loader>()
	const [sort, setSort] = useState<SortState>({ orderBy: "instans", direction: "ascending" })

	const sorted = useMemo(() => {
		const dir = sort.direction === "ascending" ? 1 : -1
		return [...roles].sort((a, b) => {
			switch (sort.orderBy as SortKey) {
				case "instans":
					return a.instanceId.localeCompare(b.instanceId, "nb") * dir
				case "rolle":
					return a.roleName.localeCompare(b.roleName, "nb") * dir
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
	}, [roles, sort])

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
				<Heading size="large">Oracle Database-roller — {section.name}</Heading>
				<BodyShort textColor="subtle">
					Oversikt over Oracle Database-roller som er vurdert for applikasjoner i seksjonen.
				</BodyShort>
			</VStack>

			{roles.length === 0 ? (
				<BodyShort textColor="subtle">Ingen Oracle-roller er vurdert for denne seksjonen ennå.</BodyShort>
			) : (
				<div className="table-scroll">
					<Table size="small" zebraStripes sort={sort} onSortChange={handleSort}>
						<Table.Header>
							<Table.Row>
								<Table.ColumnHeader scope="col" sortKey="instans" sortable>
									Instans
								</Table.ColumnHeader>
								<Table.ColumnHeader scope="col" sortKey="rolle" sortable>
									Rolle
								</Table.ColumnHeader>
								<Table.ColumnHeader scope="col" sortKey="applikasjoner" sortable>
									Applikasjoner
								</Table.ColumnHeader>
								<Table.ColumnHeader scope="col" sortKey="kritikalitet" sortable>
									Kritikalitet
								</Table.ColumnHeader>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{sorted.map((r) => (
								<Table.Row key={`${r.instanceId}:${r.roleName}`}>
									<Table.DataCell>
										<BodyShort size="small" style={{ fontFamily: "monospace" }}>
											{r.instanceId}
										</BodyShort>
									</Table.DataCell>
									<Table.DataCell>
										<BodyShort size="small" style={{ fontFamily: "monospace" }}>
											{r.roleName}
										</BodyShort>
									</Table.DataCell>
									<Table.DataCell>
										<VStack gap="space-1">
											{r.applications.map((app) => (
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
										<Tag variant={criticalityTagVariant[r.criticality] ?? "neutral"} size="xsmall">
											{groupCriticalityLabels[r.criticality as GroupCriticality] ?? r.criticality}
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
