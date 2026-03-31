import { describe, expect, test } from "vitest"
import { extractBaseName } from "~/db/queries/nais.server"

describe("extractBaseName", () => {
	test("extracts base name from -q2 suffix", () => {
		expect(extractBaseName("pensjon-pen-q2")).toBe("pensjon-pen")
	})

	test("extracts base name from -q0 suffix", () => {
		expect(extractBaseName("pensjon-pselv-q0")).toBe("pensjon-pselv")
	})

	test("extracts base name from -q1 suffix", () => {
		expect(extractBaseName("pensjon-persondata-q1")).toBe("pensjon-persondata")
	})

	test("extracts base name from -q5 suffix", () => {
		expect(extractBaseName("pensjon-representasjon-q5")).toBe("pensjon-representasjon")
	})

	test("extracts base name from -pen-q2 suffix (strips only -q2)", () => {
		expect(extractBaseName("pensjon-oracle-revisjon-backend-pen-q2")).toBe("pensjon-oracle-revisjon-backend-pen")
	})

	test("extracts base name from -popp suffix", () => {
		expect(extractBaseName("pensjon-oracle-revisjon-backend-popp")).toBe("pensjon-oracle-revisjon-backend")
	})

	test("returns null for names without environment suffix", () => {
		expect(extractBaseName("pensjon-pen")).toBeNull()
	})

	test("returns null for production app names", () => {
		expect(extractBaseName("dinpensjon-backend")).toBeNull()
	})

	test("does NOT match pensjon-penny as a variant of pensjon-pen", () => {
		expect(extractBaseName("pensjon-penny")).toBeNull()
	})

	test("does NOT match pensjon-pen as a variant", () => {
		expect(extractBaseName("pensjon-pen")).toBeNull()
	})
})
