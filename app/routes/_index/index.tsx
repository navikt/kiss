import { BodyLong, Heading, HGrid, VStack } from "@navikt/ds-react"
import type { LoaderFunctionArgs } from "react-router"
import { data, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { compliancePercent, getDomainSummaries } from "~/lib/mock-data.server"

interface DomainStatus {
	name: string
	implemented: number
	partial: number
	notImplemented: number
	notRelevant: number
	total: number
}

export async function loader(_args: LoaderFunctionArgs) {
	const summaries = getDomainSummaries()

	// Placeholder compliance data – will be replaced with DB aggregation
	const complianceByDomain: Record<string, Omit<DomainStatus, "name">> = {
		ST: { implemented: 1, partial: 1, notImplemented: 0, notRelevant: 0, total: 2 },
		TS: { implemented: 3, partial: 4, notImplemented: 2, notRelevant: 2, total: 11 },
		EH: { implemented: 2, partial: 1, notImplemented: 2, notRelevant: 0, total: 5 },
		DR: { implemented: 1, partial: 2, notImplemented: 1, notRelevant: 2, total: 6 },
	}

	const domainStatuses: DomainStatus[] = summaries.map((s) => ({
		name: s.name,
		...(complianceByDomain[s.code] ?? { implemented: 0, partial: 0, notImplemented: 0, notRelevant: 0, total: 0 }),
	}))

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
						<div key={domain.name} className="domain-status-card">
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
						</div>
					)
				})}
			</HGrid>
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
