import { describe, expect, it } from "vitest"
import { addParticipant } from "~/lib/participants"

describe("addParticipant", () => {
	it("adds a new ident to an empty string", () => {
		expect(addParticipant("", "A123456")).toBe("A123456")
	})

	it("appends a new ident to an existing list", () => {
		expect(addParticipant("A123456", "B654321")).toBe("A123456, B654321")
	})

	it("does not add a duplicate (exact match)", () => {
		expect(addParticipant("A123456", "A123456")).toBe("A123456")
	})

	it("does not add a duplicate (case-insensitive)", () => {
		expect(addParticipant("a123456", "A123456")).toBe("a123456")
	})

	it("handles whitespace around existing idents", () => {
		expect(addParticipant("  A123456  ,  B654321  ", "C111111")).toBe("A123456, B654321, C111111")
	})

	it("filters out empty entries from current value", () => {
		expect(addParticipant(",,,", "A123456")).toBe("A123456")
	})

	it("preserves multiple existing idents when adding a new one", () => {
		const result = addParticipant("A111111, B222222, C333333", "D444444")
		expect(result).toBe("A111111, B222222, C333333, D444444")
	})

	it("does not add when ident already exists among many", () => {
		expect(addParticipant("A111111, B222222, C333333", "B222222")).toBe("A111111, B222222, C333333")
	})
})
