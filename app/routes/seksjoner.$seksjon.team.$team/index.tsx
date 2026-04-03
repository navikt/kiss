import { BodyLong, Button, Heading, HStack, Table, VStack } from "@navikt/ds-react"
import type { LoaderFunctionArgs } from "react-router"
import { data, Link, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getTeamApps } from "~/db/queries/sections.server"
import { compliancePercent } from "~/lib/utils"

export async function loader({ params }: LoaderFunctionArgs) {
	const seksjon = params.seksjon
	const team = params.team
	if (!seksjon) throw new Response("Mangler seksjon", { status: 400 })
	if (!team) throw new Response("Mangler team", { status: 400 })

	const result = await getTeamApps(team)
	if (!result) throw new Response("Team ikke funnet", { status: 404 })

	return data({
		seksjon,
		team,
		teamName: result.team.name,
		apps: result.apps,
	})
}

export default function TeamDashboard() {
	const { seksjon, team, teamName, apps } = useLoaderData<typeof loader>()

	return (
		<VStack gap="space-8">
			<div>
				<Link to={`/seksjoner/${seksjon}`}>← Tilbake til seksjon</Link>
				<HStack gap="space-4" align="center">
					<Heading size="xlarge" level="2">
						{teamName}
					</Heading>
					<Button as={Link} to={`/seksjoner/${seksjon}/team/${team}/rediger`} variant="tertiary" size="small">
						Administrer
					</Button>
				</HStack>
			</div>
			<BodyLong>
				Compliance-status per applikasjon for {teamName} i seksjon <Link to={`/seksjoner/${seksjon}`}>{seksjon}</Link>.
			</BodyLong>

			{apps.length > 0 ? (
				/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */
				<section className="table-scroll" tabIndex={0} aria-label="Applikasjoner per team">
					<Table>
						<Table.Header>
							<Table.Row>
								<Table.HeaderCell scope="col">App</Table.HeaderCell>
								<Table.HeaderCell scope="col" align="right">
									Implementert
								</Table.HeaderCell>
								<Table.HeaderCell scope="col" align="right">
									Delvis
								</Table.HeaderCell>
								<Table.HeaderCell scope="col" align="right">
									Mangler
								</Table.HeaderCell>
								<Table.HeaderCell scope="col" align="right">
									Status %
								</Table.HeaderCell>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{apps.map((app) => {
								const pct = compliancePercent(app.implemented, app.partial, app.total)
								return (
									<Table.Row key={app.appId}>
										<Table.DataCell>
											<Link to={`/applikasjoner/${app.appId}/detaljer`}>{app.appName}</Link>
										</Table.DataCell>
										<Table.DataCell align="right">{app.implemented}</Table.DataCell>
										<Table.DataCell align="right">{app.partial}</Table.DataCell>
										<Table.DataCell align="right">{app.notImplemented}</Table.DataCell>
										<Table.DataCell align="right">{pct}%</Table.DataCell>
									</Table.Row>
								)
							})}
						</Table.Body>
					</Table>
				</section>
			) : (
				<BodyLong>Ingen applikasjoner er tilknyttet dette teamet.</BodyLong>
			)}
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
