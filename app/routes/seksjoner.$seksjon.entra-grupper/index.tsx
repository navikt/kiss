import { BodyShort, CopyButton, Detail, Heading, HStack, Select, Table, Tag, VStack } from "@navikt/ds-react"
import type { ChangeEvent } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Link, useFetcher, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getSectionGroups, upsertGroupCriticality } from "~/db/queries/nais.server"
import { getSectionBySlug } from "~/db/queries/sections.server"
import { type GroupCriticality, groupCriticalityEnum, groupCriticalityLabels } from "~/db/schema/applications"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { isAdmin, requireAdmin } from "~/lib/authorization.server"
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

	const user = await getAuthenticatedUser(request)
	const section = await getSectionBySlug(seksjon)
	if (!section) throw data({ message: `Fant ikke seksjon: ${seksjon}` }, { status: 404 })

	const groups = await getSectionGroups(section.id)

	// Resolve group names from Microsoft Graph
	const groupIds = groups.map((g) => g.groupId)
	const groupNames = groupIds.length > 0 ? await resolveGroupNames(groupIds) : {}

	const notAssessedCount = groups.filter((g) => !g.criticality).length

	return data({
		section,
		seksjon,
		groups,
		groupNames,
		notAssessedCount,
		canAdmin: user ? isAdmin(user) : false,
	})
}

export async function action({ request, params }: ActionFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	requireAdmin(authedUser)

	const { seksjon } = params
	if (!seksjon) throw data({ message: "Mangler seksjonsparameter" }, { status: 400 })

	const formData = await request.formData()
	const intent = formData.get("intent") as string

	if (intent === "set-criticality") {
		const applicationId = formData.get("applicationId") as string
		const groupId = formData.get("groupId") as string
		const criticality = formData.get("criticality") as string

		if (!applicationId || !groupId || !criticality) {
			throw data({ message: "Mangler påkrevde felter" }, { status: 400 })
		}

		if (!groupCriticalityEnum.includes(criticality as GroupCriticality)) {
			throw data({ message: "Ugyldig kritikalitet" }, { status: 400 })
		}

		await upsertGroupCriticality(applicationId, groupId, criticality as GroupCriticality, authedUser.navIdent)
		return data({ ok: true })
	}

	throw data({ message: "Ugyldig handling" }, { status: 400 })
}

export default function SeksjonEntraGrupper() {
	const { section, seksjon, groups, groupNames, notAssessedCount, canAdmin } = useLoaderData<typeof loader>()
	const criticalityFetcher = useFetcher()

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
								// Use the first application for criticality update
								const primaryAppId = g.applications[0]?.applicationId

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
											{canAdmin && primaryAppId ? (
												<criticalityFetcher.Form method="post">
													<input type="hidden" name="intent" value="set-criticality" />
													<input type="hidden" name="applicationId" value={primaryAppId} />
													<input type="hidden" name="groupId" value={g.groupId} />
													<Select
														label="Kritikalitet"
														hideLabel
														size="small"
														value={g.criticality ?? ""}
														onChange={(e: ChangeEvent<HTMLSelectElement>) => {
															criticalityFetcher.submit(
																{
																	intent: "set-criticality",
																	applicationId: primaryAppId,
																	groupId: g.groupId,
																	criticality: e.target.value,
																},
																{ method: "POST" },
															)
														}}
														style={{ minWidth: "120px" }}
													>
														<option value="" disabled>
															Velg…
														</option>
														{groupCriticalityEnum.map((c) => (
															<option key={c} value={c}>
																{groupCriticalityLabels[c]}
															</option>
														))}
													</Select>
												</criticalityFetcher.Form>
											) : g.criticality ? (
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
