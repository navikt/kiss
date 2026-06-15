import { z } from "zod"

export const MANUAL_ACTIVITY_TYPE = "manual_activity" as const
export const MANUAL_ACTIVITY_SCHEMA_VERSION = 1 as const

// ─── Component config types ───────────────────────────────────────────────────

export const STEP_COMPONENT_TYPES = ["notater", "lenker", "vedlegg"] as const
export type StepComponentType = (typeof STEP_COMPONENT_TYPES)[number]

export type StepComponent = {
	type: StepComponentType
	required: boolean
}

// ─── Staged Data Types ────────────────────────────────────────────────────────

export type ComponentConfig = {
	/** Which UI components are enabled for this step. Present = explicitly configured. */
	items: StepComponent[]
}

export type ManualActivityStep = {
	/** References routine_checklist_steps.id at seed time */
	stepId: string
	title: string
	description: string | null
	completedAt: string | null
	completedBy: string | null
	notes: string | null
	/**
	 * Explicit component configuration. When present, only the listed components are shown.
	 * When absent (undefined), falls back to show-all for backward compatibility with legacy data.
	 */
	componentConfig?: ComponentConfig
}

export type ManualActivityStagedData = {
	activityType: typeof MANUAL_ACTIVITY_TYPE
	schemaVersion: typeof MANUAL_ACTIVITY_SCHEMA_VERSION
	steps: ManualActivityStep[]
}

// ─── Zod Schema ───────────────────────────────────────────────────────────────

const stepComponentSchema = z.object({
	type: z.enum(STEP_COMPONENT_TYPES),
	required: z.boolean(),
})

const manualActivityStepSchema = z
	.object({
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
		// New field written by current code
		componentConfig: z.object({ items: z.array(stepComponentSchema) }).optional(),
		// Legacy field — present in staged_data written before componentConfig was introduced
		components: z.array(stepComponentSchema).optional(),
	})
	.transform(({ components, componentConfig, ...rest }) => ({
		...rest,
		// If neither field is present → undefined (show all, backward compat)
		// If legacy `components` is present but new field is not → promote it
		// New `componentConfig` wins if both somehow exist
		componentConfig: componentConfig ?? (components !== undefined ? { items: components } : undefined),
	}))

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
