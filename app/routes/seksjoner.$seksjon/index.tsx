import {
	Link as AkselLink,
	Alert,
	BodyLong,
	BodyShort,
	Box,
	Detail,
	Heading,
	HGrid,
	HStack,
	VStack,
} from "@navikt/ds-react"
import type { LoaderFunctionArgs } from "react-router"
import { data, Link, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getNaisTeamsForSection, getUnassignedAppsForSection } from "~/db/queries/nais.server"
import { getSectionDetail } from "~/db/queries/sections.server"
import { compliancePercent } from "~/lib/utils"

export async function loader({ params }: LoaderFunctionArgs) {
	const seksjon = params.seksjon
	if (!seksjon) throw new Response("Mangler seksjon", { status: 400 })

	const result = await getSectionDetail(seksjon)
	if (!result) throw new Response("Seksjon ikke funnet", { status: 404 })

	const seksjonName = result.section.name
	const teams = result.teams

	const totalApps = teams.reduce((sum, t) => sum + t.apps, 0)
	const totalImplemented = teams.reduce((sum, t) => sum + t.implemented, 0)
	const totalPartial = teams.reduce((sum, t) => sum + t.partial, 0)
	const totalControls = teams.reduce((sum, t) => sum + t.total, 0)
	const totalNotRelevant = teams.reduce((sum, t) => sum + t.notRelevant, 0)
	const totalMangler = totalControls - totalImplemented - totalPartial - totalNotRelevant
	const overallPercent = compliancePercent(totalImplemented, totalPartial, totalControls, totalNotRelevant)

	const [linkedNaisTeams, unassignedApps] = await Promise.all([
		getNaisTeamsForSection(result.section.id),
		getUnassignedAppsForSection(result.section.id),
	])

	return data({
		seksjon,
		seksjonName,
		sectionId: result.section.id,
		teams,
		totalApps,
		totalImplemented,
		totalPartial,
		totalMangler,
		totalControls,
		overallPercent,
		naisTeamCount: linkedNaisTeams.length,
		unassignedAppCount: unassignedApps.length,
	})
}

export default function SeksjonDashboard() {
	const {
		seksjon,
		seksjonName,
		teams,
		totalApps,
		totalImplemented,
		totalPartial,
		totalMangler,
		overallPercent,
		naisTeamCount,
		unassignedAppCount,
	} = useLoaderData<typeof loader>()

	return (
		<VStack gap="space-8">
			<Heading size="xlarge" level="2">
				Seksjon: {seksjonName}
			</Heading>
			<BodyLong>Compliance-status for alle team i seksjonen.</BodyLong>

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
				<Box padding="space-6" borderRadius="8" background="sunken">
					<VStack align="center">
						<Heading size="xlarge" level="3">
							{totalApps}
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

			<Heading size="large" level="3">
				Status per team
			</Heading>

			<HGrid gap="space-6" columns={{ xs: 1, sm: 2 }}>
				{teams.map((team) => {
					const pct = compliancePercent(team.implemented, team.partial, team.total, team.notRelevant)
					const mangler = team.total - team.implemented - team.partial - team.notRelevant
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
								<BodyShort size="small">{team.apps} apper</BodyShort>
							</div>
							<div className="domain-status-card-link-footer">Se detaljer →</div>
						</Link>
					)
				})}
			</HGrid>

			{unassignedAppCount > 0 && (
				<Alert variant="warning">
					<Heading size="small" level="3" spacing>
						Applikasjoner uten team
					</Heading>
					{unassignedAppCount} {unassignedAppCount === 1 ? "applikasjon" : "applikasjoner"} fra seksjonens Nais-team er
					ikke koblet til et utviklingsteam og følges ikke opp for compliance.{" "}
					<AkselLink as={Link} to={`/seksjoner/${seksjon}/nais-team`}>
						Se og administrer Nais-team
					</AkselLink>
				</Alert>
			)}

			<HStack gap="space-4" align="center">
				<AkselLink as={Link} to={`/seksjoner/${seksjon}/nais-team`}>
					Administrer Nais-team ({naisTeamCount} koblet)
				</AkselLink>
			</HStack>
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
