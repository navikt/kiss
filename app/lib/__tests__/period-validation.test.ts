import { describe, expect, it } from "vitest"
import { isPeriodEnded, isValidPeriodStart, isValidPeriodType, PERIOD_BOUNDARIES } from "../../lib/period-validation"

describe("period validation", () => {
	describe("isValidPeriodType", () => {
		it("accepts all valid period types", () => {
			expect(isValidPeriodType("yearly")).toBe(true)
			expect(isValidPeriodType("tertiary")).toBe(true)
			expect(isValidPeriodType("quarterly")).toBe(true)
			expect(isValidPeriodType("monthly")).toBe(true)
		})

		it("rejects invalid period types", () => {
			expect(isValidPeriodType("weekly")).toBe(false)
			expect(isValidPeriodType("")).toBe(false)
			expect(isValidPeriodType("Yearly")).toBe(false)
		})
	})

	describe("isValidPeriodStart", () => {
		it("accepts valid yearly boundary", () => {
			expect(isValidPeriodStart("yearly", "2025-01-01")).toBe(true)
		})

		it("rejects non-january for yearly", () => {
			expect(isValidPeriodStart("yearly", "2025-04-01")).toBe(false)
		})

		it("accepts valid tertiary boundaries", () => {
			expect(isValidPeriodStart("tertiary", "2025-01-01")).toBe(true)
			expect(isValidPeriodStart("tertiary", "2025-05-01")).toBe(true)
			expect(isValidPeriodStart("tertiary", "2025-09-01")).toBe(true)
		})

		it("rejects invalid tertiary months", () => {
			expect(isValidPeriodStart("tertiary", "2025-03-01")).toBe(false)
			expect(isValidPeriodStart("tertiary", "2025-06-01")).toBe(false)
		})

		it("accepts valid quarterly boundaries", () => {
			expect(isValidPeriodStart("quarterly", "2025-01-01")).toBe(true)
			expect(isValidPeriodStart("quarterly", "2025-04-01")).toBe(true)
			expect(isValidPeriodStart("quarterly", "2025-07-01")).toBe(true)
			expect(isValidPeriodStart("quarterly", "2025-10-01")).toBe(true)
		})

		it("rejects invalid quarterly months", () => {
			expect(isValidPeriodStart("quarterly", "2025-02-01")).toBe(false)
			expect(isValidPeriodStart("quarterly", "2025-05-01")).toBe(false)
		})

		it("accepts any first-of-month for monthly", () => {
			for (let m = 1; m <= 12; m++) {
				const month = String(m).padStart(2, "0")
				expect(isValidPeriodStart("monthly", `2025-${month}-01`)).toBe(true)
			}
		})

		it("rejects non-first-of-month", () => {
			expect(isValidPeriodStart("monthly", "2025-01-15")).toBe(false)
			expect(isValidPeriodStart("yearly", "2025-01-02")).toBe(false)
		})

		it("rejects invalid date format", () => {
			expect(isValidPeriodStart("yearly", "2025-1-1")).toBe(false)
			expect(isValidPeriodStart("yearly", "not-a-date")).toBe(false)
			expect(isValidPeriodStart("yearly", "")).toBe(false)
		})
	})

	describe("isPeriodEnded", () => {
		it("returns true for past yearly period", () => {
			expect(isPeriodEnded("yearly", "2024-01-01")).toBe(true)
		})

		it("returns false for current/future yearly period", () => {
			const futureYear = new Date().getFullYear() + 1
			expect(isPeriodEnded("yearly", `${futureYear}-01-01`)).toBe(false)
		})

		it("returns true for past monthly period", () => {
			expect(isPeriodEnded("monthly", "2024-01-01")).toBe(true)
		})

		it("returns false for future monthly period", () => {
			const futureYear = new Date().getFullYear() + 1
			expect(isPeriodEnded("monthly", `${futureYear}-01-01`)).toBe(false)
		})

		it("returns true for past quarterly period", () => {
			expect(isPeriodEnded("quarterly", "2024-01-01")).toBe(true)
		})

		it("returns true for past tertiary period", () => {
			expect(isPeriodEnded("tertiary", "2024-01-01")).toBe(true)
		})

		it("returns false for invalid date", () => {
			expect(isPeriodEnded("yearly", "not-a-date")).toBe(false)
		})
	})

	describe("PERIOD_BOUNDARIES", () => {
		it("has correct boundaries for each type", () => {
			expect(PERIOD_BOUNDARIES.yearly).toEqual([1])
			expect(PERIOD_BOUNDARIES.tertiary).toEqual([1, 5, 9])
			expect(PERIOD_BOUNDARIES.quarterly).toEqual([1, 4, 7, 10])
			expect(PERIOD_BOUNDARIES.monthly).toHaveLength(12)
		})
	})
})
