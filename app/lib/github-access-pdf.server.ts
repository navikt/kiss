import PDFDocument from "pdfkit"
import type { GithubAccessStagedData } from "~/lib/github-access-staged-data"
import { formatDateTimeOslo, formatUserDisplayName } from "~/lib/utils"

const blue = "#0067c5"
const dark = "#222222"
const gray = "#666666"
const red = "#c30000"

type PdfDoc = InstanceType<typeof PDFDocument>

/**
 * Bygger et PDF-dokument som oppsummerer en GitHub-tilgangsgjennomgang: hvem som har
 * tilgang, hvor tilgangen kommer fra (direkte/team), og registrerte beslutninger (fjerning/justering).
 * Legges ved som revisjonsbevis
 * (`routine_review_attachments`, sourceType "automated") når aktiviteten fullføres.
 *
 * Kan også kalles på ikke-fullførte (draft) staged_data for å vise reviewer et utkast av
 * PDF-en før gjennomgangen fullføres — se `params.isDraft`.
 */
export function buildGithubAccessReviewPdf(
	data: GithubAccessStagedData,
	params: {
		/** Personen som teknisk klikket "Bekreft tjenstlig behov for alle" for denne aktiviteten —
		 *  kun til internt/revisjonsformål, vises ikke lenger som egen "Godkjent av"-linje (se
		 *  `participants`). */
		performedBy: string
		generatedAt?: Date
		/** Vises som "UTKAST"-varsel øverst i dokumentet — brukes til forhåndsvisning før fullføring. */
		isDraft?: boolean
		/** Registrerte deltakere på rutinegjennomgangen (fra "Innledning"-steget). Vises som
		 *  "Godkjent av"-linjen — gjennomgangen bekreftes i fellesskap av deltakerne, ikke av én
		 *  enkeltperson. Faller tilbake til `performedBy` dersom listen er tom/ukjent. */
		participants?: Array<{ userIdent: string; userName: string | null; confirmedAt: Date | string | null }>
		/** Visningsnavn/nav-ident fra NDAs Github-brukeroppslag, nøkkel = GitHub-brukernavn. Kun for
		 *  visning — feiler oppslaget vises brukernavnet alene. */
		githubUserLookups?: Map<string, { displayName: string | null; navIdent: string | null }>
		/** Reelt navn fra intern brukertabell, nøkkel = nav-ident i store bokstaver (som
		 *  `getUserNamesByNavIdents`). Brukes til "Godkjent av"-linjen og "Registrert av"-kolonnen per
		 *  rad — kun for visning, feiler oppslaget vises nav-identen alene. */
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
		const dateOnly = (d: Date) => d.toLocaleDateString("nb-NO", { day: "numeric", month: "long", year: "numeric" })
		const githubUserLookups =
			params.githubUserLookups ?? new Map<string, { displayName: string | null; navIdent: string | null }>()
		/** "Navn (@brukernavn)" når visningsnavn finnes fra NDA, ellers bare brukernavnet. */
		const userLabel = (username: string) => {
			const displayName = githubUserLookups.get(username)?.displayName?.trim()
			return displayName ? `${displayName} (@${username})` : username
		}
		const nameByNavIdent = params.nameByNavIdent ?? new Map<string, string>()
		/** "Navn (Z990001)" når reelt navn finnes i brukertabellen, ellers bare nav-identen. */
		const identLabel = (navIdent: string | null) => {
			if (!navIdent) return "—"
			const name = nameByNavIdent.get(navIdent.trim().toUpperCase())
			return formatUserDisplayName(navIdent, name)
		}
		// Merket for fjerning/justering i DENNE runden — reviewer har besluttet dette, og hver person
		// får automatisk et preutfylt oppfølgingspunkt når gjennomgangen fullføres (se
		// `commitGithubAccessActivity`). KISS gjør ikke lenger et nytt GitHub-kall for å bekrefte at
		// endringen faktisk er utført — det spores i stedet via oppfølgingspunktet.
		const removedDuringReview = data.subjects.filter((s) => s.markedForRemoval)
		const adjustedDuringReview = data.subjects.filter((s) => s.permissionAdjustmentRequested)
		const activeSubjects = data.subjects.filter(
			(s) => !s.isGone && !s.markedForRemoval && !s.permissionAdjustmentRequested,
		)
		const goneSubjects = data.subjects.filter((s) => s.isGone)

		doc.fontSize(16).fillColor(blue).text("Periodisk gjennomgang av tilganger – GitHub", { align: "left" })
		if (params.isDraft) {
			doc.moveDown(0.2)
			doc.fontSize(10).fillColor(red).text("UTKAST — gjennomgangen er ikke fullført ennå. Ikke gyldig revisjonsbevis.")
		}
		doc.moveDown(0.3)
		doc.fontSize(9).fillColor(gray)
		doc.text(`Repo: ${data.gitRepository}`)
		const participantsText =
			params.participants && params.participants.length > 0
				? params.participants.map((p) => formatUserDisplayName(p.userIdent, p.userName)).join(", ")
				: identLabel(params.performedBy)
		doc.text(`Godkjent av: ${participantsText}`)
		doc.text(`Dato: ${dateOnly(generatedAt)}`)
		doc.moveDown(0.6)

		doc.fontSize(10).fillColor(dark)
		doc.text(`Personer med tilgang gjennomgått: ${activeSubjects.length}`)
		doc.text(`Antall tilganger merket for fjerning i denne gjennomgangen: ${removedDuringReview.length}`)
		doc.text(`Antall tilgangsnivå merket for justering i denne gjennomgangen: ${adjustedDuringReview.length}`)
		doc.text(`Antall som har fått tilgangen fjernet siden forrige gjennomgang: ${goneSubjects.length}`)
		doc.moveDown(0.8)

		doc.fontSize(9).fillColor(gray)
		doc.text("Personer med tilgang er hentet automatisk fra GitHub (direkte tilgang og via team).")
		doc.moveDown(0.3)
		// Reflekterer tidspunktet for siste nattlige synkronisering av de underliggende Github-tabellene
		// (dataSyncedAt) — det gjøres ikke lenger noe ferskt GitHub-oppslag ved fullføring av aktiviteten.
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

/** Enkel tabell for "Personer med tilgang" og "Fjernet siden forrige gjennomgang" — ingen
 *  per-rad aktør/dato finnes lenger for disse to tabellene, kun Bruker/Tilgang/Tilgang via. */
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

/** Tabell for "merket for fjerning"/"merket for justering" — inkluderer hvem som merket
 *  beslutningen og datoen den ble gjort (dato-only, ikke tidspunkt). */
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

	/** Dato-only-felt (YYYY-MM-DD) vist med samme konvensjon som "Dato:"-linjen øverst i PDF-en. */
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
