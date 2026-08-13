import { describe, expect, it } from "vitest"
import { sanitizeFilename } from "~/lib/sanitize-filename"

describe("sanitizeFilename", () => {
	it("keeps letters, digits, norske tegn, spaces, underscore and hyphen", () => {
		expect(sanitizeFilename("Gjennomgang av logger - Oracle med Pensjon Oracle Revisjon")).toBe(
			"Gjennomgang av logger - Oracle med Pensjon Oracle Revisjon",
		)
	})

	it("replaces path separators and other unsafe characters", () => {
		expect(sanitizeFilename('a/b\\c:d*e?f"g<h>i|j')).toBe("a_b_c_d_e_f_g_h_i_j")
	})

	it("strips trailing dots and spaces (invalid on Windows)", () => {
		expect(sanitizeFilename("Rapport. . ")).toBe("Rapport")
	})

	it("truncates to the given maxLength", () => {
		expect(sanitizeFilename("a".repeat(100), 10)).toHaveLength(10)
	})

	it("trims trailing space/underscore left behind by truncation", () => {
		// Truncating "Rapport for team " at 17 chars would otherwise leave a trailing space
		expect(sanitizeFilename("Rapport for team ", 17)).toBe("Rapport for team")
	})

	it("falls back to a non-empty placeholder when the result would be empty", () => {
		expect(sanitizeFilename("...")).toBe("_")
	})

	it("prefixes Windows reserved device names", () => {
		expect(sanitizeFilename("CON")).toBe("_CON")
		expect(sanitizeFilename("con")).toBe("_con")
		expect(sanitizeFilename("LPT1")).toBe("_LPT1")
	})

	it("does not mangle names that merely contain a reserved word as a substring", () => {
		expect(sanitizeFilename("CONtroll")).toBe("CONtroll")
	})
})
