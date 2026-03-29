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
	const urlRegex = /(https?:\/\/[^\s<]+)/g
	const parts = comment.split(urlRegex)

	return (
		<p className="compliance-comment">
			{parts.map((part) =>
				urlRegex.test(part) ? (
					<a key={part} href={part} target="_blank" rel="noopener noreferrer">
						{part}
					</a>
				) : (
					<span key={part}>{part}</span>
				),
			)}
		</p>
	)
}

export { statusColors, statusLabels }
