import PDFDocument from "pdfkit"
import type { GithubAccessStagedData } from "~/lib/github-access-staged-data"
import { formatDateTimeOslo, formatUserDisplayName } from "~/lib/utils"

const blue = "#0067c5"
const dark = "#222222"
const gray = "#666666"
const red = "#c30000"

type PdfDoc = InstanceType<typeof PDFDocument>

export function buildGithubAccessReviewPdf(
	data: GithubAccessStagedData,
	params: {
		performedBy: string
		generatedAt?: Date
		isDraft?: boolean
		participants?: Array<{ userIdent: string; userName: string | null; confirmedAt: Date | string | null }>
		githubUserLookups?: Map<string, { displayName: string | null; navIdent: string | null }>
		nameByNavIdent?: ReadonlyMap<string, string>
	},
): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const doc = new PDFDocument({ size: "A4", margin: 40, bufferPages: true })
		const chunks: Buffer[] = []

		doc.on("data", (chunk: Buffer) => chunks.push(chunk))
		doc.on("end", () => resolve(Buffer.concat(chunks)))
		doc.on("error", reject)

		const generatedAt = params.generatedAt ?? new Date()
		const dateOnly = (d: Date) =>
			d.toLocaleDateString("nb-NO", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Oslo" })
		const githubUserLookups =
			params.githubUserLookups ?? new Map<string, { displayName: string | null; navIdent: string | null }>()
		const userLabel = (username: string) => {
			const displayName = githubUserLookups.get(username)?.displayName?.trim()
			return displayName ? `${displayName} (@${username})` : username
		}
		const nameByNavIdent = params.nameByNavIdent ?? new Map<string, string>()
		const identLabel = (navIdent: string | null) => {
			if (!navIdent) return "—"
			const name = nameByNavIdent.get(navIdent.trim().toUpperCase())
			return formatUserDisplayName(navIdent, name)
		}
		const removedDuringReview = data.subjects.filter((s) => s.markedForRemoval)
		const adjustedDuringReview = data.subjects.filter((s) => s.permissionAdjustmentRequested)
		const activeSubjects = data.subjects.filter(
			(s) => !s.isGone && !s.markedForRemoval && !s.permissionAdjustmentRequested,
		)
		const reviewedSubjects = data.subjects.filter((s) => !s.isGone)
		const goneSubjects = data.subjects.filter((s) => s.isGone)

		doc.fontSize(16).fillColor(blue).text("Periodisk gjennomgang av tilganger – GitHub", { align: "left" })
		if (params.isDraft) {
			doc.moveDown(0.2)
			doc.fontSize(10).fillColor(red).text("UTKAST — gjennomgangen er ikke fullført ennå. Ikke gyldig revisjonsbevis.")
		}
		doc.moveDown(0.3)
		doc.fontSize(9).fillColor(gray)
		doc.text(`Repo: ${data.gitRepository}`)
		if (params.participants && params.participants.length > 0) {
			const participantsText = params.participants.map((p) => formatUserDisplayName(p.userIdent, p.userName)).join(", ")
			doc.text(`Deltakere i gjennomgangen: ${participantsText}`)
		}
		doc.text(
			data.confirmedBy && data.confirmedAt
				? `Bekreftet av: ${identLabel(data.confirmedBy)} (${formatDateTimeOslo(data.confirmedAt)})`
				: "Bekreftet av: Ikke bekreftet ennå",
		)
		doc.text(`Dato: ${dateOnly(generatedAt)}`)
		doc.moveDown(0.6)

		doc.fontSize(10).fillColor(dark)
		doc.text(`Personer med tilgang gjennomgått: ${reviewedSubjects.length}`)
		doc.text(`Antall tilganger merket for fjerning i denne gjennomgangen: ${removedDuringReview.length}`)
		doc.text(`Antall tilgangsnivå merket for justering i denne gjennomgangen: ${adjustedDuringReview.length}`)
		doc.text(`Antall som har fått tilgangen fjernet siden forrige gjennomgang: ${goneSubjects.length}`)
		doc.moveDown(0.8)

		doc.fontSize(9).fillColor(gray)
		doc.text("Personer med tilgang er hentet automatisk fra GitHub (direkte tilgang og via team).")
		doc.moveDown(0.3)
		const lastCheckedAt = data.dataSyncedAt ? formatDateTimeOslo(data.dataSyncedAt) : null
		doc.text(
			lastCheckedAt
				? `Data hentet fra GitHub: ${lastCheckedAt}.`
				: "Tidspunkt for datainnhenting fra GitHub er ukjent.",
		)
		doc.fillColor(dark)
		doc.moveDown(0.8)

		renderSimpleSubjectsTable(doc, "Personer med tilgang", activeSubjects, userLabel)

		if (adjustedDuringReview.length > 0) {
			doc.moveDown(0.8)
			renderDecisionSubjectsTable(
				doc,
				"Tilgangsnivå merket for justering i denne gjennomgangen",
				adjustedDuringReview,
				userLabel,
				identLabel,
			)
		}

		if (removedDuringReview.length > 0) {
			doc.moveDown(0.8)
			renderDecisionSubjectsTable(
				doc,
				"Tilganger merket for fjerning i denne gjennomgangen",
				removedDuringReview,
				userLabel,
				identLabel,
			)
		}

		if (goneSubjects.length > 0) {
			doc.moveDown(0.8)
			renderSimpleSubjectsTable(doc, "Fjernet siden forrige gjennomgang", goneSubjects, userLabel)
		}

		doc.end()
	})
}

