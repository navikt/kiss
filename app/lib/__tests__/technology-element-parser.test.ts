import { describe, expect, it } from "vitest"
import { parseTechnologyElements } from "../technology-element-parser"

describe("parseTechnologyElements", () => {
	it("returns empty array for null input", () => {
		expect(parseTechnologyElements(null)).toEqual([])
	})

	it("returns empty array for empty string", () => {
		expect(parseTechnologyElements("")).toEqual([])
	})

	it("parses a single element without description", () => {
		expect(parseTechnologyElements("Applikasjon")).toEqual([{ name: "Applikasjon", description: null }])
	})

	it("parses comma-separated elements", () => {
		expect(parseTechnologyElements("Active Directory, Applikasjon, Database")).toEqual([
			{ name: "Active Directory", description: null },
			{ name: "Applikasjon", description: null },
			{ name: "Database", description: null },
		])
	})

	it("parses semicolon-separated elements", () => {
		expect(parseTechnologyElements("Active Directory; Applikasjon")).toEqual([
			{ name: "Active Directory", description: null },
			{ name: "Applikasjon", description: null },
		])
	})

	it("extracts description from parentheses", () => {
		expect(parseTechnologyElements("Støtteverktøy (Eks. Passordhvelv, Git, Jira)")).toEqual([
			{ name: "Støtteverktøy", description: "Eks. Passordhvelv, Git, Jira" },
		])
	})

	it("handles mixed elements with and without descriptions", () => {
		expect(
			parseTechnologyElements("Active Directory, Applikasjon, Database, Støtteverktøy (Eks. Passordhvelv, Git, Jira)"),
		).toEqual([
			{ name: "Active Directory", description: null },
			{ name: "Applikasjon", description: null },
			{ name: "Database", description: null },
			{ name: "Støtteverktøy", description: "Eks. Passordhvelv, Git, Jira" },
		])
	})

	it("trims whitespace from names and descriptions", () => {
		expect(parseTechnologyElements("  Applikasjon  ,  Database (  test  )  ")).toEqual([
			{ name: "Applikasjon", description: null },
			{ name: "Database", description: "test" },
		])
	})

	it("skips empty segments", () => {
		expect(parseTechnologyElements("Applikasjon,,Database")).toEqual([
			{ name: "Applikasjon", description: null },
			{ name: "Database", description: null },
		])
	})

	it("handles nested parentheses", () => {
		expect(parseTechnologyElements("Verktøy (a (b), c)")).toEqual([{ name: "Verktøy", description: "a (b), c" }])
	})
})
