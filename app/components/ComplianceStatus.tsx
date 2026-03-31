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

/** Renders comment text with auto-linked URLs */
export function ComplianceComment({ comment }: ComplianceCommentProps) {
	const parts = comment.split(/(https?:\/\/[^\s<]+)/g)
	const isUrl = (s: string) => /^https?:\/\//.test(s)

	const elements: React.ReactNode[] = []
	for (let i = 0; i < parts.length; i++) {
		const part = parts[i]
		if (!part) continue
		if (isUrl(part)) {
			elements.push(
				<AkselLink key={`url-${part}`} href={part} target="_blank" rel="noopener noreferrer">
					{part}
				</AkselLink>,
			)
		} else {
			elements.push(<span key={`text-${part}`}>{part}</span>)
		}
	}

	return <BodyLong size="small">{elements}</BodyLong>
}

export { statusLabels }
