/**
 * Single source of truth for routine activity type values.
 *
 * Import from here instead of using string literals.
 * The schema in app/db/schema/routines.ts re-exports the enum array
 * for Drizzle column definitions.
 */

export const ORACLE_EVIDENCE_ACTIVITY_TYPES = [
	"oracle_evidence_audit",
	"oracle_evidence_profiles",
	"oracle_evidence_roles",
	"oracle_evidence_users",
	"oracle_evidence_period",
	"oracle_evidence_all",
] as const

export type OracleEvidenceActivityType = (typeof ORACLE_EVIDENCE_ACTIVITY_TYPES)[number]

export function isOracleEvidenceActivityType(value: unknown): value is OracleEvidenceActivityType {
	return typeof value === "string" && (ORACLE_EVIDENCE_ACTIVITY_TYPES as readonly string[]).includes(value)
}

export const ROUTINE_ACTIVITY_TYPES = ["entra_id_group_maintenance", ...ORACLE_EVIDENCE_ACTIVITY_TYPES] as const

export type RoutineActivityType = (typeof ROUTINE_ACTIVITY_TYPES)[number]

/** Norwegian display labels for each activity type. */
export const activityTypeLabels: Record<RoutineActivityType, string> = {
	entra_id_group_maintenance: "Entra ID-gruppevedlikehold",
	oracle_evidence_audit: "Oracle Unified Audit-konfigurasjon",
	oracle_evidence_profiles: "Oracle-profiler",
	oracle_evidence_roles: "Oracle-roller",
	oracle_evidence_users: "Oracle-brukere",
	oracle_evidence_period: "Periodebasert gjennomgang",
	oracle_evidence_all: "Samlet Oracle-revisjonsbevis",
}

/** Grouped activity types for building <optgroup> UI */
export const ACTIVITY_TYPE_GROUPS = [
	{ label: "Entra ID", types: ["entra_id_group_maintenance"] as const },
	{
		label: "Oracle revisjonsbevis",
		types: [
			"oracle_evidence_audit",
			"oracle_evidence_profiles",
			"oracle_evidence_roles",
			"oracle_evidence_users",
			"oracle_evidence_period",
			"oracle_evidence_all",
		] as const,
	},
] as const

// Compile-time exhaustiveness: every RoutineActivityType must appear in ACTIVITY_TYPE_GROUPS
// and vice versa. Adding/removing a type without updating the groups causes a build error.
type GroupedTypes = (typeof ACTIVITY_TYPE_GROUPS)[number]["types"][number]
// biome-ignore lint/correctness/noUnusedVariables: compile-time exhaustiveness check
const _assertAllTypesGrouped: [RoutineActivityType] extends [GroupedTypes] ? true : false = true
// biome-ignore lint/correctness/noUnusedVariables: compile-time exhaustiveness check
const _assertNoExtraTypes: [GroupedTypes] extends [RoutineActivityType] ? true : false = true

/** Maps Oracle evidence activity types to the evidence types they cover */
export const oracleEvidenceTypesForActivity: Record<OracleEvidenceActivityType, string[]> = {
	oracle_evidence_audit: ["audit"],
	oracle_evidence_profiles: ["profiles"],
	oracle_evidence_roles: ["roles"],
	oracle_evidence_users: ["users"],
	oracle_evidence_period: ["period"],
	oracle_evidence_all: ["audit", "profiles", "roles", "users", "period"],
}
