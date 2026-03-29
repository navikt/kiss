import * as fs from "node:fs"
import * as path from "node:path"
import { describe, expect, it } from "vitest"
import { parseFrameworkExcel, summarizeFramework } from "../excel-parser.server"

const EXCEL_PATH = path.resolve(process.env.HOME ?? "", "Downloads/Minimum kontrollrammeverk økonomisystem (v1.1).xlsx")

const hasExcelFile = fs.existsSync(EXCEL_PATH)

describe.skipIf(!hasExcelFile)("parseFrameworkExcel", () => {
	it("should parse the MKR v1.1 Excel file", () => {
		const buffer = fs.readFileSync(EXCEL_PATH)
		const result = parseFrameworkExcel(buffer)

		expect(result.sheetName).toBe("Kontrollrammeverk V1.1")
		expect(result.rows.length).toBeGreaterThanOrEqual(24)
	})

	it("should extract all 4 domains", () => {
		const buffer = fs.readFileSync(EXCEL_PATH)
		const result = parseFrameworkExcel(buffer)
		const summary = summarizeFramework(result)

		const domainNames = [...summary.domains.values()]
		expect(domainNames).toContain("Styring")
		expect(domainNames).toContain("Tilgangsstyring")
		expect(domainNames).toContain("Endringshåndtering")
		expect(domainNames).toContain("Drift")
	})

	it("should extract 9 unique risks", () => {
		const buffer = fs.readFileSync(EXCEL_PATH)
		const result = parseFrameworkExcel(buffer)
		const summary = summarizeFramework(result)

		expect(summary.risks.size).toBe(9)
		expect(summary.risks.has("R-ST.01")).toBe(true)
		expect(summary.risks.has("R-TS.01")).toBe(true)
		expect(summary.risks.has("R-EH.01")).toBe(true)
	})

	it("should extract 24 unique controls", () => {
		const buffer = fs.readFileSync(EXCEL_PATH)
		const result = parseFrameworkExcel(buffer)
		const summary = summarizeFramework(result)

		expect(summary.controls.size).toBe(24)
		expect(summary.controls.has("K-ST.01")).toBe(true)
		expect(summary.controls.has("K-TS.01")).toBe(true)
	})

	it("should have risk-control mappings", () => {
		const buffer = fs.readFileSync(EXCEL_PATH)
		const result = parseFrameworkExcel(buffer)
		const summary = summarizeFramework(result)

		expect(summary.riskControlMappings.length).toBeGreaterThanOrEqual(24)
	})

	it("should parse control fields correctly", () => {
		const buffer = fs.readFileSync(EXCEL_PATH)
		const result = parseFrameworkExcel(buffer)
		const summary = summarizeFramework(result)

		const kst01 = summary.controls.get("K-ST.01")
		expect(kst01).toBeDefined()
		expect(kst01?.domain).toBe("Styring")
		expect(kst01?.technologyElement).toBe("Applikasjon")
		expect(kst01?.responsible).toContain("Leder")
		expect(kst01?.requirement).toContain("Scoping")
	})
})
