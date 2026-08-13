import { describe, expect, it } from "vitest"
import { zipEntryDate } from "~/lib/zip-entry-date"

describe("zipEntryDate", () => {
	it("returns local wall-clock components matching Europe/Oslo time (CEST, summer)", () => {
		// 2026-08-13T08:39:00Z is 10:39 in Oslo during CEST (UTC+2)
		const utcInput = new Date("2026-08-13T08:39:00Z")
		const result = zipEntryDate(utcInput)

		expect(result.getFullYear()).toBe(2026)
		expect(result.getMonth()).toBe(7) // August (0-indexed)
		expect(result.getDate()).toBe(13)
		expect(result.getHours()).toBe(10)
		expect(result.getMinutes()).toBe(39)
	})

	it("returns local wall-clock components matching Europe/Oslo time (CET, winter)", () => {
		// 2026-01-13T08:39:00Z is 09:39 in Oslo during CET (UTC+1)
		const utcInput = new Date("2026-01-13T08:39:00Z")
		const result = zipEntryDate(utcInput)

		expect(result.getHours()).toBe(9)
		expect(result.getMinutes()).toBe(39)
	})

	it("defaults to the current time when no argument is given", () => {
		const before = Date.now()
		const result = zipEntryDate()
		const after = Date.now()

		// The returned Date's components, when re-interpreted in the local process timezone,
		// must correspond to a real point in time within the test's execution window.
		expect(result.getTime()).toBeGreaterThanOrEqual(before - 24 * 60 * 60 * 1000)
		expect(result.getTime()).toBeLessThanOrEqual(after + 24 * 60 * 60 * 1000)
	})
})
