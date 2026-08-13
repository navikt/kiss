import { describe, expect, it } from "vitest"
import { formatUserRef } from "~/lib/user-display"

describe("formatUserRef", () => {
	it("formats as 'Fornavn Etternavn (NAVIDENT)' when the name is known", () => {
		const nameByNavIdent = new Map([["Z990001", "Glad Fjord"]])
		expect(formatUserRef("Z990001", nameByNavIdent)).toBe("Glad Fjord (Z990001)")
	})

	it("looks up case-insensitively and trims whitespace", () => {
		const nameByNavIdent = new Map([["Z990001", "Glad Fjord"]])
		expect(formatUserRef(" z990001 ", nameByNavIdent)).toBe("Glad Fjord (z990001)")
	})

	it("falls back to the trimmed nav-ident when the name is unknown", () => {
		expect(formatUserRef(" Z990002 ", new Map())).toBe("Z990002")
	})
})
