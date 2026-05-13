export const VALID_PERIODS = ["1h", "6h", "24h", "7d"] as const
export type Period = (typeof VALID_PERIODS)[number]

export function normalizePeriod(input: string): Period {
	return VALID_PERIODS.includes(input as Period) ? (input as Period) : "6h"
}

export function periodToInterval(period: Period): string {
	switch (period) {
		case "1h":
			return "1 hour"
		case "6h":
			return "6 hours"
		case "24h":
			return "24 hours"
		case "7d":
			return "7 days"
	}
}
