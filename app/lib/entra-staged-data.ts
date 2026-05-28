import { z } from "zod"

export const ENTRA_STAGED_DATA_ACTIVITY_TYPE = "entra_id_group_maintenance" as const
export const ENTRA_STAGED_DATA_SCHEMA_VERSION = 1 as const

export const entraStagedGroupSourceValues = ["nais_auth", "manual", "ghost"] as const
export type EntraStagedGroupSource = (typeof entraStagedGroupSourceValues)[number]

export const entraCriticalityValues = ["low", "medium", "high", "very_high"] as const
export type EntraCriticality = (typeof entraCriticalityValues)[number]

export type EntraStagedGroup = {
	groupId: string
	groupName: string | null
	source: EntraStagedGroupSource
	hasNaisSource: boolean
	hasManualSource: boolean
	isNewAssessment: boolean
	isAddedDuringReview: boolean
	isGone: boolean
	seededManualGroupId: string | null
	criticality: EntraCriticality | null
	criticalitySetBy: string | null
	criticalitySetAt: string | null
}

export type EntraStagedData = {
	activityType: typeof ENTRA_STAGED_DATA_ACTIVITY_TYPE
	schemaVersion: typeof ENTRA_STAGED_DATA_SCHEMA_VERSION
	seededAt: string
	groups: EntraStagedGroup[]
}

export type EntraGroupSnapshot = {
	// New snapshots always have type and schemaVersion. Legacy snapshots written
	// before these fields were introduced may be missing them — parsers must
	// handle both cases (use snapshot.type as discriminant, fall back to legacy parser).
	type?: typeof ENTRA_STAGED_DATA_ACTIVITY_TYPE
	schemaVersion?: typeof ENTRA_STAGED_DATA_SCHEMA_VERSION
	groups: Array<{
		groupId: string
		groupName: string | null
		source: EntraStagedGroupSource
		hasNaisSource: boolean
		hasManualSource: boolean
		isGone: boolean
		criticality: EntraCriticality | null
	}>
}

export type StagedDataPatch =
	| {
			op: "set-criticality"
			groupId: string
			criticality: EntraCriticality
			setBy: string
			setAt: string
	  }
	| {
			op: "add-group"
			groupId: string
			groupName: string | null
	  }
	| {
			op: "mark-gone"
			groupId: string
	  }
	| {
			op: "remove-manual-source"
			groupId: string
	  }

const entraCriticalitySchema = z.enum(entraCriticalityValues)
const entraStagedGroupSourceSchema = z.enum(entraStagedGroupSourceValues)

export const entraStagedGroupSchema = z.object({
	groupId: z.string().min(1),
	groupName: z.string().min(1).nullable(),
	source: entraStagedGroupSourceSchema,
	hasNaisSource: z.boolean(),
	hasManualSource: z.boolean(),
	isNewAssessment: z.boolean(),
	isAddedDuringReview: z.boolean(),
	isGone: z.boolean(),
	seededManualGroupId: z.string().min(1).nullable(),
	criticality: entraCriticalitySchema.nullable(),
	criticalitySetBy: z.string().min(1).nullable(),
	criticalitySetAt: z.string().datetime().nullable(),
})

export const entraStagedDataSchema = z
	.object({
		activityType: z.literal(ENTRA_STAGED_DATA_ACTIVITY_TYPE),
		schemaVersion: z.literal(ENTRA_STAGED_DATA_SCHEMA_VERSION),
		seededAt: z.string().datetime(),
		groups: z.array(entraStagedGroupSchema),
	})
	.superRefine((data, ctx) => {
		const seen = new Set<string>()
		for (const [index, group] of data.groups.entries()) {
			if (seen.has(group.groupId)) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: `Duplicate groupId: ${group.groupId}`,
					path: ["groups", index, "groupId"],
				})
			}
			seen.add(group.groupId)

			if (group.hasNaisSource && group.source !== "nais_auth") {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: "Groups with NAIS source must use source='nais_auth'",
					path: ["groups", index, "source"],
				})
			}

			if (group.isGone && group.hasNaisSource) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: "Groups with NAIS source cannot be marked gone",
					path: ["groups", index, "isGone"],
				})
			}
		}
	})

