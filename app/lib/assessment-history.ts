import type { ComplianceStatus } from "~/lib/compliance-status"

export interface AssessmentChange {
	id: string
	controlId: string
	previousStatus: ComplianceStatus | null
	newStatus: ComplianceStatus
	previousComment: string | null
	newComment: string | null
	changedBy: string
	changedAt: string
}

/** Build a diff summary between two assessment states */
export function describeChange(change: AssessmentChange): string {
	const parts: string[] = []

	if (change.previousStatus !== change.newStatus) {
		if (change.previousStatus) {
			parts.push(`Status endret fra "${change.previousStatus}" til "${change.newStatus}"`)
		} else {
			parts.push(`Status satt til "${change.newStatus}"`)
		}
	}

	if (change.previousComment !== change.newComment) {
		if (!change.previousComment && change.newComment) {
			parts.push("Kommentar lagt til")
		} else if (change.previousComment && !change.newComment) {
			parts.push("Kommentar fjernet")
		} else {
			parts.push("Kommentar oppdatert")
		}
	}

	return parts.length > 0 ? parts.join(". ") : "Ingen endringer"
}
