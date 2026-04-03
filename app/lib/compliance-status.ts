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