export const entraGroupSnapshotSchema = z.object({
	// type and schemaVersion are optional for backward compatibility with legacy snapshots
	// that were written before these fields were introduced. New snapshots always include them.
	type: z.literal(ENTRA_STAGED_DATA_ACTIVITY_TYPE).optional(),
	schemaVersion: z.literal(ENTRA_STAGED_DATA_SCHEMA_VERSION).optional(),
	groups: z.array(
		z.object({
			groupId: z.string().min(1),
			groupName: z.string().min(1).nullable(),
			source: entraStagedGroupSourceSchema,
			hasNaisSource: z.boolean(),
			hasManualSource: z.boolean(),
			isGone: z.boolean(),
			criticality: entraCriticalitySchema.nullable(),
		}),
	),
})

export function parseEntraStagedData(data: unknown): EntraStagedData {
	return entraStagedDataSchema.parse(data)
}

export function parseEntraGroupSnapshot(data: unknown): EntraGroupSnapshot {
	return entraGroupSnapshotSchema.parse(data)
}

export function toEntraGroupSnapshot(data: EntraStagedData): EntraGroupSnapshot {
	return {
		type: ENTRA_STAGED_DATA_ACTIVITY_TYPE,
		schemaVersion: ENTRA_STAGED_DATA_SCHEMA_VERSION,
		groups: data.groups.map((group) => ({
			groupId: group.groupId,
			groupName: group.groupName,
			source: group.source,
			hasNaisSource: group.hasNaisSource,
			hasManualSource: group.hasManualSource,
			isGone: group.isGone,
			criticality: group.criticality,
		})),
	}
}

/**
 * Parses a snapshot written in the old legacy format (before the current Entra group
 * maintenance implementation). Legacy snapshots have:
 * - No `type` or `schemaVersion` fields
 * - `source` values of `"nais"`, `"manual"`, or `"removed"` (instead of the current
 *   `"nais_auth"`, `"manual"`, `"ghost"`)
 * - Potentially multiple rows per groupId (one "nais" + one "manual") that must be merged
 *
 * Returns null for null/invalid input. Source values are mapped to the current enum:
 * `"nais"` → `"nais_auth"`, `"removed"` → `"ghost"`.
 */
export function parseLegacyEntraGroupSnapshot(raw: unknown): EntraGroupSnapshot | null {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		return null
	}

	const groups = (raw as { groups?: unknown }).groups
	if (!Array.isArray(groups)) {
		return null
	}

	type LegacyEntry = {
		groupId: string
		groupName: string | null
		source: "nais" | "manual" | "removed"
		criticality: EntraCriticality | null
	}
	const validEntries: LegacyEntry[] = []
	for (const group of groups) {
		if (!group || typeof group !== "object" || Array.isArray(group)) {
			continue
		}
		const entry = group as {
			groupId?: unknown
			groupName?: unknown
			source?: unknown
			criticality?: unknown
		}
		if (typeof entry.groupId !== "string") {
			continue
		}
		if (entry.source !== "nais" && entry.source !== "manual" && entry.source !== "removed") {
			continue
		}
		const rawCriticality = typeof entry.criticality === "string" ? entry.criticality : null
		const criticality: EntraCriticality | null =
			rawCriticality !== null && (entraCriticalityValues as readonly string[]).includes(rawCriticality)
				? (rawCriticality as EntraCriticality)
				: null
		validEntries.push({
			groupId: entry.groupId,
			groupName: typeof entry.groupName === "string" ? entry.groupName : null,
			source: entry.source,
			criticality,
		})
	}

	// Merge entries with the same groupId — legacy snapshots can have both a
	// "nais" and a "manual" row for the same group (overlapping group membership).
	const merged = new Map<
		string,
		{
			groupId: string
			groupName: string | null
			source: EntraStagedGroupSource
			hasNaisSource: boolean
			hasManualSource: boolean
			isGone: boolean
			criticality: EntraCriticality | null
		}
	>()
	for (const entry of validEntries) {
		const existing = merged.get(entry.groupId)
		const hasNaisSource = entry.source === "nais" || (existing?.hasNaisSource ?? false)
		const hasManualSource = entry.source === "manual" || (existing?.hasManualSource ?? false)
		const source: EntraStagedGroupSource = hasNaisSource ? "nais_auth" : hasManualSource ? "manual" : "ghost"
		merged.set(entry.groupId, {
			groupId: entry.groupId,
			groupName: entry.groupName ?? existing?.groupName ?? null,
			source,
			hasNaisSource,
			hasManualSource,
			isGone: false,
			criticality: entry.criticality ?? existing?.criticality ?? null,
		})
	}

	return { groups: [...merged.values()] }
}

