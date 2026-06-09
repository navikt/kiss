import { BodyLong, BodyShort, Box, Detail, Heading, HGrid, VStack } from "@navikt/ds-react"
import type { LoaderFunctionArgs } from "react-router"
import { data, Link, useLoaderData } from "react-router"
import { DeploymentSummaryCards } from "~/components/DeploymentSummaryCards"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getDeploymentVerificationAggregate } from "~/db/queries/deployment-audit.server"
import { getDomainSummaries } from "~/db/queries/framework.server"
import { compliancePercent } from "~/lib/utils"

interface DomainStatus {
	code: string
	name: string
	implemented: number
	partial: number
	notImplemented: number
	notRelevant: number
	total: number
	controlCount: number
	controlsWithGaps: number
}

export async function loader(_args: LoaderFunctionArgs) {
	const [summaries, deploymentStats] = await Promise.all([getDomainSummaries(), getDeploymentVerificationAggregate()])

	// Merge domains with the same name
	const mergedMap = new Map<string, DomainStatus>()
	for (const s of summaries) {
		const existing = mergedMap.get(s.name)
		if (existing) {
			existing.implemented += s.implemented
			existing.partial += s.partial
			existing.notImplemented += s.notImplemented
			existing.notRelevant += s.notRelevant
			existing.total += s.totalAssessments
			existing.controlCount += s.controlCount
			existing.controlsWithGaps += s.controlsWithGaps
		} else {
			mergedMap.set(s.name, {
				code: s.code,
				name: s.name,
				implemented: s.implemented,
				partial: s.partial,
				notImplemented: s.notImplemented,
				notRelevant: s.notRelevant,
				total: s.totalAssessments,
				controlCount: s.controlCount,
				controlsWithGaps: s.controlsWithGaps,
			})
		}
	}
	const domainStatuses = [...mergedMap.values()]

	const totalControls = domainStatuses.reduce((sum, d) => sum + d.total, 0)
	const totalImplemented = domainStatuses.reduce((sum, d) => sum + d.implemented, 0)
	const totalPartial = domainStatuses.reduce((sum, d) => sum + d.partial, 0)
	const totalNotRelevant = domainStatuses.reduce((sum, d) => sum + d.notRelevant, 0)
	const totalMangler = totalControls - totalImplemented - totalPartial - totalNotRelevant
	const overallPercent = compliancePercent(totalImplemented, totalPartial, totalControls, totalNotRelevant)

	return data({
		domainStatuses,
		totalControls,
		totalImplemented,
		totalPartial,
		totalMangler,
		overallPercent,
		deploymentStats,
	})
}

export default function Dashboard() {
	const { domainStatuses, totalImplemented, totalPartial, totalMangler, overallPercent, deploymentStats } =
		useLoaderData<typeof loader>()

	return (
		<VStack gap="space-8">
			<Heading size="xlarge" level="2">
				Dashboard
			</Heading>
			<BodyLong>
				Overordnet status for SDLC compliance i Kontrollrammeverk for Integrert Sikker Systemutvikling.
			</BodyLong>

			<HGrid gap="space-6" columns={{ xs: 2, sm: 4 }}>
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
						<Detail>Delvis implementert</Detail>
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
				Status per domene
			</Heading>

			<HGrid gap="space-6" columns={{ xs: 1, sm: 2 }}>
				{domainStatuses.map((domain) => {
					const pct = compliancePercent(domain.implemented, domain.partial, domain.total, domain.notRelevant)
					const mangler = domain.total - domain.implemented - domain.partial - domain.notRelevant
					return (
						<Link key={domain.code} to={`/kontrollrammeverk/${domain.code}`} className="domain-status-card-link">
							<div className="domain-status-header">
								<Heading size="small" level="4">
									{domain.name}
								</Heading>
								<BodyShort weight="semibold">{pct}%</BodyShort>
							</div>
							<div
								className="domain-status-bar"
								role="progressbar"
								aria-valuenow={pct}
								aria-valuemin={0}
								aria-valuemax={100}
								aria-label={`${domain.name} compliance ${pct}%`}
							>
								<div
									className="domain-status-bar-implemented"
									style={{
										width: `${domain.total - domain.notRelevant > 0 ? (domain.implemented / (domain.total - domain.notRelevant)) * 100 : 0}%`,
									}}
								/>
								<div
									className="domain-status-bar-partial"
									style={{
										width: `${domain.total - domain.notRelevant > 0 ? (domain.partial / (domain.total - domain.notRelevant)) * 100 : 0}%`,
									}}
								/>
							</div>
							<div className="domain-status-details">
								<BodyShort size="small">{domain.implemented} implementert</BodyShort>
								<BodyShort size="small">{domain.partial} delvis</BodyShort>
								<BodyShort size="small">{mangler} mangler</BodyShort>
							</div>
							{domain.controlsWithGaps > 0 ? (
								<div className="domain-status-card-link-footer">
									{domain.controlsWithGaps} av {domain.controlCount} kontroller har mangler →
								</div>
							) : (
								<div className="domain-status-card-link-footer">Alle kontroller i orden →</div>
							)}
						</Link>
					)
				})}
			</HGrid>

			<DeploymentSummaryCards stats={deploymentStats} />
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
