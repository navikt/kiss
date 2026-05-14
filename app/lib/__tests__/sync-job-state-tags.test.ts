import { describe, expect, it } from "vitest"
import { getSyncJobStateLabel, getSyncJobStateTagVariant } from "~/lib/sync-job-state-tags"

describe("sync job state mapping", () => {
	it("maps states to labels", () => {
		expect(getSyncJobStateLabel("pending")).toBe("Venter")
		expect(getSyncJobStateLabel("running")).toBe("Pågår")
		expect(getSyncJobStateLabel("completed")).toBe("Fullført")
		expect(getSyncJobStateLabel("failed")).toBe("Feilet")
		expect(getSyncJobStateLabel("skipped")).toBe("Hoppet over")
	})

	it("maps states to tag variants", () => {
		expect(getSyncJobStateTagVariant("pending")).toBe("neutral")
		expect(getSyncJobStateTagVariant("running")).toBe("info")
		expect(getSyncJobStateTagVariant("completed")).toBe("success")
		expect(getSyncJobStateTagVariant("failed")).toBe("error")
		expect(getSyncJobStateTagVariant("skipped")).toBe("warning")
	})
})
