import { BodyShort, CopyButton, Detail, Heading, HStack, Table, Tag, VStack } from "@navikt/ds-react"
import type { LoaderFunctionArgs } from "react-router"
import { data, Link, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getSectionGroups } from "~/db/queries/nais.server"
import { getSectionBySlug } from "~/db/queries/sections.server"
import { type GroupCriticality, groupCriticalityLabels } from "~/db/schema/applications"
import { getAuthenticatedUser } from "~/lib/auth.server"
import { resolveGroupNames } from "~/lib/graph.server"

const criticalityTagVariant: Record<string, "success" | "warning" | "error" | "neutral"> = {
	low: "success",
	medium: "neutral",
	high: "warning",
	very_high: "error",
}

export async function loader({ request, params }: LoaderFunctionArgs) {
	const { seksjon } = params
	if (!seksjon) throw data({ message: "Mangler seksjonsparameter" }, { status: 400 })

	await getAuthenticatedUser(request)
	const section = await getSectionBySlug(seksjon)
	if (!section) throw data({ message: `Fant ikke seksjon: ${seksjon}` }, { status: 404 })

	const groups = await getSectionGroups(section.id)

	const groupIds = groups.map((g) => g.groupId)
	const groupNames = groupIds.length > 0 ? await resolveGroupNames(groupIds) : {}

	const notAssessedCount = groups.filter((g) => !g.criticality).length

	return data({ section, seksjon, groups, groupNames, notAssessedCount })
}

export default function SeksjonEntraGrupper() {
	const { section, seksjon, groups, groupNames, notAssessedCount } = useLoaderData<typeof loader>()

	return (
		<VStack gap="space-6">
			<VStack gap="space-2">
				<Heading size="large">Entra ID-grupper — {section.name}</Heading>
				<BodyShort textColor="subtle">
					Oversikt over alle Entra ID-grupper i bruk av applikasjoner i seksjonen.
					{notAssessedCount > 0 && ` ${notAssessedCount} av ${groups.length} grupper mangler kritikalitetsvurdering.`}
				</BodyShort>
			</VStack>

			{groups.length === 0 ? (
				<BodyShort textColor="subtle">Ingen Entra ID-grupper funnet for denne seksjonen.</BodyShort>
			) : (
				<div className="table-scroll">
					<Table size="small" zebraStripes>
						<Table.Header>
							<Table.Row>
								<Table.HeaderCell scope="col">Gruppe</Table.HeaderCell>
								<Table.HeaderCell scope="col">Applikasjoner</Table.HeaderCell>
								<Table.HeaderCell scope="col">Kilde</Table.HeaderCell>
								<Table.HeaderCell scope="col">Kritikalitet</Table.HeaderCell>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{groups.map((g) => {
								const displayName = groupNames[g.groupId] ?? null
								const sources = [...new Set(g.applications.map((a) => a.source))]

								return (
									<Table.Row key={g.groupId}>
										<Table.DataCell>
											<VStack gap="space-1">
												<BodyShort size="small" weight="semibold">
													{displayName ?? "Ukjent gruppe"}
												</BodyShort>
												<HStack gap="space-1" align="center">
													<Detail textColor="subtle" style={{ fontFamily: "monospace" }}>
														{g.groupId}
													</Detail>
													<CopyButton copyText={g.groupId} size="xsmall" />
												</HStack>
											</VStack>
										</Table.DataCell>
										<Table.DataCell>
											<VStack gap="space-1">
												{g.applications.map((app) => (
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
											<HStack gap="space-1" wrap>
												{sources.includes("nais") && (
													<Tag variant="info" size="xsmall">
														Nais
													</Tag>
												)}
												{sources.includes("manual") && (
													<Tag variant="neutral" size="xsmall">
														Manuell
													</Tag>
												)}
											</HStack>
										</Table.DataCell>
										<Table.DataCell>
											{g.criticality ? (
												<Tag variant={criticalityTagVariant[g.criticality] ?? "neutral"} size="xsmall">
													{groupCriticalityLabels[g.criticality as GroupCriticality] ?? g.criticality}
												</Tag>
											) : (
												<BodyShort size="small" textColor="subtle">
													Ikke vurdert
												</BodyShort>
											)}
										</Table.DataCell>
									</Table.Row>
								)
							})}
						</Table.Body>
					</Table>
				</div>
			)}
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
