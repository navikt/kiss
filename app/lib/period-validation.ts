/**
 * Period validation helpers for NDA audit reports.
 *
 * Pure functions with no server dependencies — safe to import from
 * both server routes and client-side tests.
 */

export const PERIOD_TYPES = ["yearly", "tertiary", "quarterly", "monthly"] as const
export type PeriodType = (typeof PERIOD_TYPES)[number]

export const PERIOD_BOUNDARIES: Record<PeriodType, number[]> = {
	yearly: [1],
	tertiary: [1, 5, 9],
	quarterly: [1, 4, 7, 10],
	monthly: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
}

export function isValidPeriodType(value: string): value is PeriodType {
	return (PERIOD_TYPES as readonly string[]).includes(value)
}

export function isValidPeriodStart(periodType: PeriodType, periodStart: string): boolean {
	const match = periodStart.match(/^(\d{4})-(\d{2})-(\d{2})$/)
	if (!match) return false

	const month = Number.parseInt(match[2], 10)
	const day = Number.parseInt(match[3], 10)

	if (day !== 1) return false
	return PERIOD_BOUNDARIES[periodType].includes(month)
}

export function isPeriodEnded(periodType: PeriodType, periodStart: string): boolean {
	const match = periodStart.match(/^(\d{4})-(\d{2})-(\d{2})$/)
	if (!match) return false

	const year = Number.parseInt(match[1], 10)
	const month = Number.parseInt(match[2], 10) - 1 // 0-based

	let endYear: number
	let endMonth: number
	switch (periodType) {
		case "yearly":
			endYear = year + 1
			endMonth = 0
			break
		case "tertiary":
			endYear = year + Math.floor((month + 4) / 12)
			endMonth = (month + 4) % 12
			break
		case "quarterly":
			endYear = year + Math.floor((month + 3) / 12)
			endMonth = (month + 3) % 12
			break
		case "monthly":
			endYear = year + Math.floor((month + 1) / 12)
			endMonth = (month + 1) % 12
			break
	}

	const now = new Date()
	const currentYear = now.getFullYear()
	const currentMonth = now.getMonth()
	return endYear < currentYear || (endYear === currentYear && endMonth <= currentMonth)
}
