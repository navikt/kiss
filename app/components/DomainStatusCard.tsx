import { BodyShort, Heading } from "@navikt/ds-react"
import { Link } from "react-router"

interface DomainStatusCardProps {
	to: string
	title: string
	pct: number
	implemented: number
	partial: number
	mangler: number
	/** Denominator for the progress bar segments — typically `total - notRelevant`. */
	barTotal: number
	/** Optional extra detail lines shown below "mangler", e.g. application count. */
	extraDetails?: React.ReactNode
	footer: React.ReactNode
}

/**
 * Compliance status card with a progress bar, used for domains, teams and other
 * groupings across the dashboard and section pages. Keep this in sync across
 * usages so filtering/toggling behaves consistently everywhere.
 */
export function DomainStatusCard({
	to,
	title,
	pct,
	implemented,
	partial,
	mangler,
	barTotal,
	extraDetails,
	footer,
}: DomainStatusCardProps) {
	return (
		<Link to={to} className="domain-status-card-link">
			<div className="domain-status-header">
				<Heading size="small" level="4">
					{title}
				</Heading>
				<BodyShort weight="semibold">{pct}%</BodyShort>
			</div>
			<div
				className="domain-status-bar"
				role="progressbar"
				aria-valuenow={pct}
				aria-valuemin={0}
				aria-valuemax={100}
				aria-label={`${title} compliance ${pct}%`}
			>
				<div
					className="domain-status-bar-implemented"
					style={{ width: `${barTotal > 0 ? (implemented / barTotal) * 100 : 0}%` }}
				/>
				<div
					className="domain-status-bar-partial"
					style={{ width: `${barTotal > 0 ? (partial / barTotal) * 100 : 0}%` }}
				/>
			</div>
			<div className="domain-status-details">
				<BodyShort size="small">{implemented} implementert</BodyShort>
				<BodyShort size="small">{partial} delvis</BodyShort>
				<BodyShort size="small">{mangler} mangler</BodyShort>
				{extraDetails}
			</div>
			<div className="domain-status-card-link-footer">{footer}</div>
		</Link>
	)
}