function renderSimpleSubjectsTable(
	doc: PdfDoc,
	title: string,
	subjects: GithubAccessStagedData["subjects"],
	userLabel: (username: string) => string,
) {
	doc.fontSize(12).fillColor(blue).text(title)
	doc.moveDown(0.3)

	if (subjects.length === 0) {
		doc.fontSize(9).fillColor(gray).text("Ingen.")
		return
	}

	const colX = { user: 40, access: 180, source: 280 }
	const colW = { user: 140, access: 100, source: 260 }
	const tableRight = colX.source + colW.source
	const pad = 3
	const pageBottom = doc.page.height - doc.page.margins.bottom
	const border = "#c6c2bf"

	function drawHeader() {
		const y = doc.y
		doc.fontSize(8)
		const headerHeight =
			Math.max(
				doc.heightOfString("Bruker", { width: colW.user - pad * 2 }),
				doc.heightOfString("Tilgang", { width: colW.access - pad * 2 }),
				doc.heightOfString("Tilgang via", { width: colW.source - pad * 2 }),
			) +
			pad * 2
		doc.rect(colX.user, y, tableRight - colX.user, headerHeight).fill("#e6f0ff")
		doc.fontSize(8).fillColor(blue)
		doc.text("Bruker", colX.user + pad, y + pad, { width: colW.user - pad * 2 })
		doc.text("Tilgang", colX.access + pad, y + pad, { width: colW.access - pad * 2 })
		doc.text("Tilgang via", colX.source + pad, y + pad, { width: colW.source - pad * 2 })
		doc
			.strokeColor(border)
			.lineWidth(0.5)
			.rect(colX.user, y, tableRight - colX.user, headerHeight)
			.stroke()
		doc.y = y + headerHeight
		doc.x = colX.user
	}

	drawHeader()

	for (const subject of subjects) {
		if (doc.y > pageBottom - 80) {
			doc.addPage()
			drawHeader()
		}

		const source = [
			subject.directPermission ? "Direkte" : null,
			...subject.viaTeams.map((t) => `Team: ${t.teamName || t.teamSlug}`),
		].filter((s): s is string => s !== null)
		const sourceText = source.length > 0 ? source.join("\n") : "—"
		const accessText = subject.highestPermission
		const userText = userLabel(subject.username)

		doc.fontSize(8)
		const rowHeight =
			pad * 2 +
			Math.max(
				doc.heightOfString(userText, { width: colW.user - pad * 2 }),
				doc.heightOfString(accessText, { width: colW.access - pad * 2 }),
				doc.heightOfString(sourceText, { width: colW.source - pad * 2 }),
			)

		const y = doc.y
		doc
			.strokeColor(border)
			.lineWidth(0.5)
			.rect(colX.user, y, tableRight - colX.user, rowHeight)
			.stroke()

		doc.fontSize(8).fillColor(dark)
		doc.text(userText, colX.user + pad, y + pad, { width: colW.user - pad * 2 })
		doc.text(accessText, colX.access + pad, y + pad, { width: colW.access - pad * 2 })
		doc.text(sourceText, colX.source + pad, y + pad, { width: colW.source - pad * 2 })

		doc.y = y + rowHeight
		doc.x = colX.user
		doc.moveDown(0.4)
	}
}

