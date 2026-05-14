import { describe, expect, it } from "vitest"
import { normalizePeriod, periodToInterval } from "../audit-log-periods"

describe("normalizePeriod", () => {
	it.each(["1h", "6h", "24h", "7d"] as const)("returns %s for valid input", (period) => {
		expect(normalizePeriod(period)).toBe(period)
	})

	it("falls back to 6h for unknown input", () => {
		expect(normalizePeriod("2h")).toBe("6h")
		expect(normalizePeriod("")).toBe("6h")
		expect(normalizePeriod("bogus")).toBe("6h")
	})
})

describe("periodToInterval", () => {
	it.each([
		["1h", "1 hour"],
		["6h", "6 hours"],
		["24h", "24 hours"],
		["7d", "7 days"],
	] as const)("maps %s to %s", (period, expected) => {
		expect(periodToInterval(period)).toBe(expected)
	})
})
