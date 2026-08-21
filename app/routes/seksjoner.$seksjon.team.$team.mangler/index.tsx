import { BodyShort, Box, Heading, HStack, Switch, Table, Tag, VStack } from "@navikt/ds-react"
import { useState } from "react"
import { data, Link, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getSectionBySlug, getTeamComplianceGaps } from "~/db/queries/sections.server"
import { economySystemTypeLabels } from "~/db/schema/applications"
import { getAuthenticatedUser } from "~/lib/auth.server"
import { establishmentLabels, establishmentVariants } from "~/lib/compliance-status"
import { routinePriorityLabels, routinePriorityVariants } from "~/lib/routine-priorities"
import type { Route } from "./+types/index"

export async function loader({ request, params }: Route.LoaderArgs) {
	const seksjon = params.seksjon
	const teamSlug = params.team
	if (!seksjon) throw new Response("Mangler seksjon", { status: 400 })
	if (!teamSlug) throw new Response("Mangler team", { status: 400 })

	await getAuthenticatedUser(request)

	const [result, section] = await Promise.all([getTeamComplianceGaps(teamSlug), getSectionBySlug(seksjon)])
	if (!result) throw new Response("Team ikke funnet", { status: 404 })
	if (!section) throw new Response("Seksjon ikke funnet", { status: 404 })
	if (result.team.sectionId !== section.id) throw new Response("Team tilhører ikke denne seksjonen", { status: 404 })

	return data({
		seksjon,
		seksjonName: section.name,
		team: teamSlug,
		teamName: result.team.name,
		gaps: result.gaps,
	})
}

export default function TeamComplianceGaps() {
	const { seksjon, seksjonName, team, teamName, gaps } = useLoaderData<typeof loader>()
	const [showEconomyOnly, setShowEconomyOnly] = useState(false)

	const visibleGaps = showEconomyOnly ? gaps.filter((gap) => gap.isEconomySystem === true) : gaps

	return (
		<VStack gap="space-8">
			<VStack gap="space-2">
				<BodyShort size="small">
					<Link to={`/seksjoner/${seksjon}`}>{seksjonName}</Link>
					{" / "}
					<Link to={`/seksjoner/${seksjon}/team/${team}`}>{teamName}</Link>
				</BodyShort>
				<Heading size="xlarge" level="2">
					Mangler
				</Heading>
				<BodyShort textColor="subtle">{gaps.length} kontroller mangler vurdering</BodyShort>
			</VStack>

			<HStack justify="space-between" align="center" wrap>
				<Heading size="medium" level="3">
					Kontroller
				</Heading>
				<Switch size="small" checked={showEconomyOnly} onChange={(e) => setShowEconomyOnly(e.target.checked)}>
					Vis kun økonomisystemer
				</Switch>
			</HStack>

			{gaps.length === 0 ? (
				<Box padding="space-16" borderRadius="8" background="sunken">
					<BodyShort>Ingen mangler registrert for dette teamet. Bra jobbet! 🎉</BodyShort>
				</Box>
			) : visibleGaps.length === 0 ? (
				<BodyShort>Ingen mangler er klassifisert som økonomisystem.</BodyShort>
			) : (
				/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */
				<section className="table-scroll" tabIndex={0} aria-label="Mangler per applikasjon">
					<Table>
						<Table.Header>
							<Table.Row>
								<Table.HeaderCell scope="col">Applikasjon</Table.HeaderCell>
								<Table.HeaderCell scope="col">Kontroll</Table.HeaderCell>
								<Table.HeaderCell scope="col">Teknologielement</Table.HeaderCell>
								<Table.HeaderCell scope="col">Rutine</Table.HeaderCell>
								<Table.HeaderCell scope="col">Kritikalitet</Table.HeaderCell>
								<Table.HeaderCell scope="col">Økonomisystem</Table.HeaderCell>
								<Table.HeaderCell scope="col" />
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{visibleGaps.map((gap) => (
								<Table.Row key={gap.id}>
									<Table.DataCell>
										<Link to={`/seksjoner/${seksjon}/team/${team}/applikasjoner/${gap.appId}/detaljer`}>
											{gap.appName}
										</Link>
									</Table.DataCell>
									<Table.DataCell>
										{gap.controlCode} – {gap.controlName}
									</Table.DataCell>
									<Table.DataCell>{gap.technologyElement ?? "–"}</Table.DataCell>
									<Table.DataCell>
										{gap.establishment === "established" && gap.routines.length > 0 ? (
											<HStack gap="space-2" wrap>
												{gap.routines.map((routine) => (
													<Link
														key={routine.id}
														to={`/seksjoner/${seksjon}/team/${team}/applikasjoner/${gap.appId}/kontroll/${gap.controlUuid}/rutiner`}
													>
														{routine.name}
													</Link>
												))}
											</HStack>
										) : (
											<Tag variant={establishmentVariants[gap.establishment]} size="small">
												{establishmentLabels[gap.establishment]}
											</Tag>
										)}
									</Table.DataCell>
									<Table.DataCell>
										{gap.routines.length > 0 ? (
											<HStack gap="space-2" wrap>
												{gap.routines.map((routine) => (
													<Tag key={routine.id} variant={routinePriorityVariants[routine.priority]} size="small">
														{routinePriorityLabels[routine.priority]}
													</Tag>
												))}
											</HStack>
										) : (
											"–"
										)}
									</Table.DataCell>
									<Table.DataCell>
										{gap.isEconomySystem === null ? (
											"–"
										) : gap.isEconomySystem ? (
											<Tag variant="info" size="small">
												{gap.economySystemType ? economySystemTypeLabels[gap.economySystemType] : "Ja"}
											</Tag>
										) : (
											"Nei"
										)}
									</Table.DataCell>
									<Table.DataCell>
										<Link
											to={`/seksjoner/${seksjon}/team/${team}/applikasjoner/${gap.appId}/detaljer?fane=kontroller`}
											aria-label={`Vurder ${gap.controlCode} for ${gap.appName}`}
										>
											Vurder
										</Link>
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
