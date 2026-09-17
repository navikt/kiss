import { describe, expect, it } from "vitest"
import { resolveEffectiveResponsibleRole } from "~/db/queries/routines.server"

describe("resolveEffectiveResponsibleRole", () => {
	it("returns the routine's own responsibleRole when set", () => {
		const result = resolveEffectiveResponsibleRole("Teknologileder", [{ responsible: "Produktleder" }])
		expect(result).toBe("Teknologileder")
	})

	it("falls back to the first control with a responsible value when responsibleRole is null", () => {
		const result = resolveEffectiveResponsibleRole(null, [{ responsible: null }, { responsible: "Produktleder" }])
		expect(result).toBe("Produktleder")
	})

	it("returns null when neither responsibleRole nor any control has a responsible value", () => {
		const result = resolveEffectiveResponsibleRole(null, [{ responsible: null }])
		expect(result).toBeNull()
	})

	it("returns null when controls list is empty and responsibleRole is null", () => {
		const result = resolveEffectiveResponsibleRole(null, [])
		expect(result).toBeNull()
	})
})
