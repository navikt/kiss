import PDFDocument from "pdfkit"
import type { LoaderFunctionArgs } from "react-router"
import { getAppAssessments } from "~/db/queries/applications.server"
import { getApplicationDetail } from "~/db/queries/nais.server"
import { getReviewsForApp } from "~/db/queries/routines.server"
import { getStatusLabel } from "~/lib/compliance-status"
import { getFrequencyLabel } from "~/lib/routine-frequencies"
import { getStorageProvider } from "~/lib/storage/index.server"

export async function loader({ params }: LoaderFunctionArgs) {
	const appId = params.appId
	if (!appId) throw new Response("Mangler app-ID", { status: 400 })

	const [detail, assessmentsResult, reviews] = await Promise.all([
		getApplicationDetail(appId),
		getAppAssessments(appId),
		getReviewsForApp(appId),
	])

	if (!detail) throw new Response("Applikasjon ikke funnet", { status: 404 })

	const assessments = assessmentsResult?.assessments ?? []
	const completedReviews = reviews.filter((r) => r.status === "completed")

	// Get namespace/cluster from first environment
	const namespace = detail.environments[0]?.namespace ?? null
	const cluster = detail.environments[0]?.cluster ?? null

	// Collect attachment buffers
	const storage = getStorageProvider()
	const attachmentBuffers: Array<{ fileName: string; contentType: string; data: Buffer }> = []
	for (const review of completedReviews) {
		for (const att of review.attachments) {
			try {
				const buf = await storage.download(att.bucketPath)
				attachmentBuffers.push({
					fileName: att.fileName,
					contentType: att.contentType,
					data: buf,
				})
			} catch {
				// Skip attachments that can't be downloaded
			}
		}
	}

	const pdfBuffer = await buildPdf(
		{ name: detail.app.name, namespace, cluster },
		assessments,
		completedReviews,
		attachmentBuffers,
	)

	const safeName = detail.app.name.replace(/[^a-zA-Z0-9æøåÆØÅ _-]/g, "_")
	return new Response(new Uint8Array(pdfBuffer), {
		headers: {
			"Content-Type": "application/pdf",
			"Content-Disposition": `attachment; filename="Compliance-rapport_${safeName}.pdf"`,
		},
	})
}

interface AppInfo {
	name: string
	namespace: string | null
	cluster: string | null
}

interface Assessment {
	controlId: string
	controlName: string
	domainCode: string
	domainName: string
	status: string | null
	comment: string | null
	assessedBy: string | null
	assessedAt: string | null
}

interface Review {
	id: string
	title: string
	summary: string | null
	reviewedAt: Date
	createdBy: string
	status: string
	routineName: string
	routineFrequency: string
	participants: Array<{ userIdent: string; userName: string | null; confirmedAt: Date | null }>
	attachments: Array<{ fileName: string; contentType: string; sizeBytes: number | null }>
}

interface AttachmentData {
	fileName: string
	contentType: string
	data: Buffer
}

const blue = "#0067c5"
const darkText = "#222222"
const subtle = "#666666"

