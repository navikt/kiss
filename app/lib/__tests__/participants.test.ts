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
				{ navIdent: "A123456", displayName: "Ada Lovelace" },
				{ navIdent: "B654321", displayName: "Bjørn Berg" },
			])
			expect(parseParticipantsFormValue(json)).toEqual([
				{ userIdent: "A123456", userName: "Ada Lovelace" },
				{ userIdent: "B654321", userName: "Bjørn Berg" },
			])
		})

		it("normalizes idents to uppercase", () => {
			const json = JSON.stringify([{ navIdent: "a123456", displayName: "Ada" }])
			const result = parseParticipantsFormValue(json)
			expect(result[0].userIdent).toBe("A123456")
		})

		it("handles missing displayName as null", () => {
			const json = JSON.stringify([{ navIdent: "A123456" }])
			expect(parseParticipantsFormValue(json)).toEqual([{ userIdent: "A123456", userName: null }])
		})

		it("treats empty displayName as null", () => {
			const json = JSON.stringify([{ navIdent: "A123456", displayName: "  " }])
			expect(parseParticipantsFormValue(json)).toEqual([{ userIdent: "A123456", userName: null }])
		})

		it("filters out entries without a navIdent", () => {
			const json = JSON.stringify([
				{ navIdent: "A123456", displayName: "Ada" },
				{ displayName: "No ident" },
				{ navIdent: "  ", displayName: "Whitespace" },
			])
			expect(parseParticipantsFormValue(json)).toEqual([{ userIdent: "A123456", userName: "Ada" }])
		})

		it("dedupes case-insensitively and keeps first occurrence", () => {
			const json = JSON.stringify([
				{ navIdent: "a123456", displayName: "Ada" },
				{ navIdent: "A123456", displayName: "Duplicate" },
			])
			const result = parseParticipantsFormValue(json)
			expect(result).toHaveLength(1)
			expect(result[0]).toEqual({ userIdent: "A123456", userName: "Ada" })
		})
	})

	describe("legacy comma-separated input", () => {
		it("parses comma-separated idents", () => {
			expect(parseParticipantsFormValue("A123456, B654321")).toEqual([
				{ userIdent: "A123456", userName: null },
				{ userIdent: "B654321", userName: null },
			])
		})

		it("uppercases idents from legacy format", () => {
			expect(parseParticipantsFormValue("a123456")).toEqual([{ userIdent: "A123456", userName: null }])
		})

		it("dedupes case-insensitively", () => {
			expect(parseParticipantsFormValue("a123456, A123456, B654321")).toEqual([
				{ userIdent: "A123456", userName: null },
				{ userIdent: "B654321", userName: null },
			])
		})

		it("ignores empty entries", () => {
			expect(parseParticipantsFormValue("A123456, , ,B654321,")).toEqual([
				{ userIdent: "A123456", userName: null },
				{ userIdent: "B654321", userName: null },
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
			expect(parseParticipantsFormValue('["A123456"')).toEqual([{ userIdent: '["A123456"', userName: null }])
		})
	})
})
