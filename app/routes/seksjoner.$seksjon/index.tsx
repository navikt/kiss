import { BodyLong, Heading, HGrid, VStack } from "@navikt/ds-react"
import type { LoaderFunctionArgs } from "react-router"
import { data, Link, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { mockSeksjonTeams } from "~/lib/mock-data.server"
import { compliancePercent } from "~/lib/utils"

export async function loader({ params }: LoaderFunctionArgs) {
	const seksjon = params.seksjon
	if (!seksjon) throw new Response("Mangler seksjon", { status: 400 })

	const seksjonName = seksjon.charAt(0).toUpperCase() + seksjon.slice(1).replace(/-/g, " ")
	const teams = mockSeksjonTeams

	const totalApps = teams.reduce((sum, t) => sum + t.apps, 0)
	const totalImplemented = teams.reduce((sum, t) => sum + t.implemented, 0)
	const totalPartial = teams.reduce((sum, t) => sum + t.partial, 0)
	const totalControls = teams.reduce((sum, t) => sum + t.total, 0)
	const overallPercent = compliancePercent(totalImplemented, totalPartial, totalControls)

	return data({ seksjon, seksjonName, teams, totalApps, totalImplemented, totalPartial, totalControls, overallPercent })
}

export default function SeksjonDashboard() {
	const { seksjon, seksjonName, teams, totalApps, totalImplemented, totalPartial, totalControls, overallPercent } =
		useLoaderData<typeof loader>()

	return (
		<VStack gap="space-8">
			<Heading size="xlarge" level="2">
				Seksjon: {seksjonName}
			</Heading>
			<BodyLong>Compliance-status for alle team i seksjonen.</BodyLong>

			<div className="dashboard-summary">
				<div className="dashboard-metric">
					<span className="dashboard-metric-value">{overallPercent}%</span>
					<span className="dashboard-metric-label">Total compliance</span>
				</div>
				<div className="dashboard-metric">
					<span className="dashboard-metric-value">{teams.length}</span>
					<span className="dashboard-metric-label">Team</span>
				</div>
				<div className="dashboard-metric">
					<span className="dashboard-metric-value">{totalApps}</span>
					<span className="dashboard-metric-label">Applikasjoner</span>
				</div>
				<div className="dashboard-metric">
					<span className="dashboard-metric-value">{totalImplemented}</span>
					<span className="dashboard-metric-label">Implementert</span>
				</div>
				<div className="dashboard-metric">
					<span className="dashboard-metric-value">{totalPartial}</span>
					<span className="dashboard-metric-label">Delvis implementert</span>
				</div>
				<div className="dashboard-metric">
					<span className="dashboard-metric-value">{totalControls}</span>
					<span className="dashboard-metric-label">Totalt kontroller</span>
				</div>
			</div>

			<Heading size="large" level="3">
				Status per team
			</Heading>

			<HGrid gap="space-6" columns={{ xs: 1, sm: 2 }}>
				{teams.map((team) => {
					const pct = compliancePercent(team.implemented, team.partial, team.total)
					return (
						<Link
							key={team.slug}
							to={`/seksjoner/${seksjon}/team/${team.slug}`}
							style={{ textDecoration: "none", color: "inherit" }}
						>
							<div className="domain-status-card">
								<div className="domain-status-header">
									<Heading size="small" level="4">
										{team.name}
									</Heading>
									<span className="domain-status-pct">{pct}%</span>
								</div>
								<div
									className="domain-status-bar"
									role="progressbar"
									aria-valuenow={pct}
									aria-valuemin={0}
									aria-valuemax={100}
									aria-label={`${team.name} compliance ${pct}%`}
								>
									<div
										className="domain-status-bar-implemented"
										style={{ width: `${team.total > 0 ? (team.implemented / team.total) * 100 : 0}%` }}
									/>
									<div
										className="domain-status-bar-partial"
										style={{ width: `${team.total > 0 ? (team.partial / team.total) * 100 : 0}%` }}
									/>
								</div>
								<div className="domain-status-details">
									<span>{team.implemented} implementert</span>
									<span>{team.partial} delvis</span>
									<span>{team.notImplemented} mangler</span>
									<span>{team.apps} apper</span>
								</div>
							</div>
						</Link>
					)
				})}
			</HGrid>
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
