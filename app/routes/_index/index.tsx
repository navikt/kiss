import { BodyLong, Heading, HGrid, VStack } from "@navikt/ds-react"
import type { LoaderFunctionArgs } from "react-router"
import { data, Link, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
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
	const summaries = await getDomainSummaries()

	// Merge domains with the same name
	const mergedMap = new Map<string, DomainStatus>()
	for (const s of summaries) {
		const existing = mergedMap.get(s.name)
		if (existing) {
			existing.implemented += s.implemented
			existing.partial += s.partial
			existing.notImplemented += s.notImplemented
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
				notRelevant: 0,
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
	const overallPercent = compliancePercent(totalImplemented, totalPartial, totalControls)

	return data({ domainStatuses, totalControls, totalImplemented, totalPartial, overallPercent })
}

export default function Dashboard() {
	const { domainStatuses, totalControls, totalImplemented, totalPartial, overallPercent } =
		useLoaderData<typeof loader>()

	return (
		<VStack gap="space-8">
			<Heading size="xlarge" level="2">
				Dashboard
			</Heading>
			<BodyLong>
				Overordnet status for SDLC compliance i Kontrollrammeverk for Integrert Sikker Systemutvikling.
			</BodyLong>

			<div className="dashboard-summary">
				<div className="dashboard-metric">
					<span className="dashboard-metric-value">{overallPercent}%</span>
					<span className="dashboard-metric-label">Total compliance</span>
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
				Status per domene
			</Heading>

			<HGrid gap="space-6" columns={{ xs: 1, sm: 2 }}>
				{domainStatuses.map((domain) => {
					const pct = compliancePercent(domain.implemented, domain.partial, domain.total)
					return (
						<Link key={domain.code} to={`/kontrollrammeverk/${domain.code}`} className="domain-status-card-link">
							<div className="domain-status-header">
								<Heading size="small" level="4">
									{domain.name}
								</Heading>
								<span className="domain-status-pct">{pct}%</span>
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
									style={{ width: `${domain.total > 0 ? (domain.implemented / domain.total) * 100 : 0}%` }}
								/>
								<div
									className="domain-status-bar-partial"
									style={{ width: `${domain.total > 0 ? (domain.partial / domain.total) * 100 : 0}%` }}
								/>
							</div>
							<div className="domain-status-details">
								<span>{domain.implemented} implementert</span>
								<span>{domain.partial} delvis</span>
								<span>{domain.notImplemented} mangler</span>
							</div>
							{domain.controlsWithGaps > 0 ? (
								<div className="domain-status-card-link-footer">
									{domain.controlsWithGaps} av {domain.controlCount} kontroller har mangler →
								</div>
							) : (
								<div className="domain-status-card-link-footer">Se detaljer →</div>
							)}
						</Link>
					)
				})}
			</HGrid>
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
