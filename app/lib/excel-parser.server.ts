import * as XLSX from "xlsx"

export interface ParsedFrameworkRow {
	domain: string
	riskId: string
	riskDescription: string
	controlId: string
	technologyElement: string | null
	requirement: string | null
	responsible: string | null
	routine: string | null
	frequency: string | null
	documentationRequirement: string | null
	testProcedure: string | null
	dependencies: string | null
	references: string | null
	commonPitfalls: string | null
}

export interface ParsedFramework {
	rows: ParsedFrameworkRow[]
	sheetName: string
}

function cellText(ws: XLSX.WorkSheet, row: number, col: number): string | null {
	const cellRef = XLSX.utils.encode_cell({ r: row, c: col })
	const cell = ws[cellRef]
	if (!cell) return null
	const val = cell.v ?? cell.w
	return val != null ? String(val).trim() : null
}

export function parseFrameworkExcel(buffer: Buffer): ParsedFramework {
	const wb = XLSX.read(buffer, { type: "buffer" })
	const sheetName = wb.SheetNames[0]
	if (!sheetName) {
		throw new Error("Excel-filen inneholder ingen ark")
	}

	const ws = wb.Sheets[sheetName]
	if (!ws) {
		throw new Error(`Arket "${sheetName}" finnes ikke`)
	}

	const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1")
	const rows: ParsedFrameworkRow[] = []

	// Data starts at row 3 (index 2), headers at row 2 (index 1)
	for (let r = 2; r <= range.e.r; r++) {
		const domain = cellText(ws, r, 0)
		const riskId = cellText(ws, r, 1)
		const controlId = cellText(ws, r, 3)

		if (!domain || !riskId || !controlId) continue

		rows.push({
			domain,
			riskId,
			riskDescription: cellText(ws, r, 2) ?? "",
			controlId,
			technologyElement: cellText(ws, r, 4),
			requirement: cellText(ws, r, 5),
			responsible: cellText(ws, r, 6),
			routine: cellText(ws, r, 7),
			frequency: cellText(ws, r, 8),
			documentationRequirement: cellText(ws, r, 9),
			testProcedure: cellText(ws, r, 10),
			dependencies: cellText(ws, r, 11),
			references: cellText(ws, r, 12),
			commonPitfalls: cellText(ws, r, 13),
		})
	}

	if (rows.length === 0) {
		throw new Error("Ingen gyldige rader funnet i Excel-filen")
	}

	return { rows, sheetName }
}

export interface FrameworkSummary {
	domains: Map<string, string>
	risks: Map<string, { riskId: string; description: string; domain: string }>
	controls: Map<string, ParsedFrameworkRow>
	riskControlMappings: Array<{ riskId: string; controlId: string }>
}

export function summarizeFramework(parsed: ParsedFramework): FrameworkSummary {
	const domains = new Map<string, string>()
	const risks = new Map<string, { riskId: string; description: string; domain: string }>()
	const controls = new Map<string, ParsedFrameworkRow>()
	const riskControlMappings: Array<{ riskId: string; controlId: string }> = []

	for (const row of parsed.rows) {
		// Extract domain code from risk ID (e.g., "R-ST.01" → "ST")
		const domainCode = row.riskId.match(/R-([A-Z]{2})\./)?.[1] ?? row.domain.slice(0, 2).toUpperCase()
		domains.set(domainCode, row.domain)

		if (!risks.has(row.riskId)) {
			risks.set(row.riskId, {
				riskId: row.riskId,
				description: row.riskDescription,
				domain: row.domain,
			})
		}

		if (!controls.has(row.controlId)) {
			controls.set(row.controlId, row)
		}

		riskControlMappings.push({
			riskId: row.riskId,
			controlId: row.controlId,
		})
	}

	return { domains, risks, controls, riskControlMappings }
}
