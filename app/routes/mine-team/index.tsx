import { BodyLong, BodyShort, Box, Detail, Heading, HGrid, Table, Tag, VStack } from "@navikt/ds-react"
import type { LoaderFunctionArgs } from "react-router"
import { data, Link, redirect, useLoaderData } from "react-router"
import { DeploymentSummaryCards } from "~/components/DeploymentSummaryCards"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getDeploymentVerificationAggregate } from "~/db/queries/deployment-audit.server"
import { getAppsForMultipleTeams } from "~/db/queries/sections.server"
import { getUserRoles } from "~/db/queries/users.server"
import { getAuthenticatedUser } from "~/lib/auth.server"
import { compliancePercent } from "~/lib/utils"

export async function loader({ request }: LoaderFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	if (!user) throw redirect("/dashboard")

	const roles = await getUserRoles(user.navIdent)
	const teamIds = [...new Set(roles.filter((r) => r.devTeamId).map((r) => r.devTeamId as string))]

	if (teamIds.length === 0) {
		return data({ hasTeams: false as const, teams: [], apps: [], deploymentStats: null, totals: null })
	}

	const { teams, apps } = await getAppsForMultipleTeams(teamIds)
	const appIds = apps.map((a) => a.appId)
	const deploymentStats = await getDeploymentVerificationAggregate(appIds)

	const totalControls = apps.reduce((sum, a) => sum + a.total, 0)
	const totalImplemented = apps.reduce((sum, a) => sum + a.implemented, 0)
	const totalPartial = apps.reduce((sum, a) => sum + a.partial, 0)
	const totalNotImplemented = apps.reduce((sum, a) => sum + a.notImplemented, 0)
	const totalMangler = totalControls - totalImplemented - totalPartial - totalNotImplemented
	const overallPercent = compliancePercent(totalImplemented, totalPartial, totalControls)

	return data({
		hasTeams: true as const,
		teams: teams.map((t) => ({
			id: t.id,
			name: t.name,
			slug: t.slug,
			sectionSlug: t.sectionSlug,
			sectionName: t.sectionName,
		})),
		apps,
		deploymentStats,
		totals: {
			apps: apps.length,
			implemented: totalImplemented,
			partial: totalPartial,
			mangler: totalMangler,
			percent: overallPercent,
		},
	})
}

export default function MineTeamPage() {
	const loaderData = useLoaderData<typeof loader>()

	if (!loaderData.hasTeams) {
		return (
			<VStack gap="space-8">
				<Heading size="xlarge" level="2">
					Mine team
				</Heading>
				<BodyLong>
					Du er ikke tilknyttet noen team. Gå til <Link to="/profil">profilen din</Link> for å koble deg til en seksjon
					og et team.
				</BodyLong>
			</VStack>
		)
	}

	const { teams, apps, deploymentStats, totals } = loaderData
	const teamById = new Map(teams.map((t) => [t.id, t]))

	return (
		<VStack gap="space-8">
			<Heading size="xlarge" level="2">
				Mine team
			</Heading>
			<BodyLong>
				Samlet compliance-status for alle team du er tilknyttet ({teams.length} {teams.length === 1 ? "team" : "team"}).
			</BodyLong>

			{/* Team tags */}
			<Box padding="space-6" borderRadius="8" background="sunken">
				<VStack gap="space-4">
					<Heading size="small" level="3">
						Team
					</Heading>
					<div style={{ display: "flex", flexWrap: "wrap", gap: "var(--ax-space-4)" }}>
						{teams.map((t) => (
							<Link key={t.id} to={`/seksjoner/${t.sectionSlug}/team/${t.slug}`}>
								<Tag variant="info" size="small">
									{t.name}
								</Tag>
								<BodyShort size="small" textColor="subtle" as="span" style={{ marginLeft: "var(--ax-space-2)" }}>
									{t.sectionName}
								</BodyShort>
							</Link>
						))}
					</div>
				</VStack>
			</Box>

			{/* Summary cards */}
			{totals && (
				<HGrid gap="space-6" columns={{ xs: 2, sm: 3, md: 5 }}>
					<Box padding="space-6" borderRadius="8" background="sunken">
						<VStack align="center">
							<Heading size="xlarge" level="3">
								{totals.percent}%
							</Heading>
							<Detail>Total compliance</Detail>
						</VStack>
					</Box>
					<Box padding="space-6" borderRadius="8" background="sunken">
						<VStack align="center">
							<Heading size="xlarge" level="3">
								{totals.apps}
							</Heading>
							<Detail>Applikasjoner</Detail>
						</VStack>
					</Box>
					<Box padding="space-6" borderRadius="8" background="sunken">
						<VStack align="center">
							<Heading size="xlarge" level="3">
								{totals.implemented}
							</Heading>
							<Detail>Implementert</Detail>
						</VStack>
					</Box>
					<Box padding="space-6" borderRadius="8" background="sunken">
						<VStack align="center">
							<Heading size="xlarge" level="3">
								{totals.partial}
							</Heading>
							<Detail>Delvis</Detail>
						</VStack>
					</Box>
					<Box padding="space-6" borderRadius="8" background="sunken">
						<VStack align="center">
							<Heading size="xlarge" level="3">
								{totals.mangler}
							</Heading>
							<Detail>Mangler</Detail>
						</VStack>
					</Box>
				</HGrid>
			)}

			{deploymentStats && <DeploymentSummaryCards stats={deploymentStats} />}

			{/* App table */}
			<Heading size="large" level="3">
				Applikasjoner
			</Heading>

			{apps.length > 0 ? (
				/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */
				<section className="table-scroll" tabIndex={0} aria-label="Applikasjoner på tvers av mine team">
					<Table>
						<Table.Header>
							<Table.Row>
								<Table.HeaderCell scope="col">Applikasjon</Table.HeaderCell>
								<Table.HeaderCell scope="col">Team</Table.HeaderCell>
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
								const appTeams = app.teamIds
									.map((tid) => teamById.get(tid))
									.filter((t): t is NonNullable<typeof t> => t != null)
								return (
									<Table.Row key={app.appId}>
										<Table.DataCell>
											<Link to={`/mine-team/applikasjoner/${app.appId}/detaljer`}>{app.appName}</Link>
										</Table.DataCell>
										<Table.DataCell>
											<div style={{ display: "flex", flexWrap: "wrap", gap: "var(--ax-space-2)" }}>
												{appTeams.map((t) => (
													<Tag key={t.id} variant="alt3" size="xsmall">
														{t.name}
													</Tag>
												))}
											</div>
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
											<Link to={`/mine-team/applikasjoner/${app.appId}/compliance`}>Vurder</Link>
										</Table.DataCell>
									</Table.Row>
								)
							})}
						</Table.Body>
					</Table>
				</section>
			) : (
				<BodyLong>Ingen applikasjoner er tilknyttet dine team.</BodyLong>
			)}
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