function buildPdf(
	app: AppInfo,
	assessments: Assessment[],
	reviews: Review[],
	attachments: AttachmentData[],
): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true })
		const chunks: Buffer[] = []

		doc.on("data", (chunk: Buffer) => chunks.push(chunk))
		doc.on("end", () => resolve(Buffer.concat(chunks)))
		doc.on("error", reject)

		// ─── Title ────────────────────────────────────────────────────
		doc.fontSize(22).fillColor(blue).text("Compliance-rapport", { align: "left" })
		doc.fontSize(16).fillColor(darkText).text(app.name)
		doc.moveDown(0.5)

		doc.fontSize(9).fillColor(subtle)
		doc.text(`Generert: ${new Date().toLocaleString("nb-NO")}`)
		if (app.namespace) doc.text(`Namespace: ${app.namespace}`)
		if (app.cluster) doc.text(`Cluster: ${app.cluster}`)
		doc.moveDown(1)

		// ─── Compliance summary ───────────────────────────────────────
		buildComplianceSummary(doc, assessments)

		// ─── Domain breakdown ─────────────────────────────────────────
		buildDomainBreakdown(doc, assessments)

		// ─── Assessment details ───────────────────────────────────────
		buildAssessmentDetails(doc, assessments)

		// ─── Routine reviews ──────────────────────────────────────────
		buildReviewsSection(doc, reviews)

		// ─── Attached documents list ──────────────────────────────────
		if (attachments.length > 0) {
			ensureSpace(doc, 80)
			doc.fontSize(14).fillColor(blue).text("Vedlagte dokumenter")
			doc.moveDown(0.3)

			const colWidths = [280, 150, 65]
			drawTableRow(doc, 50, colWidths, ["Filnavn", "Type", "Størrelse"], true)

			for (const att of attachments) {
				ensureSpace(doc, 18)
				drawTableRow(doc, 50, colWidths, [att.fileName.slice(0, 60), att.contentType, formatFileSize(att.data.length)])
			}
			doc.moveDown(0.5)
			doc.fontSize(8).fillColor(subtle).text("Dokumentene er vedlagt som vedlegg i denne PDF-filen.", { align: "left" })
		}

		// ─── Embed attachments as PDF file attachments ────────────────
		for (const att of attachments) {
			doc.file(att.data, {
				name: att.fileName,
				type: att.contentType,
				description: `Vedlegg fra rutinegjennomgang: ${att.fileName}`,
			})
		}

		doc.end()
	})
}

function buildComplianceSummary(doc: PDFKit.PDFDocument, assessments: Assessment[]) {
	doc.fontSize(14).fillColor(blue).text("Compliance-oppsummering")
	doc.moveDown(0.3)

	const total = assessments.length
	const implemented = assessments.filter((a) => a.status === "implemented").length
	const partial = assessments.filter((a) => a.status === "partially_implemented").length
	const notImpl = assessments.filter((a) => a.status === "not_implemented").length
	const notRel = assessments.filter((a) => a.status === "not_relevant").length
	const notAssessed = assessments.filter((a) => !a.status).length

	const pct = (n: number) => (total > 0 ? ((n / total) * 100).toFixed(1) : "0.0")

	doc.fontSize(10).fillColor(darkText)
	doc.text(`Totalt kontroller: ${total}`)
	doc.text(`Implementert: ${implemented} (${pct(implemented)}%)`)
	doc.text(`Delvis implementert: ${partial} (${pct(partial)}%)`)
	doc.text(`Ikke implementert: ${notImpl} (${pct(notImpl)}%)`)
	doc.text(`Ikke relevant: ${notRel} (${pct(notRel)}%)`)
	doc.text(`Ikke vurdert: ${notAssessed} (${pct(notAssessed)}%)`)
	doc.moveDown(1)
}

function buildDomainBreakdown(doc: PDFKit.PDFDocument, assessments: Assessment[]) {
	const domainStats = new Map<
		string,
		{ name: string; total: number; implemented: number; partial: number; notImpl: number; notRel: number }
	>()

	for (const a of assessments) {
		const key = a.domainCode || a.domainName
		const d = domainStats.get(key) ?? {
			name: a.domainName,
			total: 0,
			implemented: 0,
			partial: 0,
			notImpl: 0,
			notRel: 0,
		}
		d.total++
		if (a.status === "implemented") d.implemented++
		if (a.status === "partially_implemented") d.partial++
		if (a.status === "not_implemented") d.notImpl++
		if (a.status === "not_relevant") d.notRel++
		domainStats.set(key, d)
	}

	if (domainStats.size === 0) return

	doc.fontSize(14).fillColor(blue).text("Per domene")
	doc.moveDown(0.3)

	const colWidths = [50, 175, 50, 55, 55, 55, 55]
	const headers = ["Kode", "Domene", "Totalt", "Impl.", "Delvis", "Ikke impl.", "Ikke rel."]
	drawTableRow(doc, 50, colWidths, headers, true)

	for (const [code, d] of domainStats) {
		ensureSpace(doc, 18)
		drawTableRow(doc, 50, colWidths, [
			code,
			d.name.slice(0, 40),
			String(d.total),
			String(d.implemented),
			String(d.partial),
			String(d.notImpl),
			String(d.notRel),
		])
	}
	doc.moveDown(1)
}

