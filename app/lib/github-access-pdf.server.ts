import PDFDocument from "pdfkit"
import type { GithubAccessStagedData } from "~/lib/github-access-staged-data"
import { formatDateTimeOslo, formatUserDisplayName } from "~/lib/utils"

const blue = "#0067c5"
const dark = "#222222"
const gray = "#666666"

function chunkLinesByHeight(doc: PdfDoc, lines: string[], width: number, maxHeight: number): string[][] {
	if (lines.length === 0) return [[]]
	const chunks: string[][] = []
	let current: string[] = []
	for (const line of lines) {
		const candidate = [...current, line]
		const candidateHeight = doc.heightOfString(candidate.join("\n"), { width })
		if (current.length > 0 && candidateHeight > maxHeight) {
			chunks.push(current)
			current = [line]
		} else {
			current = candidate
		}
	}
	if (current.length > 0) chunks.push(current)
	return chunks
}

type PdfDoc = InstanceType<typeof PDFDocument>

export function buildGithubAccessReviewPdf(
	data: GithubAccessStagedData,
	params: {
		performedBy: string
		generatedAt?: Date
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
		const activeSubjects = data.subjects.filter((s) => !s.markedForRemoval && !s.permissionAdjustmentRequested)

		doc.fontSize(16).fillColor(blue).text("Periodisk gjennomgang av tilganger – GitHub", { align: "left" })
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
		doc.text(`Personer med tilgang gjennomgått: ${data.subjects.length}`)
		doc.text(`Antall tilganger merket for fjerning i denne gjennomgangen: ${removedDuringReview.length}`)
		doc.text(`Antall tilgangsnivå merket for justering i denne gjennomgangen: ${adjustedDuringReview.length}`)
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

		doc.end()
	})
}

function subjectSourceLines(subject: GithubAccessStagedData["subjects"][number]): string[] {
	return [
		subject.directPermission ? "Direkte" : null,
		...subject.viaTeams.map((t) => `Team: ${t.teamName || t.teamSlug}`),
	].filter((s): s is string => s !== null)
}

function dateOnlyLabel(dateOnly: string | null): string {
	if (!dateOnly) return "—"
	const [y, m, d] = dateOnly.split("-").map(Number)
	return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("nb-NO", {
		day: "numeric",
		month: "long",
		year: "numeric",
		timeZone: "UTC",
	})
}

type TableColumn = { key: string; label: string; x: number; width: number }

/**
 * Tegner en tabell med én "wrap"-kolonne (teamliste) som kan brytes over flere
 * fortsettelsesrader og sideskift. De øvrige kolonnene vises kun på radens første chunk.
 */