function renderDecisionSubjectsTable(
	doc: PdfDoc,
	title: string,
	subjects: GithubAccessStagedData["subjects"],
	userLabel: (username: string) => string,
	identLabel: (navIdent: string | null) => string,
) {
	doc.fontSize(12).fillColor(blue).text(title)
	doc.moveDown(0.3)

	if (subjects.length === 0) {
		doc.fontSize(9).fillColor(gray).text("Ingen.")
		return
	}

	const dateOnlyLabel = (dateOnly: string | null) => {
		if (!dateOnly) return "—"
		const [y, m, d] = dateOnly.split("-").map(Number)
		return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("nb-NO", {
			day: "numeric",
			month: "long",
			year: "numeric",
			timeZone: "UTC",
		})
	}

	const colX = { user: 40, access: 150, source: 230, markedBy: 350, date: 460 }
	const colW = { user: 110, access: 80, source: 120, markedBy: 110, date: 80 }
	const tableRight = colX.date + colW.date
	const pad = 3
	const pageBottom = doc.page.height - doc.page.margins.bottom
	const border = "#c6c2bf"

	function drawHeader() {
		const y = doc.y
		doc.fontSize(8)
		const headerHeight =
			Math.max(
				doc.heightOfString("Bruker", { width: colW.user - pad * 2 }),
				doc.heightOfString("Tilgang", { width: colW.access - pad * 2 }),
				doc.heightOfString("Tilgang via", { width: colW.source - pad * 2 }),
				doc.heightOfString("Registrert av", { width: colW.markedBy - pad * 2 }),
				doc.heightOfString("Dato", { width: colW.date - pad * 2 }),
			) +
			pad * 2
		doc.rect(colX.user, y, tableRight - colX.user, headerHeight).fill("#e6f0ff")
		doc.fontSize(8).fillColor(blue)
		doc.text("Bruker", colX.user + pad, y + pad, { width: colW.user - pad * 2 })
		doc.text("Tilgang", colX.access + pad, y + pad, { width: colW.access - pad * 2 })
		doc.text("Tilgang via", colX.source + pad, y + pad, { width: colW.source - pad * 2 })
		doc.text("Registrert av", colX.markedBy + pad, y + pad, { width: colW.markedBy - pad * 2 })
		doc.text("Dato", colX.date + pad, y + pad, { width: colW.date - pad * 2 })
		doc
			.strokeColor(border)
			.lineWidth(0.5)
			.rect(colX.user, y, tableRight - colX.user, headerHeight)
			.stroke()
		doc.y = y + headerHeight
		doc.x = colX.user
	}

	drawHeader()

	for (const subject of subjects) {
		if (doc.y > pageBottom - 80) {
			doc.addPage()
			drawHeader()
		}

		const source = [
			subject.directPermission ? "Direkte" : null,
			...subject.viaTeams.map((t) => `Team: ${t.teamName || t.teamSlug}`),
		].filter((s): s is string => s !== null)
		const sourceText = source.length > 0 ? source.join("\n") : "—"

		const accessText = subject.permissionAdjustmentRequested
			? `${subject.highestPermission} -> ${subject.targetPermission}`
			: subject.highestPermission

		const markedBy = subject.markedForRemoval ? subject.removalMarkedBy : subject.permissionAdjustmentMarkedBy
		const markedAt = subject.markedForRemoval ? subject.removalMarkedAt : subject.permissionAdjustmentMarkedAt
		const markedByText = identLabel(markedBy)
		const dateText = dateOnlyLabel(markedAt)
		const userText = userLabel(subject.username)

		doc.fontSize(8)
		const rowHeight =
			pad * 2 +
			Math.max(
				doc.heightOfString(userText, { width: colW.user - pad * 2 }),
				doc.heightOfString(accessText, { width: colW.access - pad * 2 }),
				doc.heightOfString(sourceText, { width: colW.source - pad * 2 }),
				doc.heightOfString(markedByText, { width: colW.markedBy - pad * 2 }),
				doc.heightOfString(dateText, { width: colW.date - pad * 2 }),
			)

		const y = doc.y
		doc
			.strokeColor(border)
			.lineWidth(0.5)
			.rect(colX.user, y, tableRight - colX.user, rowHeight)
			.stroke()

		doc.fontSize(8).fillColor(dark)
		doc.text(userText, colX.user + pad, y + pad, { width: colW.user - pad * 2 })
		doc.text(accessText, colX.access + pad, y + pad, { width: colW.access - pad * 2 })
		doc.text(sourceText, colX.source + pad, y + pad, { width: colW.source - pad * 2 })
		doc.text(markedByText, colX.markedBy + pad, y + pad, { width: colW.markedBy - pad * 2 })
		doc.text(dateText, colX.date + pad, y + pad, { width: colW.date - pad * 2 })

		doc.y = y + rowHeight
		doc.x = colX.user
		doc.moveDown(0.4)
	}
}
