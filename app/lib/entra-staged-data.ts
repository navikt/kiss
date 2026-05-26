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
