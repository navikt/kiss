import JSZip from "jszip"
import { PDFDocument as PDFLibDocument } from "pdf-lib"
import PDFDocument from "pdfkit"
import type { LoaderFunctionArgs } from "react-router"
import { getAppAssessments } from "~/db/queries/applications.server"
import { getApplicationDetail } from "~/db/queries/nais.server"
import { getReviewsForApp } from "~/db/queries/routines.server"
import { getStatusLabel } from "~/lib/compliance-status"
import { getCompositeFrequencyLabel } from "~/lib/routine-frequencies"
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
	const reportReviews = reviews.filter((r) => r.status === "completed" || r.status === "needs_follow_up")

	const namespace = detail.environments[0]?.namespace ?? null
	const cluster = detail.environments[0]?.cluster ?? null

	// Collect attachment buffers with review metadata
	const storage = getStorageProvider()
	const attachmentBuffers: Array<{
		fileName: string
		contentType: string
		data: Buffer
		reviewTitle: string
		reviewDate: string
		followUpPointText?: string
		followUpKind?: "description" | "resolution"
	}> = []
	const failedAttachments: Array<{ fileName: string; reviewTitle: string; followUpPointText?: string }> = []
	for (const review of reportReviews) {
		const reviewDate = new Date(review.reviewedAt).toISOString().slice(0, 10)
		for (const att of review.attachments) {
			try {
				const buf = await storage.download(att.bucketPath)
				attachmentBuffers.push({
					fileName: att.fileName,
					contentType: att.contentType,
					data: buf,
					reviewTitle: review.title,
					reviewDate,
				})
			} catch {
				failedAttachments.push({ fileName: att.fileName, reviewTitle: review.title })
			}
		}
		for (const point of review.followUpPoints) {
			for (const att of point.attachments) {
				try {
					const buf = await storage.download(att.bucketPath)
					attachmentBuffers.push({
						fileName: att.fileName,
						contentType: att.contentType,
						data: buf,
						reviewTitle: review.title,
						reviewDate,
						followUpPointText: point.text,
						followUpKind: att.kind,
					})
				} catch {
					failedAttachments.push({
						fileName: att.fileName,
						reviewTitle: review.title,
						followUpPointText: point.text,
					})
				}
			}
		}
	}

	const pdfAttachments = attachmentBuffers.filter((a) => a.contentType === "application/pdf")
	const nonPdfAttachments = attachmentBuffers.filter((a) => a.contentType !== "application/pdf")

	const mainPdfBuffer = await buildPdf(
		{ name: detail.app.name, namespace, cluster },
		assessments,
		reportReviews,
		pdfAttachments,
		nonPdfAttachments,
		failedAttachments,
	)

	// Merge PDF attachments as additional pages
	let finalPdf: Buffer
	if (pdfAttachments.length > 0) {
		finalPdf = await mergePdfAttachments(mainPdfBuffer, pdfAttachments)
	} else {
		finalPdf = mainPdfBuffer
	}

	const safeName = detail.app.name.replace(/[^a-zA-Z0-9æøåÆØÅ _-]/g, "_")

	// Build zip if there are non-PDF attachments
	if (nonPdfAttachments.length > 0) {
		const zip = new JSZip()
		zip.file("rapport.pdf", finalPdf)

		const vedleggFolder = zip.folder("vedlegg")
		if (!vedleggFolder) throw new Error("Could not create vedlegg folder in zip")
		const usedNames = new Set<string>()
		for (const att of nonPdfAttachments) {
			const safeReviewTitle = att.reviewTitle.replace(/[^a-zA-Z0-9æøåÆØÅ _-]/g, "_").slice(0, 50)
			const folderName = `${att.reviewDate}-${safeReviewTitle}`
			const subFolder = att.followUpPointText
				? `/oppfolgingspunkter/${att.followUpPointText.replace(/[^a-zA-Z0-9æøåÆØÅ _-]/g, "_").slice(0, 50)}${att.followUpKind === "description" ? " (beskrivelse)" : " (oppfølging)"}`
				: ""
			let entryName = `${folderName}${subFolder}/${att.fileName}`
			if (usedNames.has(entryName)) {
				const ext = att.fileName.includes(".") ? `.${att.fileName.split(".").pop()}` : ""
				const base = att.fileName.includes(".") ? att.fileName.slice(0, att.fileName.lastIndexOf(".")) : att.fileName
				let counter = 2
				do {
					entryName = `${folderName}${subFolder}/${base} (${counter})${ext}`
					counter++
				} while (usedNames.has(entryName))
			}
			usedNames.add(entryName)
			vedleggFolder.file(entryName, att.data)
		}

		const zipBuffer = Buffer.from(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }))
		return new Response(new Uint8Array(zipBuffer), {
			headers: {
				"Content-Type": "application/zip",
				"Content-Disposition": `attachment; filename="Compliance-rapport_${safeName}.zip"`,
			},
		})
	}

	return new Response(new Uint8Array(finalPdf), {
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

interface FollowUpPoint {
	text: string
	description: string | null
	resolution: string | null
	status: "needs_follow_up" | "completed" | "not_relevant"
	attachments: Array<{
		fileName: string
		contentType: string
		kind: "description" | "resolution"
	}>
}

interface Review {
	id: string
	title: string
	summary: string | null
	reviewedAt: Date
	createdBy: string
	status: string
	routineName: string
	routineFrequency: string | null
	routineEventFrequency?: string | null
	participants: Array<{ userIdent: string; userName: string | null; confirmedAt: Date | null }>
	attachments: Array<{ fileName: string; contentType: string; sizeBytes: number | null }>
	followUpPoints: FollowUpPoint[]
}

interface AttachmentData {
	fileName: string
	contentType: string
	data: Buffer
	reviewTitle: string
	followUpPointText?: string
	followUpKind?: "description" | "resolution"
}

interface FailedAttachment {
	fileName: string
	reviewTitle: string
	followUpPointText?: string
}

const blue = "#0067c5"
const darkText = "#222222"
const subtle = "#666666"

function buildPdf(
	app: AppInfo,
	assessments: Assessment[],
	reviews: Review[],
	pdfAttachments: AttachmentData[],
	nonPdfAttachments: AttachmentData[],
	failedAttachments: FailedAttachment[],
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

		// ─── PDF attachment cover pages ──────────────────────────────
		if (pdfAttachments.length > 0) {
			for (const att of pdfAttachments) {
				ensureSpace(doc, 80)
				doc.addPage()
				doc.fontSize(14).fillColor(blue).text("Vedlegg (PDF)")
				doc.moveDown(0.3)
				doc.fontSize(12).fillColor(darkText).text(att.fileName)
				doc.fontSize(8).fillColor(subtle)
				doc.text(`Filtype: ${att.contentType} — Størrelse: ${formatFileSize(att.data.length)}`)
				doc.text(`Gjennomgang: ${att.reviewTitle}`)
				if (att.followUpPointText) {
					const kindLabel = att.followUpKind === "description" ? "beskrivelse" : "oppfølging"
					doc.text(`Oppfølgingspunkt (${kindLabel}): ${att.followUpPointText}`)
				}
				doc.moveDown(0.5)
				doc.fontSize(9).fillColor(subtle).text("Dokumentet følger på neste side(r).")
			}
		}

		// ─── Non-PDF attachments — referenced, included in zip ───────
		if (nonPdfAttachments.length > 0 || failedAttachments.length > 0) {
			ensureSpace(doc, 80)
			doc.addPage()
			doc.fontSize(14).fillColor(blue).text("Vedlegg (i vedleggspakken)")
			doc.moveDown(0.3)
			doc
				.fontSize(9)
				.fillColor(subtle)
				.text("Filene nedenfor er inkludert i vedlegg/-mappen i den nedlastede zip-filen.")
			doc.moveDown(0.5)

			for (const att of nonPdfAttachments) {
				ensureSpace(doc, 30)
				doc.fontSize(10).fillColor(darkText).text(`• ${att.fileName}`)
				const fpSuffix = att.followUpPointText
					? ` — Oppfølgingspunkt (${att.followUpKind === "description" ? "beskrivelse" : "oppfølging"}): ${att.followUpPointText}`
					: ""
				doc
					.fontSize(8)
					.fillColor(subtle)
					.text(
						`  Filtype: ${att.contentType} — Størrelse: ${formatFileSize(att.data.length)} — Gjennomgang: ${att.reviewTitle}${fpSuffix}`,
					)
				doc.moveDown(0.3)
			}

			if (failedAttachments.length > 0) {
				doc.moveDown(0.5)
				doc.fontSize(10).fillColor("#ba3a26").text("Filer som ikke kunne lastes ned:")
				doc.moveDown(0.3)
				for (const att of failedAttachments) {
					const fpSuffix = att.followUpPointText ? ` — Oppfølgingspunkt: ${att.followUpPointText}` : ""
					doc.fontSize(9).fillColor("#ba3a26").text(`• ${att.fileName} (${att.reviewTitle})${fpSuffix}`)
				}
			}
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
			r.status === "completed" ? "Fullført" : r.status === "needs_follow_up" ? "Må følges opp" : "Utkast",
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
		const freqLabel = getCompositeFrequencyLabel(r.routineFrequency, r.routineEventFrequency)
		doc.text(`Rutine: ${r.routineName} (${freqLabel})`)
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

		if (r.followUpPoints.length > 0) {
			doc.moveDown(0.6)
			ensureSpace(doc, 60)
			doc.fontSize(11).fillColor(blue).text(`Oppfølgingspunkter (${r.followUpPoints.length})`)
			doc.moveDown(0.3)

			for (const [idx, p] of r.followUpPoints.entries()) {
				ensureSpace(doc, 80)

				doc
					.fontSize(10)
					.fillColor(darkText)
					.text(`${idx + 1}. ${p.text}`, { width: 495 })
				doc.moveDown(0.15)

				doc
					.fontSize(8)
					.fillColor(subtle)
					.text(`Status: ${followUpStatusLabel(p.status)}`, { width: 495 })

				if (p.description) {
					doc.moveDown(0.15)
					doc.fontSize(8).fillColor(subtle).text("Beskrivelse:", { width: 495 })
					const descText = p.description.length > 1500 ? `${p.description.slice(0, 1500)}…` : p.description
					doc.fontSize(8).fillColor(darkText).text(descText, { width: 495 })
				}

				if (p.resolution) {
					doc.moveDown(0.15)
					doc.fontSize(8).fillColor(subtle).text("Oppfølging:", { width: 495 })
					const resText = p.resolution.length > 1500 ? `${p.resolution.slice(0, 1500)}…` : p.resolution
					doc.fontSize(8).fillColor(darkText).text(resText, { width: 495 })
				}

				if (p.attachments.length > 0) {
					const descAtts = p.attachments.filter((a) => a.kind === "description").map((a) => a.fileName)
					const resAtts = p.attachments.filter((a) => a.kind === "resolution").map((a) => a.fileName)
					doc.moveDown(0.15)
					doc.fontSize(8).fillColor(subtle)
					if (descAtts.length > 0) doc.text(`Vedlegg til beskrivelse: ${descAtts.join(", ")}`, { width: 495 })
					if (resAtts.length > 0) doc.text(`Vedlegg til oppfølging: ${resAtts.join(", ")}`, { width: 495 })
				}

				doc.moveDown(0.5)
			}
		}
	}
}

function followUpStatusLabel(status: "needs_follow_up" | "completed" | "not_relevant"): string {
	switch (status) {
		case "needs_follow_up":
			return "Må følges opp"
		case "completed":
			return "Fullført"
		case "not_relevant":
			return "Ikke relevant"
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

async function mergePdfAttachments(mainPdf: Buffer, pdfAttachments: AttachmentData[]): Promise<Buffer> {
	const merged = await PDFLibDocument.load(mainPdf)

	for (const att of pdfAttachments) {
		try {
			const attachedPdf = await PDFLibDocument.load(att.data)
			const pages = await merged.copyPages(attachedPdf, attachedPdf.getPageIndices())
			for (const page of pages) {
				merged.addPage(page)
			}
		} catch {
			// Skip corrupt/unreadable PDFs
		}
	}

	const result = await merged.save()
	return Buffer.from(result)
}