function renderSubjectsTable(
	doc: PdfDoc,
	title: string,
	subjects: GithubAccessStagedData["subjects"],
	columns: TableColumn[],
	wrapColumnKey: string,
	getCellText: (subject: GithubAccessStagedData["subjects"][number]) => Record<string, string>,
) {
	doc.fontSize(12).fillColor(blue).text(title)
	doc.moveDown(0.3)

	if (subjects.length === 0) {
		doc.fontSize(9).fillColor(gray).text("Ingen.")
		return
	}

	const pad = 3
	const tableLeft = columns[0].x
	const tableRight = columns[columns.length - 1].x + columns[columns.length - 1].width
	const pageBottom = doc.page.height - doc.page.margins.bottom
	const border = "#c6c2bf"

	function drawHeader() {
		const y = doc.y
		doc.fontSize(8)
		const headerHeight =
			Math.max(...columns.map((c) => doc.heightOfString(c.label, { width: c.width - pad * 2 }))) + pad * 2
		doc.rect(tableLeft, y, tableRight - tableLeft, headerHeight).fill("#e6f0ff")
		doc.fontSize(8).fillColor(blue)
		for (const c of columns) doc.text(c.label, c.x + pad, y + pad, { width: c.width - pad * 2 })
		doc
			.strokeColor(border)
			.lineWidth(0.5)
			.rect(tableLeft, y, tableRight - tableLeft, headerHeight)
			.stroke()
		doc.y = y + headerHeight
		doc.x = tableLeft
		return headerHeight
	}

	const wrapColumn = columns.find((c) => c.key === wrapColumnKey)
	if (!wrapColumn) throw new Error(`Ukjent wrap-kolonne: ${wrapColumnKey}`)

	const headerHeight = drawHeader()
	const maxChunkHeight = pageBottom - doc.page.margins.top - headerHeight - pad * 2

	for (const subject of subjects) {
		const cellText = getCellText(subject)
		const wrapLines = subjectSourceLines(subject)
		const wrapChunks = chunkLinesByHeight(
			doc,
			wrapLines.length > 0 ? wrapLines : ["—"],
			wrapColumn.width - pad * 2,
			maxChunkHeight,
		)

		wrapChunks.forEach((chunk, chunkIndex) => {
			const isFirstChunk = chunkIndex === 0
			const wrapText = chunk.join("\n")

			doc.fontSize(8)
			const rowHeight =
				pad * 2 +
				Math.max(
					...columns.map((c) =>
						c.key === wrapColumnKey
							? doc.heightOfString(wrapText, { width: c.width - pad * 2 })
							: isFirstChunk
								? doc.heightOfString(cellText[c.key] ?? "", { width: c.width - pad * 2 })
								: 0,
					),
				)

			if (doc.y + rowHeight > pageBottom) {
				doc.addPage()
				drawHeader()
			}

			const y = doc.y
			doc
				.strokeColor(border)
				.lineWidth(0.5)
				.rect(tableLeft, y, tableRight - tableLeft, rowHeight)
				.stroke()

			doc.fontSize(8).fillColor(dark)
			for (const c of columns) {
				if (c.key === wrapColumnKey) {
					doc.text(wrapText, c.x + pad, y + pad, { width: c.width - pad * 2 })
				} else if (isFirstChunk) {
					doc.text(cellText[c.key] ?? "", c.x + pad, y + pad, { width: c.width - pad * 2 })
				}
			}

			doc.y = y + rowHeight
			doc.x = tableLeft
			doc.moveDown(0.4)
		})
	}
}

function renderSimpleSubjectsTable(
	doc: PdfDoc,
	title: string,
	subjects: GithubAccessStagedData["subjects"],
	userLabel: (username: string) => string,
) {
	renderSubjectsTable(
		doc,
		title,
		subjects,
		[
			{ key: "user", label: "Bruker", x: 40, width: 140 },
			{ key: "access", label: "Tilgang", x: 180, width: 100 },
			{ key: "source", label: "Tilgang via", x: 280, width: 260 },
		],
		"source",
		(subject) => ({ user: userLabel(subject.username), access: subject.highestPermission }),
	)
}

function renderDecisionSubjectsTable(
	doc: PdfDoc,
	title: string,
	subjects: GithubAccessStagedData["subjects"],
	userLabel: (username: string) => string,
	identLabel: (navIdent: string | null) => string,
) {
	renderSubjectsTable(
		doc,
		title,
		subjects,
		[
			{ key: "user", label: "Bruker", x: 40, width: 110 },
			{ key: "access", label: "Tilgang", x: 150, width: 80 },
			{ key: "source", label: "Tilgang via", x: 230, width: 120 },
			{ key: "markedBy", label: "Registrert av", x: 350, width: 110 },
			{ key: "date", label: "Dato", x: 460, width: 80 },
		],
		"source",
		(subject) => {
			const accessText = subject.permissionAdjustmentRequested
				? `${subject.highestPermission} -> ${subject.targetPermission}`
				: subject.highestPermission
			const markedBy = subject.markedForRemoval ? subject.removalMarkedBy : subject.permissionAdjustmentMarkedBy
			const markedAt = subject.markedForRemoval ? subject.removalMarkedAt : subject.permissionAdjustmentMarkedAt
			return {
				user: userLabel(subject.username),
				access: accessText,
				markedBy: identLabel(markedBy),
				date: dateOnlyLabel(markedAt),
			}
		},
	)
}
