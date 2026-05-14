import { afterEach, describe, expect, it, vi } from "vitest"

const { _testing } = await import("../index")

describe("seksjoner.rpa-brukere timezone formatting", () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("formats synced timestamps in Europe/Oslo", () => {
		const spy = vi.spyOn(Date.prototype, "toLocaleString").mockReturnValue("formatted")

		const value = _testing.formatDateTimeOslo("2026-05-14T10:00:00.000Z")

		expect(value).toBe("formatted")
		expect(spy).toHaveBeenCalledWith("nb-NO", { timeZone: "Europe/Oslo" })
	})
})
