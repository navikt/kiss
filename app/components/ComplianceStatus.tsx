import { Link as AkselLink, BodyLong, Tag } from "@navikt/ds-react"
import { type ComplianceStatus, statusLabels, statusVariants } from "~/lib/compliance-status"

export type { ComplianceStatus as ComplianceStatusValue }
export { statusLabels }

interface ComplianceStatusBadgeProps {
	status: ComplianceStatus
}

export function ComplianceStatusBadge({ status }: ComplianceStatusBadgeProps) {
	return (
		<Tag variant={statusVariants[status]} size="small">
			{statusLabels[status]}
		</Tag>
	)
}

interface ComplianceCommentProps {
	comment: string
}

/** Renders comment text with auto-linked URLs and relative paths */
export function ComplianceComment({ comment }: ComplianceCommentProps) {
	// Match absolute URLs (https://...) and relative paths (/api/... /dokumenter/...)
	const parts = comment.split(/(https?:\/\/[^\s<]+|\/api\/[^\s<]+|\/dokumenter\/[^\s<]+)/g)
	const isAbsoluteUrl = (s: string) => /^https?:\/\//.test(s)
	const isRelativePath = (s: string) => /^\/(?:api|dokumenter)\//.test(s)

	const elements: React.ReactNode[] = []
	for (let i = 0; i < parts.length; i++) {
		const part = parts[i]
		if (!part) continue
		if (isAbsoluteUrl(part)) {
			elements.push(
				<AkselLink key={`url-${i}`} href={part} target="_blank" rel="noopener noreferrer">
					{part}
					<span className="navds-sr-only"> (åpnes i nytt vindu)</span>
				</AkselLink>,
			)
		} else if (isRelativePath(part)) {
			elements.push(
				<AkselLink key={`path-${i}`} href={part} target="_blank" rel="noopener noreferrer">
					{part}
				</AkselLink>,
			)
		} else {
			elements.push(<span key={`text-${i}`}>{part}</span>)
		}
	}

	return <BodyLong size="small">{elements}</BodyLong>
}
