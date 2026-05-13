import { BodyLong, BodyShort, Box, Button, Detail, Heading, HGrid, HStack, VStack } from "@navikt/ds-react"
import type { LoaderFunctionArgs } from "react-router"
import { data, Link, useLoaderData } from "react-router"
import { ComplianceStatsPlaceholder } from "~/components/ComplianceStatsPlaceholder"
import { DeploymentSummaryCards } from "~/components/DeploymentSummaryCards"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getDeploymentVerificationAggregate } from "~/db/queries/deployment-audit.server"
import { getSectionDetail } from "~/db/queries/sections.server"
import { useFeatureFlags } from "~/hooks/useFeatureFlags"
import { getAuthenticatedUser } from "~/lib/auth.server"
import { isAdmin } from "~/lib/authorization.server"
import { compliancePercent } from "~/lib/utils"

export async function loader({ request, params }: LoaderFunctionArgs) {
	const seksjon = params.seksjon
	if (!seksjon) throw new Response("Mangler seksjon", { status: 400 })

	const user = await getAuthenticatedUser(request)

	const result = await getSectionDetail(seksjon)
	if (!result) throw new Response("Seksjon ikke funnet", { status: 404 })

	const deploymentStats = await getDeploymentVerificationAggregate(result.allAppIds)

	const seksjonName = result.section.name
	const teams = result.teams
	const unassigned = result.unassignedStats
	const st = result.sectionTotals

	const totalApps = st.apps
	const totalImplemented = st.implemented
	const totalPartial = st.partial
	const totalControls = st.total
	const totalNotRelevant = st.notRelevant
	const totalMangler = totalControls - totalImplemented - totalPartial - st.notImplemented - totalNotRelevant
	const overallPercent = compliancePercent(totalImplemented, totalPartial, totalControls, totalNotRelevant)

	return data({
		seksjon,
		seksjonName,
		sectionId: result.section.id,
		teams,
		unassigned,
		totalApps,
		totalImplemented,
		totalPartial,
		totalMangler,
		totalControls,
		overallPercent,
		canAdmin: user ? isAdmin(user) : false,
		deploymentStats,
	})
}

