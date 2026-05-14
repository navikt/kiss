import type { SyncJobState } from "~/db/schema/sync-jobs"

export const SYNC_JOB_STATE_TAGS: Record<
	SyncJobState,
	{ label: string; variant: "neutral" | "info" | "success" | "error" | "warning" }
> = {
	pending: { label: "Venter", variant: "neutral" },
	running: { label: "Pågår", variant: "info" },
	completed: { label: "Fullført", variant: "success" },
	failed: { label: "Feilet", variant: "error" },
	skipped: { label: "Hoppet over", variant: "warning" },
}

export const SYNC_JOB_STATE_VALUES = Object.keys(SYNC_JOB_STATE_TAGS) as SyncJobState[]

export function getSyncJobStateLabel(state: SyncJobState): string {
	return SYNC_JOB_STATE_TAGS[state].label
}

export function getSyncJobStateTagVariant(state: SyncJobState): "neutral" | "info" | "success" | "error" | "warning" {
	return SYNC_JOB_STATE_TAGS[state].variant
}