function buildAssessmentDetails(doc: PDFKit.PDFDocument, assessments: Assessment[]) {
	if (assessments.length === 0) return

	ensureSpace(doc, 50)
	doc.fontSize(14).fillColor(blue).text("Kontrollvurderinger")
	doc.moveDown(0.3)

	const colWidths = [55, 150, 80, 95, 115]
	drawTableRow(doc, 50, colWidths, ["Kontroll", "Kontrollnavn", "Domene", "Status", "Kommentar"], true)

	for (const a of assessments) {
		ensureSpace(doc, 18)
		drawTableRow(doc, 50, colWidths, [
			a.controlId,
			a.controlName.slice(0, 35),
			a.domainName.slice(0, 18),
			getStatusLabel(a.status),
			(a.comment ?? "").slice(0, 30),
		])
	}
	doc.moveDown(1)
}

function buildReviewsSection(doc: PDFKit.PDFDocument, reviews: Review[]) {
	if (reviews.length === 0) return

	doc.addPage()
	doc.fontSize(14).fillColor(blue).text("Rutinegjennomganger")
	doc.moveDown(0.3)

	const colWidths = [160, 120, 80, 60, 75]
	drawTableRow(doc, 50, colWidths, ["Tittel", "Rutine", "Dato", "Status", "Opprettet av"], true)

	for (const r of reviews) {
		ensureSpace(doc, 18)
		drawTableRow(doc, 50, colWidths, [
			r.title.slice(0, 40),
			r.routineName.slice(0, 28),
			new Date(r.reviewedAt).toLocaleDateString("nb-NO"),
			r.status === "completed" ? "Fullført" : "Utkast",
			r.createdBy,
		])
	}

	// Detail per review
	for (const r of reviews) {
		doc.moveDown(1)
		ensureSpace(doc, 80)

		doc.fontSize(11).fillColor(blue).text(r.title)
		doc.moveDown(0.2)

		doc.fontSize(8).fillColor(subtle)
		doc.text(`Rutine: ${r.routineName} (${getFrequencyLabel(r.routineFrequency)})`)
		doc.text(`Dato: ${new Date(r.reviewedAt).toLocaleString("nb-NO")}`)
		doc.text(`Opprettet av: ${r.createdBy}`)

		if (r.participants.length > 0) {
			const names = r.participants.map((p) => p.userName || p.userIdent).join(", ")
			doc.text(`Deltakere: ${names}`)
		}

		if (r.attachments.length > 0) {
			const fileNames = r.attachments.map((a) => a.fileName).join(", ")
			doc.text(`Vedlegg: ${fileNames}`)
		}

		if (r.summary) {
			doc.moveDown(0.3)
			doc.fontSize(8).fillColor(darkText)
			// Truncate very long summaries
			const summaryText = r.summary.length > 2000 ? `${r.summary.slice(0, 2000)}…` : r.summary
			doc.text(summaryText, { width: 495 })
		}
	}
}

function ensureSpace(doc: PDFKit.PDFDocument, needed: number) {
	if (doc.y > 780 - needed) {
		doc.addPage()
	}
}

function formatFileSize(bytes: number) {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function drawTableRow(doc: PDFKit.PDFDocument, x: number, colWidths: number[], cells: string[], isHeader = false) {
	ensureSpace(doc, 18)

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

	doc.fontSize(7).fillColor(isHeader ? blue : darkText)

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
