import { describe, expect, it } from "vitest"
import { formatPeriodLabel, formatPeriodLabelSafe, getPeriodEndDate, getPeriodTypeLabel } from "../period-format"

describe("period format helpers", () => {
	describe("formatPeriodLabel", () => {
		it("formats yearly period label", () => {
			expect(formatPeriodLabel("yearly", "2025-01-01")).toBe("2025")
		})

		it("formats tertiary period labels", () => {
			expect(formatPeriodLabel("tertiary", "2025-01-01")).toBe("T1 2025")
			expect(formatPeriodLabel("tertiary", "2025-05-01")).toBe("T2 2025")
			expect(formatPeriodLabel("tertiary", "2025-09-01")).toBe("T3 2025")
		})

		it("formats quarterly period labels", () => {
			expect(formatPeriodLabel("quarterly", "2025-01-01")).toBe("Q1 2025")
			expect(formatPeriodLabel("quarterly", "2025-04-01")).toBe("Q2 2025")
			expect(formatPeriodLabel("quarterly", "2025-07-01")).toBe("Q3 2025")
			expect(formatPeriodLabel("quarterly", "2025-10-01")).toBe("Q4 2025")
		})

		it("returns ISO date for monthly labels", () => {
			expect(formatPeriodLabel("monthly", "2025-11-01")).toBe("2025-11-01")
		})

		it("throws on invalid period start for type", () => {
			expect(() => formatPeriodLabel("quarterly", "2025-02-01")).toThrow("Invalid periodStart")
		})
	})

	describe("getPeriodTypeLabel", () => {
		it("returns Norwegian labels for known period types", () => {
			expect(getPeriodTypeLabel("yearly")).toBe("Årlig")
			expect(getPeriodTypeLabel("tertiary")).toBe("Tertialsvis")
			expect(getPeriodTypeLabel("quarterly")).toBe("Kvartalsvis")
			expect(getPeriodTypeLabel("monthly")).toBe("Månedlig")
		})

		it("falls back to raw value for unknown period type", () => {
			expect(getPeriodTypeLabel("unknown")).toBe("unknown")
		})
	})

	describe("getPeriodEndDate", () => {
		it("calculates inclusive end date for period types", () => {
			expect(getPeriodEndDate("yearly", "2025-01-01")).toBe("2025-12-31")
			expect(getPeriodEndDate("tertiary", "2025-05-01")).toBe("2025-08-31")
			expect(getPeriodEndDate("quarterly", "2025-10-01")).toBe("2025-12-31")
			expect(getPeriodEndDate("monthly", "2025-02-01")).toBe("2025-02-28")
		})

		it("handles leap years for monthly periods", () => {
			expect(getPeriodEndDate("monthly", "2024-02-01")).toBe("2024-02-29")
		})

		it("throws on invalid period start for type", () => {
			expect(() => getPeriodEndDate("tertiary", "2025-02-01")).toThrow("Invalid periodStart")
		})
	})

	describe("formatPeriodLabelSafe", () => {
		it("falls back to periodStart on unknown periodType", () => {
			expect(formatPeriodLabelSafe("unknown", "2025-01-01")).toBe("2025-01-01")
		})

		it("falls back to periodStart on invalid periodStart", () => {
			expect(formatPeriodLabelSafe("quarterly", "2025-02-01")).toBe("2025-02-01")
		})
	})
})
