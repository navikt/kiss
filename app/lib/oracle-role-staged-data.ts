import { z } from "zod"
import { type GroupCriticality, groupCriticalityEnum } from "~/db/schema/applications"

export const ORACLE_ROLE_CRITICALITY_ACTIVITY_TYPE = "oracle_role_criticality" as const
export const ORACLE_ROLE_CRITICALITY_SCHEMA_VERSION = 1 as const

/**
 * Matching-nøkkel: "instanceId:ROLENAME" (instanceId as-is; roleName uppercase + trimmed).
 * Canonical form matches what oracle_role_assessments stores.
 */
export const ORACLE_ROLE_CRITICALITY_MATCHING_KEY = "instanceId (as-is):roleName (uppercase + trimmed)" as const

const groupCriticalitySchema = z.enum([...groupCriticalityEnum] as [GroupCriticality, ...GroupCriticality[]])

export type OracleRoleStagedEntry = {
	instanceId: string
	roleName: string
	oracleMaintained: boolean | null
	common: boolean | null
	/** True when role is returned by M2M-API but has no active assessment in KISS */
	isNew: boolean
	/** True when role has an active assessment in KISS but was NOT returned by the M2M-API */
	isGone: boolean
	criticality: GroupCriticality | null
	criticalitySetBy: string | null
	criticalitySetAt: string | null
}

export type OracleRoleCriticalityStagedData = {
	activityType: typeof ORACLE_ROLE_CRITICALITY_ACTIVITY_TYPE
	schemaVersion: typeof ORACLE_ROLE_CRITICALITY_SCHEMA_VERSION
	seededAt: string
	/** True when the Oracle revisjon API was unavailable during seeding */
	apiUnavailable: boolean
	roles: OracleRoleStagedEntry[]
}

export type OracleRoleCriticalitySnapshot = {
	type: typeof ORACLE_ROLE_CRITICALITY_ACTIVITY_TYPE
	schemaVersion: typeof ORACLE_ROLE_CRITICALITY_SCHEMA_VERSION
	apiUnavailable?: true
	roles: Array<{
		instanceId: string
		roleName: string
		oracleMaintained: boolean | null
		common: boolean | null
		isGone: boolean
		criticality: GroupCriticality | null
	}>
}

export type OracleRoleCriticalityStagedDataPatch = {
	op: "set-criticality"
	instanceId: string
	roleName: string
	criticality: GroupCriticality
	setBy: string
	setAt: string
}

export const oracleRoleStagedEntrySchema = z.object({
	instanceId: z.string().min(1),
	roleName: z.string().min(1),
	oracleMaintained: z.boolean().nullable(),
	common: z.boolean().nullable(),
	isNew: z.boolean(),
	isGone: z.boolean(),
	criticality: groupCriticalitySchema.nullable(),
	criticalitySetBy: z.string().min(1).nullable(),
	criticalitySetAt: z.string().datetime().nullable(),
})

export const oracleRoleCriticalityStagedDataSchema = z
	.object({
		activityType: z.literal(ORACLE_ROLE_CRITICALITY_ACTIVITY_TYPE),
		schemaVersion: z.literal(ORACLE_ROLE_CRITICALITY_SCHEMA_VERSION),
		seededAt: z.string().datetime(),
		apiUnavailable: z.boolean(),
		roles: z.array(oracleRoleStagedEntrySchema),
	})
	.superRefine((data, ctx) => {
		const seen = new Set<string>()
		for (const [index, role] of data.roles.entries()) {
			const key = `${role.instanceId}:${role.roleName}`
			if (seen.has(key)) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: `Duplicate role key: ${key}`,
					path: ["roles", index, "roleName"],
				})
			}
			seen.add(key)

			if (role.isNew && role.isGone) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: "A role cannot be both isNew and isGone",
					path: ["roles", index, "isNew"],
				})
			}
		}
	})

export const oracleRoleCriticalitySnapshotSchema = z.object({
	type: z.literal(ORACLE_ROLE_CRITICALITY_ACTIVITY_TYPE),
	schemaVersion: z.literal(ORACLE_ROLE_CRITICALITY_SCHEMA_VERSION),
	apiUnavailable: z.literal(true).optional(),
	roles: z.array(
		z.object({
			instanceId: z.string().min(1),
			roleName: z.string().min(1),
			oracleMaintained: z.boolean().nullable(),
			common: z.boolean().nullable(),
			isGone: z.boolean(),
			criticality: groupCriticalitySchema.nullable(),
		}),
	),
})

export function parseOracleRoleCriticalityStagedData(data: unknown): OracleRoleCriticalityStagedData {
	return oracleRoleCriticalityStagedDataSchema.parse(data)
}

export function parseOracleRoleCriticalitySnapshot(data: unknown): OracleRoleCriticalitySnapshot {
	return oracleRoleCriticalitySnapshotSchema.parse(data)
}

export function toOracleRoleCriticalitySnapshot(data: OracleRoleCriticalityStagedData): OracleRoleCriticalitySnapshot {
	return {
		type: ORACLE_ROLE_CRITICALITY_ACTIVITY_TYPE,
		schemaVersion: ORACLE_ROLE_CRITICALITY_SCHEMA_VERSION,
		...(data.apiUnavailable ? { apiUnavailable: true as const } : {}),
		roles: data.roles.map((role) => ({
			instanceId: role.instanceId,
			roleName: role.roleName,
			oracleMaintained: role.oracleMaintained,
			common: role.common,
			isGone: role.isGone,
			criticality: role.criticality,
		})),
	}
}

export function applyOracleRoleCriticalityPatch(
	data: OracleRoleCriticalityStagedData,
	patch: OracleRoleCriticalityStagedDataPatch,
): OracleRoleCriticalityStagedData {
	const parsed = parseOracleRoleCriticalityStagedData(data)
	const roles = parsed.roles.map((role) => ({ ...role }))

	if (patch.op === "set-criticality") {
		const index = roles.findIndex((role) => role.instanceId === patch.instanceId && role.roleName === patch.roleName)
		if (index === -1) {
			throw new Error(`Fant ikke Oracle-rolle ${patch.instanceId}:${patch.roleName}`)
		}
		const existing = roles[index]
		if (existing.isGone) {
			throw new Error(`Kan ikke sette kritikalitet på rolle markert som borte: ${patch.instanceId}:${patch.roleName}`)
		}
		roles[index] = {
			...existing,
			criticality: patch.criticality,
			criticalitySetBy: patch.setBy,
			criticalitySetAt: patch.setAt,
		}
		return { ...parsed, roles }
	}

	throw new Error("Ukjent patch-operasjon")
}
