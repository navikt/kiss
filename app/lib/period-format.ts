import { isValidPeriodStart, isValidPeriodType, type PeriodType } from "./period-validation"

const PERIOD_TYPE_LABELS: Record<PeriodType, string> = {
	yearly: "Årlig",
	tertiary: "Tertialsvis",
	quarterly: "Kvartalsvis",
	monthly: "Månedlig",
}

/**
 * Formats a selected period to a compact label used in UI/status payloads.
 * Throws for invalid period boundaries so callers with validated input
 * fail fast instead of silently drifting to inconsistent labels.
 */
export function formatPeriodLabel(periodType: PeriodType, periodStart: string): string {
	if (!isValidPeriodStart(periodType, periodStart)) {
		throw new Error(`Invalid periodStart '${periodStart}' for periodType '${periodType}'`)
	}

	const year = periodStart.slice(0, 4)
	const month = periodStart.slice(5, 7)

	switch (periodType) {
		case "yearly":
			return year
		case "tertiary":
			if (month === "01") return `T1 ${year}`
			if (month === "05") return `T2 ${year}`
			return `T3 ${year}`
		case "quarterly":
			if (month === "01") return `Q1 ${year}`
			if (month === "04") return `Q2 ${year}`
			if (month === "07") return `Q3 ${year}`
			return `Q4 ${year}`
		case "monthly":
			return periodStart
	}
}

export function getPeriodTypeLabel(periodType: string): string {
	if (!isValidPeriodType(periodType)) return periodType
	return PERIOD_TYPE_LABELS[periodType]
}

export function formatPeriodLabelSafe(periodType: string, periodStart: string): string {
	if (!isValidPeriodType(periodType)) return periodStart
	if (!isValidPeriodStart(periodType, periodStart)) return periodStart
	return formatPeriodLabel(periodType, periodStart)
}