/**
 * Parses a raw snapshot value from the database into display data, handling all
 * known snapshot formats:
 * - New format: has `type: "entra_id_group_maintenance"` and `schemaVersion` — parsed
 *   directly with the current Zod schema.
 * - Pre-discriminant format: current source values (`nais_auth`/`manual`/`ghost`) but
 *   written before `type`/`schemaVersion` were introduced — also parsed with the
 *   current Zod schema (which accepts optional type/schemaVersion).
 * - Old legacy format: `source` values `"nais"`/`"manual"`/`"removed"` — parsed by
 *   `parseLegacyEntraGroupSnapshot`.
 *
 * Returns null for unknown/invalid input.
 */
export function parseCompletedEntraSnapshot(snapshot: unknown): EntraGroupSnapshot | null {
	if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
		return null
	}
	const hasTypeField =
		"type" in snapshot && (snapshot as Record<string, unknown>).type === ENTRA_STAGED_DATA_ACTIVITY_TYPE
	if (hasTypeField) {
		// New snapshots with explicit discriminant — use current parser directly.
		return parseEntraGroupSnapshot(snapshot)
	}
	// No type field: could be pre-discriminant (current source values) or truly old
	// legacy (nais/manual/removed). Try current schema first; fall back on ZodError.
	try {
		return parseEntraGroupSnapshot(snapshot)
	} catch {
		return parseLegacyEntraGroupSnapshot(snapshot)
	}
}

export function applyEntraStagedDataPatch(data: EntraStagedData, patch: StagedDataPatch): EntraStagedData {
	const parsed = parseEntraStagedData(data)
	const groups = parsed.groups.map((group) => ({ ...group }))
	const index = groups.findIndex((group) => group.groupId === patch.groupId)

	if (patch.op === "add-group") {
		if (index === -1) {
			return {
				...parsed,
				groups: [
					...groups,
					{
						groupId: patch.groupId,
						groupName: patch.groupName,
						source: "manual",
						hasNaisSource: false,
						hasManualSource: true,
						isNewAssessment: true,
						isAddedDuringReview: true,
						isGone: false,
						seededManualGroupId: null,
						criticality: null,
						criticalitySetBy: null,
						criticalitySetAt: null,
					},
				],
			}
		}

		const existing = groups[index]
		// Allow resurrection of gone groups OR ghost groups (source="ghost", no active sources).
		if (!existing.isGone && (existing.hasNaisSource || existing.hasManualSource)) {
			return parsed
		}

		groups[index] = {
			...existing,
			groupName: patch.groupName ?? existing.groupName,
			source: existing.hasNaisSource ? "nais_auth" : "manual",
			hasManualSource: true,
			isAddedDuringReview: existing.seededManualGroupId === null ? true : existing.isAddedDuringReview,
			isGone: false,
		}

		return {
			...parsed,
			groups,
		}
	}

	if (index === -1) {
		throw new Error(`Fant ikke Entra-gruppe ${patch.groupId}`)
	}

	const existing = groups[index]

	if (patch.op === "set-criticality") {
		if (existing.isGone) {
			throw new Error(`Kan ikke sette kritikalitet på fjernet gruppe ${patch.groupId}`)
		}
		groups[index] = {
			...existing,
			criticality: patch.criticality,
			criticalitySetBy: patch.setBy,
			criticalitySetAt: patch.setAt,
		}
		return {
			...parsed,
			groups,
		}
	}

	if (patch.op === "mark-gone") {
		if (existing.hasNaisSource) {
			throw new Error(`Kan ikke markere NAIS-gruppe ${patch.groupId} som fjernet`)
		}
		if (existing.isGone) {
			return parsed
		}
		groups[index] = {
			...existing,
			isGone: true,
		}
		return {
			...parsed,
			groups,
		}
	}

	if (patch.op === "remove-manual-source") {
		if (!existing.hasNaisSource || !existing.hasManualSource) {
			return parsed
		}

		groups[index] = {
			...existing,
			hasManualSource: false,
			source: "nais_auth",
		}

		return {
			...parsed,
			groups,
		}
	}

	patch satisfies never
	throw new Error(`Ukjent patch-operasjon`)
}
