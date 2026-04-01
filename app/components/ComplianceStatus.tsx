import { Link as AkselLink, BodyLong, Tag } from "@navikt/ds-react"

export type ComplianceStatusValue = "not_relevant" | "not_implemented" | "partially_implemented" | "implemented"

const statusLabels: Record<ComplianceStatusValue, string> = {
	not_relevant: "Ikke relevant",
	not_implemented: "Ikke implementert",
	partially_implemented: "Delvis implementert",
	implemented: "Implementert",
}

const statusVariants: Record<ComplianceStatusValue, "neutral" | "error" | "warning" | "success"> = {
	not_relevant: "neutral",
	not_implemented: "error",
	partially_implemented: "warning",
	implemented: "success",
}

interface ComplianceStatusBadgeProps {
	status: ComplianceStatusValue
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

export { statusLabels }
