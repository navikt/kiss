import { BodyLong, Box, Button, Detail, Heading, HGrid, HStack, Table, Tag, VStack } from "@navikt/ds-react"
import type { LoaderFunctionArgs } from "react-router"
import { data, Link, useLoaderData } from "react-router"
import { DeploymentSummaryCards } from "~/components/DeploymentSummaryCards"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getDeploymentVerificationAggregate } from "~/db/queries/deployment-audit.server"
import { getSectionBySlug, getTeamApps } from "~/db/queries/sections.server"
import { getAuthenticatedUser } from "~/lib/auth.server"
import { isAdmin } from "~/lib/authorization.server"
import { compliancePercent } from "~/lib/utils"

export async function loader({ request, params }: LoaderFunctionArgs) {
	const seksjon = params.seksjon
	const team = params.team
	if (!seksjon) throw new Response("Mangler seksjon", { status: 400 })
	if (!team) throw new Response("Mangler team", { status: 400 })

	const user = await getAuthenticatedUser(request)

	const [result, section] = await Promise.all([getTeamApps(team), getSectionBySlug(seksjon)])
	if (!result) throw new Response("Team ikke funnet", { status: 404 })

	const appIds = result.apps.map((a) => a.appId)
	const deploymentStats = await getDeploymentVerificationAggregate(appIds)

	const totalControls = result.apps.reduce((sum, a) => sum + a.total, 0)
	const totalImplemented = result.apps.reduce((sum, a) => sum + a.implemented, 0)
	const totalPartial = result.apps.reduce((sum, a) => sum + a.partial, 0)
	const totalNotImplemented = result.apps.reduce((sum, a) => sum + a.notImplemented, 0)
	const totalMangler = totalControls - totalImplemented - totalPartial - totalNotImplemented
	const overallPercent = compliancePercent(totalImplemented, totalPartial, totalControls)

	return data({
		seksjon,
		seksjonName: section?.name ?? seksjon,
		team,
		teamName: result.team.name,
		apps: result.apps,
		canAdmin: user ? isAdmin(user) : false,
		totalImplemented,
		totalPartial,
		totalMangler,
		overallPercent,
		deploymentStats,
	})
}

export default function TeamDashboard() {
	const {
		seksjon,
		team,
		teamName,
		apps,
		canAdmin,
		totalImplemented,
		totalPartial,
		totalMangler,
		overallPercent,
		deploymentStats,
	} = useLoaderData<typeof loader>()

	return (
		<VStack gap="space-8">
			<HStack align="center" justify="space-between" wrap>
				<Heading size="xlarge" level="2">
					{teamName}
				</Heading>
				{canAdmin && (
					<Button as={Link} to={`/seksjoner/${seksjon}/team/${team}/rediger`} variant="tertiary" size="small">
						Administrer
					</Button>
				)}
			</HStack>
			<BodyLong>
				Compliance-status per applikasjon for {teamName} i seksjon <Link to={`/seksjoner/${seksjon}`}>{seksjon}</Link>.
			</BodyLong>

			<HGrid gap="space-6" columns={{ xs: 2, sm: 3, md: 5 }}>
				<Box padding="space-6" borderRadius="8" background="sunken">
					<VStack align="center">
						<Heading size="xlarge" level="3">
							{overallPercent}%
						</Heading>
						<Detail>Total compliance</Detail>
					</VStack>
				</Box>
				<Box padding="space-6" borderRadius="8" background="sunken">
					<VStack align="center">
						<Heading size="xlarge" level="3">
							{apps.length}
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
							{totalMangler}
						</Heading>
						<Detail>Mangler</Detail>
					</VStack>
				</Box>
			</HGrid>

			<DeploymentSummaryCards stats={deploymentStats} />

			<Heading size="large" level="3">
				Applikasjoner
			</Heading>

			{apps.length > 0 ? (
				/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */
				<section className="table-scroll" tabIndex={0} aria-label="Applikasjoner per team">
					<Table>
						<Table.Header>
							<Table.Row>
								<Table.HeaderCell scope="col">Applikasjon</Table.HeaderCell>
								<Table.HeaderCell scope="col">Kilde</Table.HeaderCell>
								<Table.HeaderCell scope="col" align="right">
									Implementert
								</Table.HeaderCell>
								<Table.HeaderCell scope="col" align="right">
									Delvis
								</Table.HeaderCell>
								<Table.HeaderCell scope="col" align="right">
									Ikke impl.
								</Table.HeaderCell>
								<Table.HeaderCell scope="col" align="right">
									Ikke besvart
								</Table.HeaderCell>
								<Table.HeaderCell scope="col" align="right">
									Status %
								</Table.HeaderCell>
								<Table.HeaderCell scope="col" />
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{apps.map((app) => {
								const answered = app.implemented + app.partial + app.notImplemented
								const unanswered = Math.max(0, app.total - answered)
								const pct = compliancePercent(app.implemented, app.partial, app.total)
								return (
									<Table.Row key={app.appId}>
										<Table.DataCell>
											<Link to={`/applikasjoner/${app.appId}/detaljer`}>{app.appName}</Link>
										</Table.DataCell>
										<Table.DataCell>
											<Tag variant={app.source === "direct" ? "neutral" : "info"} size="xsmall">
												{app.source === "direct" ? "Direkte" : "Nais-team"}
											</Tag>
										</Table.DataCell>
										<Table.DataCell align="right">{app.implemented}</Table.DataCell>
										<Table.DataCell align="right">{app.partial}</Table.DataCell>
										<Table.DataCell align="right">{app.notImplemented}</Table.DataCell>
										<Table.DataCell align="right">{unanswered}</Table.DataCell>
										<Table.DataCell align="right">{pct}%</Table.DataCell>
										<Table.DataCell>
											<Link to={`/applikasjoner/${app.appId}/compliance`}>Vurder</Link>
										</Table.DataCell>
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
