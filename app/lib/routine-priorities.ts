/**
 * Routine priority levels.
 *
 * Lower numbers = higher priority (1 is most critical).
 * Used for sorting and visual indicators.
 */
export const ROUTINE_PRIORITIES = {
	CRITICAL: 1,
	HIGH: 2,
	NORMAL: 3,
} as const

export type RoutinePriority = (typeof ROUTINE_PRIORITIES)[keyof typeof ROUTINE_PRIORITIES]

/**
 * User-facing labels for priority levels.
 */
export const routinePriorityLabels: Record<RoutinePriority, string> = {
	1: "Kritisk",
	2: "Høy",
	3: "Normal",
}

/**
 * Aksel Tag variants for each priority level.
 */
export const routinePriorityVariants: Record<RoutinePriority, "error" | "warning" | "info"> = {
	1: "error", // Red - critical
	2: "warning", // Orange - high
	3: "info", // Blue - normal
}

/**
 * Check if a value is a valid routine priority.
 */
export function isValidRoutinePriority(value: unknown): value is RoutinePriority {
	return typeof value === "number" && [1, 2, 3].includes(value)
}
