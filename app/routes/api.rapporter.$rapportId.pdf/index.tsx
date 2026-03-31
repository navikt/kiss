import PDFDocument from "pdfkit"
import type { LoaderFunctionArgs } from "react-router"
import { getReport } from "~/db/queries/reports.server"
import { getStorageProvider } from "~/lib/storage/index.server"

interface ReportSnapshot {
	generatedAt: string
	appVersion: string
	scope: string
	scopeLabel: string
	frameworkVersion: { id: string; name: string; activatedAt: string | null } | null
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

	// Load the snapshot JSON
	const storage = getStorageProvider()
	let snapshot: ReportSnapshot
	try {
		const buf = await storage.download(report.snapshotBucketPath)
		snapshot = JSON.parse(buf.toString("utf-8"))
	} catch {
		throw new Response("Kunne ikke laste rapportdata", { status: 500 })
	}

	const pdfBuffer = await buildPdf(report.name, snapshot)

	const safeName = report.name.replace(/[^a-zA-Z0-9æøåÆØÅ _-]/g, "_")
	return new Response(new Uint8Array(pdfBuffer), {
		headers: {
			"Content-Type": "application/pdf",
			"Content-Disposition": `attachment; filename="${safeName}.pdf"`,
		},
	})
}

function buildPdf(reportName: string, snapshot: ReportSnapshot): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true })
		const chunks: Buffer[] = []

		doc.on("data", (chunk: Buffer) => chunks.push(chunk))
		doc.on("end", () => resolve(Buffer.concat(chunks)))
		doc.on("error", reject)

		const blue = "#0067c5"
		const darkText = "#222222"
		const subtle = "#666666"

		// Title
		doc.fontSize(20).fillColor(blue).text(reportName, { align: "left" })
		doc.moveDown(0.5)

		// Metadata
		doc.fontSize(9).fillColor(subtle)
		doc.text(`Generert: ${new Date(snapshot.generatedAt).toLocaleString("nb-NO")}`)
		doc.text(`Omfang: ${snapshot.scopeLabel}`)
		doc.text(`Rammeverk: ${snapshot.frameworkVersion?.name ?? "Ukjent"}`)
		doc.text(`Appversjon: ${snapshot.appVersion}`)
		doc.moveDown(1)

		// Summary
		doc.fontSize(14).fillColor(blue).text("Oppsummering")
		doc.moveDown(0.3)

		const stats = snapshot.statistics
		const total = snapshot.totalAssessments
		const pct = (n: number) => (total > 0 ? ((n / total) * 100).toFixed(1) : "0.0")

		doc.fontSize(10).fillColor(darkText)
		doc.text(`Applikasjoner: ${snapshot.totalApps}`)
		doc.text(`Kontrollvurderinger: ${total}`)
		doc.text(`Implementert: ${stats.implemented} (${pct(stats.implemented)}%)`)
		doc.text(`Delvis implementert: ${stats.partial} (${pct(stats.partial)}%)`)
		doc.text(`Ikke implementert: ${stats.notImplemented} (${pct(stats.notImplemented)}%)`)
		doc.text(`Ikke relevant: ${stats.notRelevant} (${pct(stats.notRelevant)}%)`)
		doc.text(`Ikke vurdert: ${stats.unassessed} (${pct(stats.unassessed)}%)`)
		doc.moveDown(1)

		// Domain breakdown
		const domainStats = new Map<
			string,
			{ name: string; total: number; implemented: number; partial: number; notImpl: number; notRel: number }
		>()
		for (const row of snapshot.rows) {
			const key = row.domainCode || row.domain
			const existing = domainStats.get(key) ?? {
				name: row.domain,
				total: 0,
				implemented: 0,
				partial: 0,
				notImpl: 0,
				notRel: 0,
			}
			existing.total++
			if (row.status === "implemented") existing.implemented++
			if (row.status === "partially_implemented") existing.partial++
			if (row.status === "not_implemented") existing.notImpl++
			if (row.status === "not_relevant") existing.notRel++
			domainStats.set(key, existing)
		}

		doc.fontSize(14).fillColor(blue).text("Per domene")
		doc.moveDown(0.3)

		// Table header
		const tableLeft = 50
		const colWidths = [50, 120, 50, 70, 55, 60, 65]
		const headers = ["Kode", "Domene", "Totalt", "Impl.", "Delvis", "Ikke impl.", "Ikke rel."]

		drawTableRow(doc, tableLeft, colWidths, headers, true)

		for (const [code, d] of domainStats) {
			drawTableRow(doc, tableLeft, colWidths, [
				code,
				d.name,
				String(d.total),
				String(d.implemented),
				String(d.partial),
				String(d.notImpl),
				String(d.notRel),
			])
		}

		doc.moveDown(1)

		// Detail table
		doc.fontSize(14).fillColor(blue).text("Detaljer per applikasjon")
		doc.moveDown(0.3)

		const detailColWidths = [110, 55, 130, 95, 105]
		const detailHeaders = ["Applikasjon", "Kontroll", "Kontrollnavn", "Status", "Kommentar"]

		drawTableRow(doc, tableLeft, detailColWidths, detailHeaders, true)

		for (const row of snapshot.rows) {
			if (doc.y > 720) {
				doc.addPage()
			}
			const controlName = row.controlName.replace(/\r/g, "").slice(0, 40)
			const comment = (row.comment ?? "").slice(0, 30)
			drawTableRow(doc, tableLeft, detailColWidths, [
				row.appName.slice(0, 30),
				row.controlId,
				controlName,
				statusLabels[row.status ?? ""] ?? "Ikke vurdert",
				comment,
			])
		}

		doc.end()
	})
}

function drawTableRow(doc: PDFKit.PDFDocument, x: number, colWidths: number[], cells: string[], isHeader = false) {
	if (doc.y > 720) {
		doc.addPage()
	}

	const y = doc.y
	const rowHeight = 16

	if (isHeader) {
		doc
			.rect(
				x,
				y,
				colWidths.reduce((a, b) => a + b, 0),
				rowHeight,
			)
			.fill("#e6f0ff")
	}

	doc.fontSize(7).fillColor(isHeader ? "#0067c5" : "#222222")

	let cx = x
	for (let i = 0; i < cells.length; i++) {
		doc.text(cells[i], cx + 3, y + 3, {
			width: colWidths[i] - 6,
			height: rowHeight - 2,
			lineBreak: false,
			ellipsis: true,
		})
		cx += colWidths[i]
	}

	// Draw row border
	doc.strokeColor("#c6c2bf").lineWidth(0.5)
	doc
		.rect(
			x,
			y,
			colWidths.reduce((a, b) => a + b, 0),
			rowHeight,
		)
		.stroke()

	doc.y = y + rowHeight
	doc.x = x
}
