import type { LoaderFunctionArgs } from "react-router"
import * as XLSX from "xlsx"
import { getAppAssessments } from "~/db/queries/applications.server"
import { getActiveFrameworkVersion } from "~/db/queries/framework.server"
import { getStorageProvider } from "~/lib/storage/index.server"

const statusLabels: Record<string, string> = {
	implemented: "Implementert",
	partially_implemented: "Delvis implementert",
	not_implemented: "Ikke implementert",
	not_relevant: "Ikke relevant",
}

export async function loader({ params }: LoaderFunctionArgs) {
	const appId = params.appId
	if (!appId) throw new Response("Mangler app-ID", { status: 400 })

	// Load the app's compliance assessments
	const result = await getAppAssessments(appId)
	if (!result) throw new Response("Applikasjon ikke funnet", { status: 404 })

	// Get the active framework version to find the original XLSX
	const version = await getActiveFrameworkVersion()
	if (!version) throw new Response("Ingen aktiv rammeverksversjon funnet", { status: 404 })

	// Download the original XLSX from storage
	const storage = getStorageProvider()
	let originalBuffer: Buffer
	try {
		originalBuffer = await storage.download(version.sourceBucketPath)
	} catch {
		throw new Response("Kunne ikke laste ned originalfilen", { status: 500 })
	}

	// Parse the original workbook
	const wb = XLSX.read(originalBuffer, { type: "buffer" })
	const sheetName = wb.SheetNames[0]
	if (!sheetName) throw new Response("Excel-filen inneholder ingen ark", { status: 500 })

	const ws = wb.Sheets[sheetName]
	if (!ws) throw new Response("Arket finnes ikke", { status: 500 })

	// Build assessment lookup by controlId
	const assessmentMap = new Map<string, (typeof result.assessments)[number]>()
	for (const a of result.assessments) {
		assessmentMap.set(a.controlId, a)
	}

	// Find the range of the sheet
	const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1")

	// Add header columns for the compliance data (columns N=13, O=14, P=15, Q=16)
	// Original columns: 0-13 (A-N), we add after the last original column
	const statusCol = range.e.c + 1
	const commentCol = range.e.c + 2
	const assessedByCol = range.e.c + 3
	const assessedAtCol = range.e.c + 4

	// Write headers at row 1 (index 1, since row 0 might be a title row)
	const headerRow = 1
	ws[XLSX.utils.encode_cell({ r: headerRow, c: statusCol })] = { v: "Status", t: "s" }
	ws[XLSX.utils.encode_cell({ r: headerRow, c: commentCol })] = { v: "Kommentar", t: "s" }
	ws[XLSX.utils.encode_cell({ r: headerRow, c: assessedByCol })] = { v: "Vurdert av", t: "s" }
	ws[XLSX.utils.encode_cell({ r: headerRow, c: assessedAtCol })] = { v: "Vurdert dato", t: "s" }

	// Fill in data for each row (data starts at row 2, index 2)
	for (let r = 2; r <= range.e.r; r++) {
		const controlIdCell = ws[XLSX.utils.encode_cell({ r, c: 3 })]
		if (!controlIdCell) continue

		const controlId = String(controlIdCell.v ?? controlIdCell.w ?? "").trim()
		if (!controlId) continue

		const assessment = assessmentMap.get(controlId)
		if (!assessment) continue

		ws[XLSX.utils.encode_cell({ r, c: statusCol })] = {
			v: assessment.status ? (statusLabels[assessment.status] ?? assessment.status) : "Ikke vurdert",
			t: "s",
		}
		ws[XLSX.utils.encode_cell({ r, c: commentCol })] = {
			v: assessment.comment ?? "",
			t: "s",
		}
		ws[XLSX.utils.encode_cell({ r, c: assessedByCol })] = {
			v: assessment.assessedBy ?? "",
			t: "s",
		}
		ws[XLSX.utils.encode_cell({ r, c: assessedAtCol })] = {
			v: assessment.assessedAt ? new Date(assessment.assessedAt).toLocaleDateString("nb-NO") : "",
			t: "s",
		}
	}

	// Update the range to include new columns
	range.e.c = assessedAtCol
	ws["!ref"] = XLSX.utils.encode_range(range)

	// Set column widths for the new columns
	const existingCols = ws["!cols"] ?? []
	while (existingCols.length <= assessedAtCol) {
		existingCols.push({})
	}
	existingCols[statusCol] = { wch: 22 }
	existingCols[commentCol] = { wch: 40 }
	existingCols[assessedByCol] = { wch: 16 }
	existingCols[assessedAtCol] = { wch: 14 }
	ws["!cols"] = existingCols

	// Write the workbook to a buffer
	const output = XLSX.write(wb, { bookType: "xlsx", type: "buffer" })

	const safeName = result.app.name.replace(/[^a-zA-Z0-9æøåÆØÅ_-]/g, "_")
	const dateStr = new Date().toISOString().slice(0, 10)
	const filename = `${safeName}_compliance_${dateStr}.xlsx`

	return new Response(output, {
		headers: {
			"Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			"Content-Disposition": `attachment; filename="${filename}"`,
		},
	})
}
