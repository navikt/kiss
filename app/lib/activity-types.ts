/**
 * Single source of truth for routine activity type values.
 *
 * Import from here instead of using string literals.
 * The schema in app/db/schema/routines.ts re-exports the enum array
 * for Drizzle column definitions.
 */

import type { EvidenceProviderType } from "~/lib/evidence-providers/types"

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

export const DEPLOYMENT_EVIDENCE_ACTIVITY_TYPES = ["deployment_evidence_report"] as const

export type DeploymentEvidenceActivityType = (typeof DEPLOYMENT_EVIDENCE_ACTIVITY_TYPES)[number]

export function isDeploymentEvidenceActivityType(value: unknown): value is DeploymentEvidenceActivityType {
	return typeof value === "string" && (DEPLOYMENT_EVIDENCE_ACTIVITY_TYPES as readonly string[]).includes(value)
}

export const ROUTINE_ACTIVITY_TYPES = [
	"entra_id_group_maintenance",
	"rpa_user_maintenance",
	"oracle_role_criticality",
	"manual_activity",
	...ORACLE_EVIDENCE_ACTIVITY_TYPES,
	...DEPLOYMENT_EVIDENCE_ACTIVITY_TYPES,
] as const

export type RoutineActivityType = (typeof ROUTINE_ACTIVITY_TYPES)[number]

/** Norwegian display labels for each activity type. */
export const activityTypeLabels: Record<RoutineActivityType, string> = {
	entra_id_group_maintenance: "Entra ID-gruppevedlikehold",
	rpa_user_maintenance: "RPA-brukervedlikehold",
	oracle_role_criticality: "Oracle-rollekritikalitet",
	manual_activity: "Manuell aktivitet",
	oracle_evidence_audit: "Oracle Unified Audit-konfigurasjon",
	oracle_evidence_profiles: "Oracle-profiler",
	oracle_evidence_roles: "Oracle-roller",
	oracle_evidence_users: "Oracle-brukere",
	oracle_evidence_period: "Periodebasert gjennomgang",
	oracle_evidence_all: "Samlet Oracle-revisjonsbevis",
	deployment_evidence_report: "Leveranserapport",
}

/** Grouped activity types for building <optgroup> UI */
export const ACTIVITY_TYPE_GROUPS = [
	{ label: "Entra ID", types: ["entra_id_group_maintenance"] as const },
	{ label: "RPA", types: ["rpa_user_maintenance"] as const },
	{ label: "Oracle", types: ["oracle_role_criticality"] as const },
	{ label: "Manuell aktivitet", types: ["manual_activity"] as const },
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
	{
		label: "Leveranserapporter",
		types: ["deployment_evidence_report"] as const,
	},
] as const

// Compile-time exhaustiveness: every RoutineActivityType that is shown in the UI
// must appear in ACTIVITY_TYPE_GROUPS. Types not yet exposed
// are listed in HIDDEN_ACTIVITY_TYPES.
const HIDDEN_ACTIVITY_TYPES = [] as const
type HiddenTypes = (typeof HIDDEN_ACTIVITY_TYPES)[number]
type GroupedTypes = (typeof ACTIVITY_TYPE_GROUPS)[number]["types"][number]
type VisibleActivityTypes = Exclude<RoutineActivityType, HiddenTypes>
void (true as [VisibleActivityTypes] extends [GroupedTypes] ? true : false)
void (true as [GroupedTypes] extends [RoutineActivityType] ? true : false)
void (true as Extract<GroupedTypes, HiddenTypes> extends never ? true : false)

/** Maps Oracle evidence activity types to the evidence types they cover */
export const oracleEvidenceTypesForActivity: Record<OracleEvidenceActivityType, string[]> = {
	oracle_evidence_audit: ["audit"],
	oracle_evidence_profiles: ["profiles"],
	oracle_evidence_roles: ["roles"],
	oracle_evidence_users: ["users"],
	oracle_evidence_period: ["period"],
	oracle_evidence_all: ["audit", "profiles", "roles", "users", "period"],
}

/** Maps deployment evidence activity types to the evidence types they cover */
export const deploymentEvidenceTypesForActivity: Record<DeploymentEvidenceActivityType, string[]> = {
	deployment_evidence_report: ["deployment_evidence_report"],
}

/**
 * Returns the evidence provider type for a given activity type,
 * or null if the activity type is not an evidence provider activity.
 */
export function getProviderTypeForActivity(activityType: string): EvidenceProviderType | null {
	if (isOracleEvidenceActivityType(activityType)) return "oracle"
	if (isDeploymentEvidenceActivityType(activityType)) return "deployments"
	return null
}

/**
 * Returns the evidence types for a given activity type,
 * or null if the activity type is not an evidence provider activity.
 */
export function getEvidenceTypesForActivity(activityType: string): string[] | null {
	if (isOracleEvidenceActivityType(activityType)) return oracleEvidenceTypesForActivity[activityType]
	if (isDeploymentEvidenceActivityType(activityType)) return deploymentEvidenceTypesForActivity[activityType]
	return null
}
