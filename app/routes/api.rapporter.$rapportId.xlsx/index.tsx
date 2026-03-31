import type { LoaderFunctionArgs } from "react-router"
import * as XLSX from "xlsx"
import { getReport } from "~/db/queries/reports.server"
import { getStorageProvider } from "~/lib/storage/index.server"

interface ReportSnapshot {
	generatedAt: string
	scopeLabel: string
	frameworkVersion: { name: string } | null
	totalApps: number
	totalAssessments: number
	statistics: {
		implemented: number
		partial: number
		notImplemented: number
		notRelevant: number
		unassessed: number
	}
	rows: Array<{
		appName: string
		controlId: string
		controlName: string
		domain: string
		domainCode: string
		status: string | null
		comment: string | null
		assessedBy: string | null
		assessedAt: string | null
	}>
}

const statusLabels: Record<string, string> = {
	implemented: "Implementert",
	partially_implemented: "Delvis implementert",
	not_implemented: "Ikke implementert",
	not_relevant: "Ikke relevant",
}

export async function loader({ params }: LoaderFunctionArgs) {
	const rapportId = params.rapportId
	if (!rapportId) throw new Response("Mangler rapport-ID", { status: 400 })

	const report = await getReport(rapportId)
	if (!report) throw new Response("Rapport ikke funnet", { status: 404 })

	const storage = getStorageProvider()
	let snapshot: ReportSnapshot
	try {
		const buf = await storage.download(report.snapshotBucketPath)
		snapshot = JSON.parse(buf.toString("utf-8"))
	} catch {
		throw new Response("Kunne ikke laste rapportdata", { status: 500 })
	}

	const wb = XLSX.utils.book_new()

	// Summary sheet
	const summaryData = [
		["Rapport", report.name],
		["Generert", new Date(snapshot.generatedAt).toLocaleString("nb-NO")],
		["Omfang", snapshot.scopeLabel],
		["Rammeverk", snapshot.frameworkVersion?.name ?? "Ukjent"],
		[""],
		["Statistikk"],
		["Applikasjoner", snapshot.totalApps],
		["Kontrollvurderinger", snapshot.totalAssessments],
		["Implementert", snapshot.statistics.implemented],
		["Delvis implementert", snapshot.statistics.partial],
		["Ikke implementert", snapshot.statistics.notImplemented],
		["Ikke relevant", snapshot.statistics.notRelevant],
		["Ikke vurdert", snapshot.statistics.unassessed],
	]
	const summaryWs = XLSX.utils.aoa_to_sheet(summaryData)
	summaryWs["!cols"] = [{ wch: 25 }, { wch: 50 }]
	XLSX.utils.book_append_sheet(wb, summaryWs, "Oppsummering")

	// Detail sheet
	const detailRows = snapshot.rows.map((r) => ({
		Applikasjon: r.appName,
		Domene: r.domain,
		Domenekode: r.domainCode,
		"Kontroll-ID": r.controlId,
		Kontrollnavn: r.controlName.replace(/\r/g, ""),
		Status: statusLabels[r.status ?? ""] ?? "Ikke vurdert",
		Kommentar: r.comment ?? "",
		"Vurdert av": r.assessedBy ?? "",
		"Vurdert dato": r.assessedAt ? new Date(r.assessedAt).toLocaleDateString("nb-NO") : "",
	}))
	const detailWs = XLSX.utils.json_to_sheet(detailRows)
	detailWs["!cols"] = [
		{ wch: 25 },
		{ wch: 20 },
		{ wch: 10 },
		{ wch: 12 },
		{ wch: 35 },
		{ wch: 22 },
		{ wch: 40 },
		{ wch: 16 },
		{ wch: 14 },
	]
	XLSX.utils.book_append_sheet(wb, detailWs, "Detaljer")

	const output = XLSX.write(wb, { bookType: "xlsx", type: "buffer" })
	const safeName = report.name.replace(/[^a-zA-Z0-9æøåÆØÅ _-]/g, "_")

	return new Response(output, {
		headers: {
			"Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			"Content-Disposition": `attachment; filename="${safeName}.xlsx"`,
		},
	})
}
