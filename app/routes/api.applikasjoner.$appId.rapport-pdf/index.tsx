import JSZip from "jszip"
import PDFDocument from "pdfkit"
import type { LoaderFunctionArgs } from "react-router"
import { enrichAppAssessments } from "~/db/queries/app-assessment-enrichment.server"
import { getAppAssessments } from "~/db/queries/applications.server"
import { getAuditEvidenceForReport } from "~/db/queries/audit-evidence.server"
import { getEvidenceDownloadsForActivityWithBucketDetails } from "~/db/queries/evidence-downloads.server"
import { getApplicationDetail } from "~/db/queries/nais.server"
import { getActivitiesForReviews, getReviewsForApp } from "~/db/queries/routines.server"
import { isOracleEvidenceActivityType } from "~/lib/activity-types"
import { getStatusLabel } from "~/lib/compliance-status"
import { getCompositeFrequencyLabel } from "~/lib/routine-frequencies"
import { getStorageProvider } from "~/lib/storage/index.server"

export async function loader({ params }: LoaderFunctionArgs) {
	const appId = params.appId
	if (!appId) throw new Response("Mangler app-ID", { status: 400 })

	const [detail, assessmentsResult, reviews, auditEvidence] = await Promise.all([
		getApplicationDetail(appId),
		getAppAssessments(appId),
		getReviewsForApp(appId),
		getAuditEvidenceForReport(appId),
	])
	if (!detail) throw new Response("Applikasjon ikke funnet", { status: 404 })

	const enriched = await enrichAppAssessments(appId, assessmentsResult?.assessments ?? [])
	const assessments: Assessment[] = enriched.map((a) => ({
		controlId: a.controlId,
		controlName: a.controlName,
		domainCode: a.domainCode,
		domainName: a.domainName,
		effectiveStatus: a.effectiveStatus,
		coveringRoutines: a.coveringRoutines,
		comment: a.comment,
		commentUpdatedBy: a.commentUpdatedBy,
		commentUpdatedAt: a.commentUpdatedAt,
	}))
	const reportReviews = reviews.filter((r) => r.status === "completed" || r.status === "needs_follow_up")

	const reviewActivities = reportReviews.length > 0 ? await getActivitiesForReviews(reportReviews.map((r) => r.id)) : []

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

	// Download oracle evidence Excel files and add to attachments
	// 1. Activity-based oracle evidence (OracleEvidenceSection — routineReviewEvidenceDownloads)
	const oracleEvidenceByReviewId = new Map<
		string,
		Array<{ fileName: string; contentType: string; performedBy: string; performedAt: Date }>
	>()
	const reviewById = new Map(reportReviews.map((r) => [r.id, r]))
	for (const act of reviewActivities) {
		if (!isOracleEvidenceActivityType(act.type)) continue
		const review = reviewById.get(act.reviewId)
		const reviewTitle = review?.title ?? "oracle-revisjonsbevis"
		const reviewDate = review
			? new Date(review.reviewedAt).toISOString().slice(0, 10)
			: new Date().toISOString().slice(0, 10)
		const evidenceDownloads = await getEvidenceDownloadsForActivityWithBucketDetails(act.id)
		for (const dl of evidenceDownloads) {
			try {
				const buf = await storage.download(dl.bucketPath)
				const safeFileName = dl.fileName.replace(/[/\\]/g, "_").replace(/^\.+/, "_")
				attachmentBuffers.push({
					fileName: safeFileName,
					contentType: dl.contentType,
					data: buf,
					reviewTitle,
					reviewDate,
				})
				const entry = oracleEvidenceByReviewId.get(act.reviewId) ?? []
				entry.push({
					fileName: safeFileName,
					contentType: dl.contentType,
					performedBy: dl.performedBy,
					performedAt: dl.performedAt,
				})
				oracleEvidenceByReviewId.set(act.reviewId, entry)
			} catch {
				// Skip files that can't be downloaded
			}
		}
	}

	// 2. Legacy app-level oracle snapshots (auditEvidenceSnapshots)
	const oracleEvidenceWithFileName = await Promise.all(
		auditEvidence.map(async (evidence) => {
			const date = evidence.collectedAt.toISOString().slice(0, 10)
			const fileName = `oracle-snapshot-${evidence.instanceId}-${date}.xlsx`
			try {
				const buf = await storage.download(evidence.bucketPath)
				attachmentBuffers.push({
					fileName,
					contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
					data: buf,
					reviewTitle: "oracle-revisjonsbevis",
					reviewDate: date,
				})
				return {
					instanceId: evidence.instanceId,
					overallStatus: evidence.overallStatus,
					collectedAt: evidence.collectedAt,
					fileName,
				}
			} catch {
				return {
					instanceId: evidence.instanceId,
					overallStatus: evidence.overallStatus,
					collectedAt: evidence.collectedAt,
					fileName: undefined,
				}
			}
		}),
	)

	const mainPdfBuffer = await buildPdf(
		{ name: detail.app.name, namespace, cluster },
		assessments,
		reportReviews,
		oracleEvidenceWithFileName,
		oracleEvidenceByReviewId,
		attachmentBuffers,
		failedAttachments,
	)

	const safeName = detail.app.name.replace(/[^a-zA-Z0-9æøåÆØÅ _-]/g, "_")

	// Build zip if there are any attachments
	if (attachmentBuffers.length > 0) {
		const zip = new JSZip()
		zip.file("rapport.pdf", mainPdfBuffer)

		const vedleggFolder = zip.folder("vedlegg")
		if (!vedleggFolder) throw new Error("Could not create vedlegg folder in zip")
		const usedNames = new Set<string>()
		for (const att of attachmentBuffers) {
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

	return new Response(new Uint8Array(mainPdfBuffer), {
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
	effectiveStatus: string | null
	coveringRoutines: Array<{ id: string; name: string }>
	comment: string | null
	commentUpdatedBy: string | null
	commentUpdatedAt: string | null
}

interface FollowUpPoint {
	text: string
	description: string | null
	resolution: string | null
	status: "needs_follow_up" | "completed" | "not_relevant"
	createdBy: string
	createdAt: Date
	resolvedBy: string | null
	resolvedAt: Date | null
	attachments: Array<{
		fileName: string
		contentType: string
		kind: "description" | "resolution"
		uploadedBy: string
		uploadedAt: Date | string
	}>
}

interface Review {
	id: string
	routineId: string
	title: string
	summary: string | null
	reviewedAt: Date
	createdAt: Date
	createdBy: string
	status: string
	routineName: string
	routineDescription: string | null
	routineFrequency: string | null
	routineEventFrequency?: string | null
	routineApprovedAt?: Date | null
	routineArchivedAt?: Date | null
	routineReplacedAt?: Date | null
	participants: Array<{ userIdent: string; userName: string | null; confirmedAt: Date | null }>
	attachments: Array<{
		fileName: string
		contentType: string
		sizeBytes: number | null
		uploadedBy: string
		uploadedAt: Date | string
	}>
	links: Array<{ url: string; title: string | null }>
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
	auditEvidence: Array<{ instanceId: string; overallStatus: string; collectedAt: Date; fileName?: string }>,
	oracleEvidenceByReviewId: Map<
		string,
		Array<{ fileName: string; contentType: string; performedBy: string; performedAt: Date }>
	>,
	allAttachments: AttachmentData[],
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
		buildReviewsSection(doc, reviews, oracleEvidenceByReviewId)

		// ─── Audit evidence — Oracle databases ────────────────────────
		if (auditEvidence.length > 0) {
			doc.addPage()
			doc.fontSize(16).fillColor(blue).text("Revisjonsbevis — Oracle-databaser", { underline: true })
			doc.moveDown()
			for (const evidence of auditEvidence) {
				ensureSpace(doc, 60)
				doc.fontSize(12).fillColor(darkText).text(`${evidence.instanceId.toUpperCase()} — ${evidence.overallStatus}`, {
					underline: true,
				})
				doc.moveDown(0.5)
				doc
					.fontSize(9)
					.fillColor(subtle)
					.text(`Hentet: ${evidence.collectedAt.toLocaleDateString("nb-NO")}`)
				if (evidence.fileName) {
					doc.moveDown(0.3)
					doc
						.fontSize(9)
						.fillColor(subtle)
						.text(`Bevisfilene er inkludert i vedlegg/-mappen i den nedlastede zip-filen: ${evidence.fileName}`)
				}
				doc.moveDown()
			}
		}

		// ─── Attachments — referenced, included in zip ───────────────
		if (allAttachments.length > 0 || failedAttachments.length > 0) {
			ensureSpace(doc, 80)
			doc.addPage()
			doc.fontSize(14).fillColor(blue).text("Vedlegg (i vedleggspakken)")
			doc.moveDown(0.3)
			doc
				.fontSize(9)
				.fillColor(subtle)
				.text("Filene nedenfor er inkludert i vedlegg/-mappen i den nedlastede zip-filen.")
			doc.moveDown(0.5)

			for (const att of allAttachments) {
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
	const implemented = assessments.filter((a) => a.effectiveStatus === "implemented").length
	const partial = assessments.filter((a) => a.effectiveStatus === "partially_implemented").length
	const notImpl = assessments.filter((a) => a.effectiveStatus === "not_implemented").length
	const notRel = assessments.filter((a) => a.effectiveStatus === "not_relevant").length
	const notAssessed = assessments.filter((a) => !a.effectiveStatus).length

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
		if (a.effectiveStatus === "implemented") d.implemented++
		if (a.effectiveStatus === "partially_implemented") d.partial++
		if (a.effectiveStatus === "not_implemented") d.notImpl++
		if (a.effectiveStatus === "not_relevant") d.notRel++
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

	const colWidths = [55, 145, 75, 95, 125]
	drawTableRow(doc, 50, colWidths, ["Kontroll", "Kontrollnavn", "Domene", "Status", "Dekkes av rutiner"], true)

	for (const a of assessments) {
		ensureSpace(doc, 18)
		const routineNames = a.coveringRoutines.length > 0 ? a.coveringRoutines.map((r) => r.name).join(", ") : ""
		drawTableRow(doc, 50, colWidths, [
			a.controlId,
			a.controlName.slice(0, 34),
			a.domainName.slice(0, 18),
			getStatusLabel(a.effectiveStatus),
			routineNames.slice(0, 35),
		])
	}
	doc.moveDown(1)
}

function buildReviewsSection(
	doc: PDFKit.PDFDocument,
	reviews: Review[],
	oracleEvidenceByReviewId: Map<
		string,
		Array<{ fileName: string; contentType: string; performedBy: string; performedAt: Date }>
	>,
) {
	if (reviews.length === 0) return

	doc.addPage()
	doc.fontSize(14).fillColor(blue).text("Rutinegjennomganger")
	doc.moveDown(0.3)

	// Summary table
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

	// Group reviews by routineId to render them together with their routine documentation
	const routineOrder: string[] = []
	const reviewsByRoutine = new Map<
		string,
		{
			routineName: string
			routineDescription: string | null
			routineApprovedAt?: Date | null
			routineArchivedAt?: Date | null
			routineReplacedAt?: Date | null
			reviews: Review[]
		}
	>()
	for (const r of reviews) {
		if (!reviewsByRoutine.has(r.routineId)) {
			routineOrder.push(r.routineId)
			reviewsByRoutine.set(r.routineId, {
				routineName: r.routineName,
				routineDescription: r.routineDescription,
				routineApprovedAt: r.routineApprovedAt,
				routineArchivedAt: r.routineArchivedAt,
				routineReplacedAt: r.routineReplacedAt,
				reviews: [],
			})
		}
		reviewsByRoutine.get(r.routineId)?.reviews.push(r)
	}

	for (const routineId of routineOrder) {
		const group = reviewsByRoutine.get(routineId)
		if (!group) continue

		// ─── Rutine header ────────────────────────────────────────────
		doc.moveDown(1.5)
		ensureSpace(doc, 100)
		doc.fontSize(13).fillColor(blue).text(group.routineName)
		doc.moveDown(0.2)
		if (group.routineApprovedAt) {
			doc
				.fontSize(8)
				.fillColor(subtle)
				.text(`Godkjent: ${new Date(group.routineApprovedAt).toLocaleDateString("nb-NO")}`)
		}
		if (group.routineArchivedAt) {
			doc
				.fontSize(8)
				.fillColor(subtle)
				.text(`Arkivert: ${new Date(group.routineArchivedAt).toLocaleDateString("nb-NO")}`)
		}
		if (group.routineReplacedAt) {
			doc
				.fontSize(8)
				.fillColor(subtle)
				.text(`Erstattet: ${new Date(group.routineReplacedAt).toLocaleDateString("nb-NO")}`)
		}
		if (group.routineDescription) {
			const descText =
				group.routineDescription.length > 2000
					? `${group.routineDescription.slice(0, 2000)}…`
					: group.routineDescription
			doc.fontSize(9).fillColor(subtle).text(descText, { width: 495 })
		}

		// ─── Gjennomganger for this rutine ────────────────────────────
		for (const r of group.reviews) {
			doc.moveDown(0.8)
			ensureSpace(doc, 80)

			doc.fontSize(11).fillColor(darkText).text(r.title)
			doc.moveDown(0.2)

			doc.fontSize(8).fillColor(subtle)
			const freqLabel = getCompositeFrequencyLabel(r.routineFrequency, r.routineEventFrequency)
			doc.text(`Frekvens: ${freqLabel}`)
			doc.text(`Dato for gjennomgang: ${new Date(r.reviewedAt).toLocaleString("nb-NO")}`)
			doc.text(`Registrert av: ${r.createdBy} — ${new Date(r.createdAt).toLocaleString("nb-NO")}`)

			if (r.participants.length > 0) {
				const names = r.participants.map((p) => p.userName || p.userIdent).join(", ")
				doc.text(`Deltakere: ${names}`)
			}

			if (r.summary) {
				doc.moveDown(0.3)
				doc.fontSize(8).fillColor(darkText)
				const summaryText = r.summary.length > 2000 ? `${r.summary.slice(0, 2000)}…` : r.summary
				doc.text(summaryText, { width: 495 })
			}

			// ─── Lenker ───────────────────────────────────────────────
			if (r.links.length > 0) {
				doc.moveDown(0.5)
				ensureSpace(doc, 40)
				doc.fontSize(9).fillColor(blue).text("Lenker")
				doc.moveDown(0.2)
				for (const link of r.links) {
					ensureSpace(doc, 16)
					const label = link.title ? `${link.title} — ` : ""
					doc.fontSize(8).fillColor(darkText).text(`• ${label}${link.url}`, { width: 495 })
				}
			}

			// ─── Vedlegg (review-level) ───────────────────────────────
			const reviewOracleEvidence = oracleEvidenceByReviewId.get(r.id) ?? []
			if (r.attachments.length > 0 || reviewOracleEvidence.length > 0) {
				const hasOracleAtt = reviewOracleEvidence.length > 0
				const reviewFolderName = `${new Date(r.reviewedAt).toISOString().slice(0, 10)}-${r.title.replace(/[^a-zA-Z0-9æøåÆØÅ _-]/g, "_").slice(0, 50)}`
				doc.moveDown(0.5)
				ensureSpace(doc, 40)
				doc.fontSize(9).fillColor(blue).text("Vedlegg")
				doc.moveDown(0.2)
				if (r.attachments.length > 0 || hasOracleAtt) {
					doc
						.fontSize(7)
						.fillColor(subtle)
						.text(`Vedlegg er tilgjengelig i vedlegg/${reviewFolderName}/ i den nedlastede zip-filen.`, {
							width: 495,
						})
					doc.moveDown(0.3)
				}
				for (const att of r.attachments) {
					ensureSpace(doc, 16)
					const sizeLabel = att.sizeBytes != null ? ` — ${formatFileSize(att.sizeBytes)}` : ""
					doc.fontSize(8).fillColor(darkText).text(`• ${att.fileName} (${att.contentType}${sizeLabel})`, { width: 495 })
					doc
						.fontSize(7)
						.fillColor(subtle)
						.text(`  Lastet opp av: ${att.uploadedBy} — ${new Date(att.uploadedAt).toLocaleString("nb-NO")}`, {
							width: 495,
						})
				}
				for (const oe of reviewOracleEvidence) {
					ensureSpace(doc, 16)
					doc.fontSize(8).fillColor(darkText).text(`• ${oe.fileName}`, { width: 495 })
					doc
						.fontSize(7)
						.fillColor(subtle)
						.text(`  Lastet ned av: ${oe.performedBy} — ${new Date(oe.performedAt).toLocaleString("nb-NO")}`, {
							width: 495,
						})
				}
			}

			// ─── Oppfølgingspunkter ───────────────────────────────────
			if (r.followUpPoints.length > 0) {
				doc.moveDown(0.6)
				ensureSpace(doc, 60)
				doc.fontSize(9).fillColor(blue).text(`Oppfølgingspunkter (${r.followUpPoints.length})`)
				doc.moveDown(0.3)

				for (const [idx, p] of r.followUpPoints.entries()) {
					ensureSpace(doc, 80)

					doc
						.fontSize(10)
						.fillColor(darkText)
						.text(`${idx + 1}. ${p.text}`, { width: 495 })
					doc.moveDown(0.15)

					doc.fontSize(8).fillColor(subtle).text("Beskrivelse:", { width: 495 })
					doc
						.fontSize(7)
						.fillColor(subtle)
						.text(`Opprettet av: ${p.createdBy} — ${new Date(p.createdAt).toLocaleString("nb-NO")}`, { width: 495 })
					if (p.description) {
						const descText = p.description.length > 1500 ? `${p.description.slice(0, 1500)}…` : p.description
						doc.fontSize(8).fillColor(darkText).text(descText, { width: 495 })
					}

					doc.moveDown(0.15)
					doc.fontSize(8).fillColor(subtle).text("Oppfølging:", { width: 495 })
					doc
						.fontSize(8)
						.fillColor(subtle)
						.text(`Status: ${followUpStatusLabel(p.status)}`, { width: 495 })
					if (p.resolvedBy && p.resolvedAt) {
						doc
							.fontSize(7)
							.fillColor(subtle)
							.text(`Løst av: ${p.resolvedBy} — ${new Date(p.resolvedAt).toLocaleString("nb-NO")}`, { width: 495 })
					}
					if (p.resolution) {
						const resText = p.resolution.length > 1500 ? `${p.resolution.slice(0, 1500)}…` : p.resolution
						doc.moveDown(0.1)
						doc.fontSize(8).fillColor(darkText).text(resText, { width: 495 })
					}

					// ─── Vedlegg for oppfølgingspunkt ─────────────────────
					if (p.attachments.length > 0) {
						const reviewFolderName = `${new Date(r.reviewedAt).toISOString().slice(0, 10)}-${r.title.replace(/[^a-zA-Z0-9æøåÆØÅ _-]/g, "_").slice(0, 50)}`
						doc.moveDown(0.3)
						ensureSpace(doc, 40)
						doc.fontSize(8).fillColor(blue).text("Vedlegg", { width: 495 })
						doc.moveDown(0.15)
						doc
							.fontSize(7)
							.fillColor(subtle)
							.text(
								`Vedlegg er tilgjengelig i vedlegg/${reviewFolderName}/oppfolgingspunkter/ i den nedlastede zip-filen.`,
								{
									width: 495,
								},
							)
						doc.moveDown(0.2)
						for (const att of p.attachments) {
							ensureSpace(doc, 16)
							const kindLabel = att.kind === "description" ? "beskrivelse" : "oppfølging"
							doc.fontSize(8).fillColor(darkText).text(`• ${att.fileName} (${kindLabel})`, { width: 495 })
							doc
								.fontSize(7)
								.fillColor(subtle)
								.text(`  Lastet opp av: ${att.uploadedBy} — ${new Date(att.uploadedAt).toLocaleString("nb-NO")}`, {
									width: 495,
								})
						}
					}

					doc.moveDown(0.5)
				}
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
