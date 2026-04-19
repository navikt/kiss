import type { FileRejectionReason } from "@navikt/ds-react"

export const MAX_SIZE_MB = 50
export const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024

export type ActionResult = {
	success: boolean
	message?: string
	error?: string
	intent?: string
}

export type EntraGroupsDataProp = {
	naisGroupIds: string[]
	manualGroups: Array<{ id: string; groupId: string; groupName: string | null; createdBy: string; createdAt: string }>
	ghostGroupIds: string[]
	groupNames: Record<string, string>
	assessmentsByGroupId: Record<string, { criticality: string; updatedBy: string; updatedAt: string }>
}

export type ActivityProp = {
	id: string
	type: string
	status: string
	completedAt: string | null
	createdAt: string
	changes: Array<{
		id: string
		changeType: string
		groupId: string
		groupName: string | null
		previousValue: string | null
		newValue: string | null
		performedBy: string
		performedAt: string
	}>
}

export const groupCriticalityLabels: Record<string, string> = {
	low: "Lav",
	medium: "Middels",
	high: "Høy",
	very_high: "Svært høy",
}

export const groupCriticalityOptions = ["low", "medium", "high", "very_high"] as const

export const entraChangeTypeLabels: Record<string, string> = {
	added: "Lagt til",
	removed: "Fjernet",
	criticality_changed: "Kritikalitet endret",
}

export const rejectionErrors: Record<FileRejectionReason, string> = {
	fileType: "Filtypen er ikke støttet",
	fileSize: `Filen er for stor (maks ${MAX_SIZE_MB} MB)`,
}

export function formatDate(dateStr: string) {
	return new Date(dateStr).toLocaleDateString("nb-NO", {
		day: "numeric",
		month: "long",
		year: "numeric",
	})
}

export function formatDateTime(dateStr: string) {
	const d = new Date(dateStr)
	return d.toLocaleDateString("nb-NO", {
		day: "numeric",
		month: "long",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	})
}

export function formatFileSize(bytes: number | null) {
	if (!bytes) return "—"
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
