export type ComplianceStatusValue = "not_relevant" | "not_implemented" | "partially_implemented" | "implemented"

const statusLabels: Record<ComplianceStatusValue, string> = {
	not_relevant: "Ikke relevant",
	not_implemented: "Ikke implementert",
	partially_implemented: "Delvis implementert",
	implemented: "Implementert",
}

const statusColors: Record<ComplianceStatusValue, string> = {
	not_relevant: "var(--a-gray-200)",
	not_implemented: "var(--a-red-200)",
	partially_implemented: "var(--a-orange-200)",
	implemented: "var(--a-green-200)",
}

interface ComplianceStatusBadgeProps {
	status: ComplianceStatusValue
}

export function ComplianceStatusBadge({ status }: ComplianceStatusBadgeProps) {
	return (
		<span className="compliance-badge" style={{ backgroundColor: statusColors[status] }}>
			{statusLabels[status]}
		</span>
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
				<a key={`url-${part}`} href={part} target="_blank" rel="noopener noreferrer">
					{part}
				</a>,
			)
		} else {
			elements.push(<span key={`text-${part}`}>{part}</span>)
		}
	}

	return <p className="compliance-comment">{elements}</p>
}

export { statusLabels }
