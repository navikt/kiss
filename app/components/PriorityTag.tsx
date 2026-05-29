import { Tag } from "@navikt/ds-react"
import { isValidRoutinePriority, routinePriorityLabels, routinePriorityVariants } from "~/lib/routine-priorities"

interface PriorityTagProps {
	priority: number
	size?: "small" | "medium"
}

/**
 * Visual indicator for routine priority.
 *
 * Shows colored tag with priority label:
 * - Kritisk (red)
 * - Høy (orange)
 * - Normal (blue)
 */
export function PriorityTag({ priority, size = "small" }: PriorityTagProps) {
	if (!isValidRoutinePriority(priority)) {
		return (
			<Tag variant="neutral" size={size}>
				Ukjent
			</Tag>
		)
	}
	const label = routinePriorityLabels[priority]
	const variant = routinePriorityVariants[priority]

	return (
		<Tag variant={variant} size={size}>
			{label}
		</Tag>
	)
}
