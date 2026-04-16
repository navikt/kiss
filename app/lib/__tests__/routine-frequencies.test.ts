import { describe, expect, it } from "vitest"
import {
	frequencyRank,
	getStrictestFrequency,
	isFrequencyAtLeastAsOften,
	parseControlFrequency,
} from "../routine-frequencies"

describe("frequencyRank", () => {
	it("weekly is more frequent than monthly", () => {
		expect(frequencyRank("weekly")).toBeLessThan(frequencyRank("monthly"))
	})

	it("monthly is more frequent than annually", () => {
		expect(frequencyRank("monthly")).toBeLessThan(frequencyRank("annually"))
	})

	it("ordering is weekly < monthly < quarterly < tertially < semi_annually < annually", () => {
		const ranks = [
			frequencyRank("weekly"),
			frequencyRank("monthly"),
			frequencyRank("quarterly"),
			frequencyRank("tertially"),
			frequencyRank("semi_annually"),
			frequencyRank("annually"),
		]
		for (let i = 1; i < ranks.length; i++) {
			expect(ranks[i]).toBeGreaterThan(ranks[i - 1])
		}
	})
})

describe("parseControlFrequency", () => {
	it("parses Norwegian labels", () => {
		expect(parseControlFrequency("Kvartalsvis")).toBe("quarterly")
		expect(parseControlFrequency("Årlig")).toBe("annually")
		expect(parseControlFrequency("Månedlig")).toBe("monthly")
	})

	it("handles case-insensitive matching", () => {
		expect(parseControlFrequency("kvartalsvis")).toBe("quarterly")
		expect(parseControlFrequency("ÅRLIG")).toBe("annually")
	})

	it("handles text containing the label", () => {
		expect(parseControlFrequency("Minimum kvartalsvis gjennomgang")).toBe("quarterly")
	})

	it("returns null for unrecognized text", () => {
		expect(parseControlFrequency("daglig")).toBeNull()
		expect(parseControlFrequency("")).toBeNull()
		expect(parseControlFrequency(null)).toBeNull()
		expect(parseControlFrequency(undefined)).toBeNull()
	})
})

describe("getStrictestFrequency", () => {
	it("returns the most frequent value", () => {
		expect(getStrictestFrequency(["Årlig", "Kvartalsvis"])).toBe("quarterly")
	})

	it("handles routine frequency values directly", () => {
		expect(getStrictestFrequency(["annually", "monthly"])).toBe("monthly")
	})

	it("ignores null/undefined/unparseable values", () => {
		expect(getStrictestFrequency([null, "Årlig", undefined, "unknown"])).toBe("annually")
	})

	it("returns null for empty list", () => {
		expect(getStrictestFrequency([])).toBeNull()
	})

	it("returns null when no values are parseable", () => {
		expect(getStrictestFrequency([null, "daglig"])).toBeNull()
	})
})

describe("isFrequencyAtLeastAsOften", () => {
	it("same frequency is at least as often", () => {
		expect(isFrequencyAtLeastAsOften("quarterly", "quarterly")).toBe(true)
	})

	it("more frequent passes", () => {
		expect(isFrequencyAtLeastAsOften("monthly", "quarterly")).toBe(true)
		expect(isFrequencyAtLeastAsOften("weekly", "annually")).toBe(true)
	})

	it("less frequent fails", () => {
		expect(isFrequencyAtLeastAsOften("annually", "quarterly")).toBe(false)
		expect(isFrequencyAtLeastAsOften("semi_annually", "monthly")).toBe(false)
	})
})
