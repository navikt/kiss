import { z } from "zod"

export const MANUAL_ACTIVITY_TYPE = "manual_activity" as const
export const MANUAL_ACTIVITY_SCHEMA_VERSION = 1 as const

// ─── Staged Data Types ────────────────────────────────────────────────────────

export type ManualActivityStep = {
	/** References routine_checklist_steps.id at seed time */
	stepId: string
	title: string
	description: string | null
	completedAt: string | null
	completedBy: string | null
	notes: string | null
}

export type ManualActivityStagedData = {
	activityType: typeof MANUAL_ACTIVITY_TYPE
	schemaVersion: typeof MANUAL_ACTIVITY_SCHEMA_VERSION
	steps: ManualActivityStep[]
}

// ─── Zod Schema ───────────────────────────────────────────────────────────────

const manualActivityStepSchema = z.object({
	stepId: z.string().uuid(),
	title: z.string(),
	description: z.string().nullable(),
	completedAt: z.string().nullable(),
	completedBy: z.string().nullable(),
	notes: z
		.string()
		.nullable()
		.optional()
		.transform((v) => v ?? null),
})

const manualActivityStagedDataSchema = z.object({
	activityType: z.literal(MANUAL_ACTIVITY_TYPE),
	schemaVersion: z.literal(MANUAL_ACTIVITY_SCHEMA_VERSION),
	steps: z.array(manualActivityStepSchema),
})

// ─── Parsers ──────────────────────────────────────────────────────────────────

export function parseManualActivityStagedData(raw: unknown): ManualActivityStagedData {
	return manualActivityStagedDataSchema.parse(raw)
}

export function isManualActivity(raw: unknown): raw is ManualActivityStagedData {
	return manualActivityStagedDataSchema.safeParse(raw).success
}

export function isManualActivityComplete(data: ManualActivityStagedData): boolean {
	return data.steps.length > 0 && data.steps.every((s) => s.completedAt !== null)
}
