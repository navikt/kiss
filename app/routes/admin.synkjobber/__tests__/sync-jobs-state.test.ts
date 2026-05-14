import { describe, expect, it } from "vitest"

const { _testing } = await import("../index")

describe("admin.synkjobber sync job state mapping", () => {
	it("maps states to labels", () => {
		expect(_testing.getSyncStateLabel("pending")).toBe("Venter")
		expect(_testing.getSyncStateLabel("running")).toBe("Pågår")
		expect(_testing.getSyncStateLabel("completed")).toBe("Fullført")
		expect(_testing.getSyncStateLabel("failed")).toBe("Feilet")
		expect(_testing.getSyncStateLabel("skipped")).toBe("Hoppet over")
	})

	it("maps states to tag variants", () => {
		expect(_testing.getSyncStateTagVariant("pending")).toBe("neutral")
		expect(_testing.getSyncStateTagVariant("running")).toBe("info")
		expect(_testing.getSyncStateTagVariant("completed")).toBe("success")
		expect(_testing.getSyncStateTagVariant("failed")).toBe("error")
		expect(_testing.getSyncStateTagVariant("skipped")).toBe("warning")
	})

	it("falls back for unknown state values", () => {
		expect(_testing.getSyncStateLabel("unknown" as never)).toBe("Ukjent")
		expect(_testing.getSyncStateTagVariant("unknown" as never)).toBe("neutral")
	})
})