export default function SeksjonDashboard() {
	const {
		seksjon,
		seksjonName,
		teams,
		unassigned,
		totalApps,
		totalImplemented,
		totalPartial,
		totalMangler,
		overallPercent,
		canAdmin,
		deploymentStats,
	} = useLoaderData<typeof loader>()
	const { showComplianceStats } = useFeatureFlags()

	return (
		<VStack gap="space-8">
			<HStack align="center" justify="space-between" wrap>
				<Heading size="xlarge" level="2">
					Seksjon: {seksjonName}
				</Heading>
				{canAdmin && (
					<Button as={Link} to={`/seksjoner/${seksjon}/rediger`} variant="tertiary" size="small">
						Administrer
					</Button>
				)}
			</HStack>
			<HStack gap="space-4" wrap>
				<Button as={Link} to={`/seksjoner/${seksjon}/screening`} variant="secondary" size="small">
					Screening-spørsmål
				</Button>
				<Button as={Link} to={`/seksjoner/${seksjon}/rutiner`} variant="secondary" size="small">
					Rutiner
				</Button>
				<Button as={Link} to={`/seksjoner/${seksjon}/seksjonsrutiner`} variant="secondary" size="small">
					Seksjonsrutiner
				</Button>
				<Button as={Link} to={`/seksjoner/${seksjon}/regelsett`} variant="secondary" size="small">
					Regelsett
				</Button>
				<Button as={Link} to={`/seksjoner/${seksjon}/entra-grupper`} variant="secondary" size="small">
					Entra ID-grupper
				</Button>
				<Button as={Link} to={`/seksjoner/${seksjon}/oracle-roller`} variant="secondary" size="small">
					Oracle-roller
				</Button>
				<Button as={Link} to={`/seksjoner/${seksjon}/rpa-brukere`} variant="secondary" size="small">
					RPA-brukere
				</Button>
				<Button as={Link} to={`/seksjoner/${seksjon}/okonomisystemer`} variant="secondary" size="small">
					Økonomisystemer
				</Button>
				<Button as={Link} to={`/seksjoner/${seksjon}/audit-logging`} variant="secondary" size="small">
					Audit logging
				</Button>
				{canAdmin && (
					<Button as={Link} to={`/seksjoner/${seksjon}/koblingsforslag`} variant="secondary" size="small">
						Koblingsforslag
					</Button>
				)}
			</HStack>
			<BodyLong>Compliance-status for alle team i seksjonen.</BodyLong>

			{showComplianceStats ? (
				<HGrid gap="space-6" columns={{ xs: 2, sm: 3, md: 6 }}>
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
								{teams.length}
							</Heading>
							<Detail>Team</Detail>
						</VStack>
					</Box>
					<Link to={`/seksjoner/${seksjon}/applikasjoner`} style={{ textDecoration: "none", color: "inherit" }}>
						<Box padding="space-6" borderRadius="8" background="sunken">
							<VStack align="center">
								<Heading size="xlarge" level="3">
									{totalApps}
								</Heading>
								<Detail>Applikasjoner</Detail>
							</VStack>
						</Box>
					</Link>
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
			) : (
				<>
					<ComplianceStatsPlaceholder />
					<HGrid gap="space-6" columns={{ xs: 2, sm: 3 }}>
						<Box padding="space-6" borderRadius="8" background="sunken">
							<VStack align="center">
								<Heading size="xlarge" level="3">
									{teams.length}
								</Heading>
								<Detail>Team</Detail>
							</VStack>
						</Box>
						<Link to={`/seksjoner/${seksjon}/applikasjoner`} style={{ textDecoration: "none", color: "inherit" }}>
							<Box padding="space-6" borderRadius="8" background="sunken">
								<VStack align="center">
									<Heading size="xlarge" level="3">
										{totalApps}
									</Heading>
									<Detail>Applikasjoner</Detail>
								</VStack>
							</Box>
						</Link>
					</HGrid>
				</>
			)}

			<DeploymentSummaryCards stats={deploymentStats} />

			<Heading size="large" level="3">
				Team
			</Heading>

			{showComplianceStats ? (
				<HGrid gap="space-6" columns={{ xs: 1, sm: 2 }}>
					{teams.map((team) => {
						const pct = compliancePercent(team.implemented, team.partial, team.total, team.notRelevant)
						const mangler = team.total - team.implemented - team.partial - team.notImplemented - team.notRelevant
						return (
							<Link key={team.slug} to={`/seksjoner/${seksjon}/team/${team.slug}`} className="domain-status-card-link">
								<div className="domain-status-header">
									<Heading size="small" level="4">
										{team.name}
									</Heading>
									<BodyShort weight="semibold">{pct}%</BodyShort>
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
										style={{
											width: `${team.total - team.notRelevant > 0 ? (team.implemented / (team.total - team.notRelevant)) * 100 : 0}%`,
										}}
									/>
									<div
										className="domain-status-bar-partial"
										style={{
											width: `${team.total - team.notRelevant > 0 ? (team.partial / (team.total - team.notRelevant)) * 100 : 0}%`,
										}}
									/>
								</div>
								<div className="domain-status-details">
									<BodyShort size="small">{team.implemented} implementert</BodyShort>
									<BodyShort size="small">{team.partial} delvis</BodyShort>
									<BodyShort size="small">{mangler} mangler</BodyShort>
									<BodyShort size="small">{team.apps} applikasjoner</BodyShort>
								</div>
								<div className="domain-status-card-link-footer">Se detaljer →</div>
							</Link>
						)
					})}
					{unassigned.apps > 0 &&
						(() => {
							const pct = compliancePercent(
								unassigned.implemented,
								unassigned.partial,
								unassigned.total,
								unassigned.notRelevant,
							)
							const mangler =
								unassigned.total -
								unassigned.implemented -
								unassigned.partial -
								unassigned.notImplemented -
								unassigned.notRelevant
							return (
								<Link to={`/seksjoner/${seksjon}/rediger?fane=applikasjoner`} className="domain-status-card-link">
									<div className="domain-status-header">
										<Heading size="small" level="4">
											Uten team
										</Heading>
										<BodyShort weight="semibold">{pct}%</BodyShort>
									</div>
									<div
										className="domain-status-bar"
										role="progressbar"
										aria-valuenow={pct}
										aria-valuemin={0}
										aria-valuemax={100}
										aria-label={`Uten team compliance ${pct}%`}
									>
										<div
											className="domain-status-bar-implemented"
											style={{
												width: `${unassigned.total - unassigned.notRelevant > 0 ? (unassigned.implemented / (unassigned.total - unassigned.notRelevant)) * 100 : 0}%`,
											}}
										/>
										<div
											className="domain-status-bar-partial"
											style={{
												width: `${unassigned.total - unassigned.notRelevant > 0 ? (unassigned.partial / (unassigned.total - unassigned.notRelevant)) * 100 : 0}%`,
											}}
										/>
									</div>
									<div className="domain-status-details">
										<BodyShort size="small">{unassigned.implemented} implementert</BodyShort>
										<BodyShort size="small">{unassigned.partial} delvis</BodyShort>
										<BodyShort size="small">{mangler} mangler</BodyShort>
										<BodyShort size="small">{unassigned.apps} applikasjoner</BodyShort>
									</div>
									<div className="domain-status-card-link-footer">Administrer →</div>
								</Link>
							)
						})()}
				</HGrid>
			) : (
				<HGrid gap="space-6" columns={{ xs: 1, sm: 2 }}>
					{teams.map((team) => (
						<Link key={team.slug} to={`/seksjoner/${seksjon}/team/${team.slug}`} className="domain-status-card-link">
							<div className="domain-status-header">
								<Heading size="small" level="4">
									{team.name}
								</Heading>
							</div>
							<div className="domain-status-details">
								<BodyShort size="small">{team.apps} applikasjoner</BodyShort>
							</div>
							<div className="domain-status-card-link-footer">Se detaljer →</div>
						</Link>
					))}
					{unassigned.apps > 0 && (
						<Link to={`/seksjoner/${seksjon}/rediger?fane=applikasjoner`} className="domain-status-card-link">
							<div className="domain-status-header">
								<Heading size="small" level="4">
									Uten team
								</Heading>
							</div>
							<div className="domain-status-details">
								<BodyShort size="small">{unassigned.apps} applikasjoner</BodyShort>
							</div>
							<div className="domain-status-card-link-footer">Administrer →</div>
						</Link>
					)}
				</HGrid>
			)}
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
