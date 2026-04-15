/**
 * Single source of truth for compliance/assessment status values.
 *
 * Import from here instead of using string literals.
 * The schema in app/db/schema/compliance.ts re-exports the enum array
 * for Drizzle column definitions.
 */

export const COMPLIANCE_STATUSES = ["not_relevant", "not_implemented", "partially_implemented", "implemented"] as const

export type ComplianceStatus = (typeof COMPLIANCE_STATUSES)[number]

/** Norwegian display labels for each status value. */
export const statusLabels: Record<ComplianceStatus, string> = {
	not_relevant: "Ikke relevant",
	not_implemented: "Ikke implementert",
	partially_implemented: "Delvis implementert",
	implemented: "Implementert",
}

/** Aksel Tag variant for each status value. */
export const statusVariants: Record<ComplianceStatus, "neutral" | "error" | "warning" | "success"> = {
	not_relevant: "neutral",
	not_implemented: "error",
	partially_implemented: "warning",
	implemented: "success",
}

/** Type guard — returns true when the value is a valid ComplianceStatus. */
export function isComplianceStatus(value: unknown): value is ComplianceStatus {
	return typeof value === "string" && (COMPLIANCE_STATUSES as readonly string[]).includes(value)
}

/** Get the Aksel Tag variant for a status value, with fallback. */
export function getStatusVariant(status: string | null | undefined): "neutral" | "error" | "warning" | "success" {
	if (status && isComplianceStatus(status)) return statusVariants[status]
	return "neutral"
}

/** Get the Norwegian label for a status value, with fallback. */
export function getStatusLabel(status: string | null | undefined, fallback = "Ikke vurdert"): string {
	if (status && isComplianceStatus(status)) return statusLabels[status]
	return fallback
}

// ─── Two-dimensional compliance model ────────────────────────────────────

/** Akse 1: Har kontrollen en tilknyttet rutine? */
export type RoutineEstablishment = "established" | "not_established" | "not_relevant"

export const establishmentLabels: Record<RoutineEstablishment, string> = {
	established: "Rutine etablert",
	not_established: "Mangler rutine",
	not_relevant: "Ikke relevant",
}

export const establishmentVariants: Record<RoutineEstablishment, "success" | "error" | "neutral"> = {
	established: "success",
	not_established: "error",
	not_relevant: "neutral",
}

/** Akse 2: Er rutinen gjennomført i henhold til frist? */
export type RoutineCompliance = "completed" | "overdue" | "never_reviewed" | "not_applicable"

export const complianceLabels: Record<RoutineCompliance, string> = {
	completed: "Gjennomført",
	overdue: "Forfalt",
	never_reviewed: "Ikke gjennomført",
	not_applicable: "Ikke aktuelt",
}

export const complianceVariants: Record<RoutineCompliance, "success" | "warning" | "error" | "neutral"> = {
	completed: "success",
	overdue: "warning",
	never_reviewed: "error",
	not_applicable: "neutral",
}
