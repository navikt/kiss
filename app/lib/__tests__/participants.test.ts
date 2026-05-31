import { describe, expect, it } from "vitest"
import { parseParticipantsFormValue } from "../participants"

describe("parseParticipantsFormValue", () => {
	describe("input type handling", () => {
		it("returns empty array for null", () => {
			expect(parseParticipantsFormValue(null)).toEqual([])
		})

		it("returns empty array for undefined", () => {
			expect(parseParticipantsFormValue(undefined)).toEqual([])
		})

		it("returns empty array for non-string (e.g. File)", () => {
			const fakeFile = new Blob(["x"], { type: "text/plain" })
			expect(parseParticipantsFormValue(fakeFile)).toEqual([])
		})

		it("returns empty array for empty string", () => {
			expect(parseParticipantsFormValue("")).toEqual([])
			expect(parseParticipantsFormValue("   ")).toEqual([])
		})
	})

	describe("JSON input (new format)", () => {
		it("parses valid JSON array with navIdent and displayName", () => {
			const json = JSON.stringify([
				{ navIdent: "Z990001", displayName: "Glad Fjord" },
				{ navIdent: "Z990002", displayName: "Rask Elv" },
			])
			expect(parseParticipantsFormValue(json)).toEqual([
				{ userIdent: "Z990001", userName: "Glad Fjord" },
				{ userIdent: "Z990002", userName: "Rask Elv" },
			])
		})

		it("normalizes idents to uppercase", () => {
			const json = JSON.stringify([{ navIdent: "z990001", displayName: "Glad Fjord" }])
			const result = parseParticipantsFormValue(json)
			expect(result[0].userIdent).toBe("Z990001")
		})

		it("handles missing displayName as null", () => {
			const json = JSON.stringify([{ navIdent: "Z990001" }])
			expect(parseParticipantsFormValue(json)).toEqual([{ userIdent: "Z990001", userName: null }])
		})

		it("treats empty displayName as null", () => {
			const json = JSON.stringify([{ navIdent: "Z990001", displayName: "  " }])
			expect(parseParticipantsFormValue(json)).toEqual([{ userIdent: "Z990001", userName: null }])
		})

		it("filters out entries without a navIdent", () => {
			const json = JSON.stringify([
				{ navIdent: "Z990001", displayName: "Glad Fjord" },
				{ displayName: "Ingen ident" },
				{ navIdent: "  ", displayName: "Mellomrom" },
			])
			expect(parseParticipantsFormValue(json)).toEqual([{ userIdent: "Z990001", userName: "Glad Fjord" }])
		})

		it("dedupes case-insensitively and keeps first occurrence", () => {
			const json = JSON.stringify([
				{ navIdent: "z990001", displayName: "Glad Fjord" },
				{ navIdent: "Z990001", displayName: "Duplikat" },
			])
			const result = parseParticipantsFormValue(json)
			expect(result).toHaveLength(1)
			expect(result[0]).toEqual({ userIdent: "Z990001", userName: "Glad Fjord" })
		})
	})

	describe("legacy comma-separated input", () => {
		it("parses comma-separated idents", () => {
			expect(parseParticipantsFormValue("Z990001, Z990002")).toEqual([
				{ userIdent: "Z990001", userName: null },
				{ userIdent: "Z990002", userName: null },
			])
		})

		it("uppercases idents from legacy format", () => {
			expect(parseParticipantsFormValue("z990001")).toEqual([{ userIdent: "Z990001", userName: null }])
		})

		it("dedupes case-insensitively", () => {
			expect(parseParticipantsFormValue("z990001, Z990001, Z990002")).toEqual([
				{ userIdent: "Z990001", userName: null },
				{ userIdent: "Z990002", userName: null },
			])
		})

		it("ignores empty entries", () => {
			expect(parseParticipantsFormValue("Z990001, , ,Z990002,")).toEqual([
				{ userIdent: "Z990001", userName: null },
				{ userIdent: "Z990002", userName: null },
			])
		})
	})

	describe("invalid JSON fallback", () => {
		it("falls back to legacy parser on malformed JSON starting with [", () => {
			expect(parseParticipantsFormValue("[not json")).toEqual([{ userIdent: "[NOT JSON", userName: null }])
		})

		it("does not silently wipe participants on invalid JSON", () => {
			const result = parseParticipantsFormValue("[broken")
			expect(result.length).toBeGreaterThan(0)
		})

		it("falls back to legacy parser when JSON is not an array", () => {
			expect(parseParticipantsFormValue('["Z990001"')).toEqual([{ userIdent: '["Z990001"', userName: null }])
		})
	})
})
