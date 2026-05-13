import { Tag } from "@navikt/ds-react"
import type { EvidenceItemStatus } from "~/lib/evidence-providers/types"

export function statusVariant(status: EvidenceItemStatus): "success" | "warning" | "error" {
	switch (status) {
		case "ok":
			return "success"
		case "partial":
			return "warning"
		case "failed":
			return "error"
		default:
			return "warning"
	}
}

export function statusLabel(status: EvidenceItemStatus): string {
	switch (status) {
		case "ok":
			return "OK"
		case "partial":
			return "Delvis"
		case "failed":
			return "Feilet"
		case "pending":
			return "Venter"
		case "processing":
			return "Behandles"
		case "not_available":
			return "Ikke tilgjengelig"
		default:
			return status
	}
}

export function EvidenceStatusBadge({ status }: { status: EvidenceItemStatus }) {
	return (
		<Tag variant={statusVariant(status)} size="xsmall">
			{statusLabel(status)}
		</Tag>
	)
}
