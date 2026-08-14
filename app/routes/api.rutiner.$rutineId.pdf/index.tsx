import { eq } from "drizzle-orm"
import PDFDocument from "pdfkit"
import { db } from "~/db/connection.server"
import { getRoutine, getRoutineNamesByIds } from "~/db/queries/routines.server"
import { getUserNamesByNavIdents } from "~/db/queries/users.server"
import {
	type DataClassification,
	dataClassificationLabels,
	type GroupAccessClassification,
	type GroupCriticality,
	groupAccessClassificationLabels,
	groupCriticalityLabels,
	type PersistenceType,
	persistenceTypeLabels,
} from "~/db/schema/applications"
import { sections } from "~/db/schema/organization"
import { activityTypeLabels } from "~/lib/activity-types"
import { requireAuthenticatedUser } from "~/lib/auth.server"
import { renderMarkdown } from "~/lib/markdown.server"
import { getCompositeFrequencyLabel } from "~/lib/routine-frequencies"
import { routinePriorityLabels } from "~/lib/routine-priorities"
import { sanitizeFilename } from "~/lib/sanitize-filename"
import { formatUserRef } from "~/lib/user-display"
import type { Route } from "./+types/index"

const blue = "#0067c5"
const darkText = "#222222"
const subtle = "#666666"

const routineStatusLabels: Record<string, string> = {
	draft: "Kladd",
	ready: "Ferdig",
	approved: "Godkjent",
	archived: "Arkivert",
}

const stepComponentLabels: Record<string, string> = {
	notater: "Notater",
	lenker: "Lenker",
	vedlegg: "Vedlegg",
}

export async function loader({ request, params, url }: Route.LoaderArgs) {
	await requireAuthenticatedUser(request)

	const rutineId = params.rutineId
	if (!rutineId) throw new Response("Mangler rutine-ID", { status: 400 })

	const routine = await getRoutine(rutineId)
	if (!routine) throw new Response("Rutine ikke funnet", { status: 404 })

	const [section] = await db.select().from(sections).where(eq(sections.id, routine.sectionId)).limit(1)
	if (!section) throw new Response("Seksjon ikke funnet", { status: 404 })

	const nameByNavIdent = await getUserNamesByNavIdents([
		...(routine.approvedBy ? [routine.approvedBy] : []),
		...(routine.archivedBy ? [routine.archivedBy] : []),
	])

	const lineageIds = [routine.sourceRoutineId, routine.replacedByRoutineId].filter(
		(id): id is string => id !== null && id !== undefined,
	)
	const lineageNames = await getRoutineNamesByIds(lineageIds)
	const predecessorInfo = routine.sourceRoutineId ? (lineageNames.get(routine.sourceRoutineId) ?? null) : null
	const successorInfo = routine.replacedByRoutineId ? (lineageNames.get(routine.replacedByRoutineId) ?? null) : null

	const effectiveRole = routine.responsibleRole || routine.controls.find((c) => c.responsible)?.responsible || null

	const pdfBuffer = await buildPdf(routine, section.name, nameByNavIdent, predecessorInfo, successorInfo, effectiveRole)

	const forceDownload = url.searchParams.get("download") === "true"
	const safeName = sanitizeFilename(routine.name, 150)
	const disposition = forceDownload ? `attachment; filename="${safeName}.pdf"` : `inline; filename="${safeName}.pdf"`

	return new Response(new Uint8Array(pdfBuffer), {
		headers: {
			"Content-Type": "application/pdf",
			"Content-Disposition": disposition,
		},
	})
}

/**
 * Converts sanitized HTML (as produced by renderMarkdown) to plain, readable text
 * so the PDF matches what's rendered on the routine page instead of raw Markdown syntax.
 */
function htmlToPlainText(html: string): string {
	let text = html
		.replace(/<li[^>]*>/gi, "• ")
		.replace(/<\/(p|li|h[1-6]|blockquote)>/gi, "\n")
		.replace(/<br\s*\/?>/gi, "\n")

	// Strip tags iteratively to safely handle malformed/nested markup.
	let previous: string
	do {
		previous = text
		text = text.replace(/<[^>]*>/g, "")
	} while (text !== previous)

	const entities: Record<string, string> = {
		"&nbsp;": " ",
		"&lt;": "<",
		"&gt;": ">",
		"&quot;": '"',
		"&#39;": "'",
		"&amp;": "&",
	}
	// Decode all entities in a single pass to avoid double-unescaping (e.g. "&amp;lt;" must not become "<").
	text = text.replace(/&(?:nbsp|lt|gt|quot|#39|amp);/g, (match) => entities[match])

	return text.replace(/\n{3,}/g, "\n\n").trim()
}

type RoutineData = NonNullable<Awaited<ReturnType<typeof getRoutine>>>

function buildPdf(
	routine: RoutineData,
	sectionName: string,
	nameByNavIdent: ReadonlyMap<string, string>,
	predecessorInfo: { name: string; status: string } | null,
	successorInfo: { name: string; status: string } | null,
	effectiveRole: string | null,
): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true })
		const chunks: Buffer[] = []

		doc.on("data", (chunk: Buffer) => chunks.push(chunk))
		doc.on("end", () => resolve(Buffer.concat(chunks)))
		doc.on("error", reject)

		// ─── Title ────────────────────────────────────────────────────
		doc.fontSize(20).fillColor(blue).text(routine.name, { align: "left" })
		doc.moveDown(0.2)

		doc.fontSize(9).fillColor(subtle)
		doc.text(`Seksjon: ${sectionName}`)
		doc.text(`Status: ${routineStatusLabels[routine.status] ?? routine.status}`)
		if (routine.archivedAt) doc.text(`Arkivert: ${new Date(routine.archivedAt).toLocaleString("nb-NO")}`)
		if (routine.isSectionRoutine === 1) doc.text("Type: Seksjonsrutine")
		doc.text(`Generert: ${new Date().toLocaleString("nb-NO")}`)
		doc.moveDown(1)

		if (routine.isSectionRoutine === 1) {
			doc
				.fontSize(10)
				.fillColor(darkText)
				.text(`Eier / Utførende rolle: ${routine.sectionRoutineOwnerRole ?? "Ikke satt"}`)
			doc
				.fontSize(9)
				.fillColor(subtle)
				.text("Denne rutinen gjennomgås på seksjonsnivå og gjelder alle applikasjoner i seksjonen.")
			doc.moveDown(0.8)
		}

		const descriptionText = routine.description ? htmlToPlainText(renderMarkdown(routine.description)) : ""
		if (descriptionText) {
			doc.fontSize(11).fillColor(blue).text("Beskrivelse")
			doc.moveDown(0.2)
			doc.fontSize(10).fillColor(darkText).text(descriptionText, { width: 495 })
			doc.moveDown(1)
		}

		// ─── Konfigurasjon ──────────────────────────────────────────────
		doc.fontSize(13).fillColor(blue).text("Konfigurasjon")
		doc.moveDown(0.4)

		doc.fontSize(9).fillColor(subtle).text("Frekvens")
		doc.fontSize(10).fillColor(darkText).text(getCompositeFrequencyLabel(routine.frequency, routine.eventFrequency))
		doc.moveDown(0.5)

		doc.fontSize(9).fillColor(subtle).text("Prioritet")
		doc
			.fontSize(10)
			.fillColor(darkText)
			.text(routinePriorityLabels[routine.priority as 1 | 2 | 3] ?? "Ukjent")
		doc.moveDown(0.5)

		if (effectiveRole) {
			doc.fontSize(9).fillColor(subtle).text("Ansvarlig rolle")
			doc
				.fontSize(10)
				.fillColor(darkText)
				.text(`${effectiveRole}${routine.responsibleRole ? "" : " (arvet fra krav)"}`)
			doc.moveDown(0.5)
		}

		if (routine.appliesToAllInSection === 1 || routine.isSectionRoutine === 1) {
			const scopeTags = [
				...(routine.isSectionRoutine === 1 ? ["Seksjonsrutine"] : []),
				...(routine.appliesToAllInSection === 1 ? ["Gjelder alle applikasjoner i seksjonen"] : []),
			]
			doc.fontSize(9).fillColor(subtle).text("Scope")
			doc.fontSize(10).fillColor(darkText).text(scopeTags.join(", "))
			doc.moveDown(0.5)
		}

		if (routine.technologyElements.length > 0) {
			doc.fontSize(9).fillColor(subtle).text("Teknologielementer")
			doc
				.fontSize(10)
				.fillColor(darkText)
				.text(routine.technologyElements.map((te) => te.name).join(", "))
			doc.moveDown(0.5)
		}

		if (routine.controls.length > 0) {
			doc.fontSize(9).fillColor(subtle).text("Tilknyttede krav")
			doc
				.fontSize(10)
				.fillColor(darkText)
				.text(routine.controls.map((ctrl) => `${ctrl.controlId} – ${ctrl.name}`).join(", "))
			doc.moveDown(0.5)
		}

		if (routine.persistenceLinks.length > 0) {
			doc.fontSize(9).fillColor(subtle).text("Database og klassifisering")
			const lines = routine.persistenceLinks.map((pl) => {
				const type = pl.persistenceType
					? (persistenceTypeLabels[pl.persistenceType as PersistenceType] ?? pl.persistenceType)
					: null
				const classification = pl.dataClassification
					? (dataClassificationLabels[pl.dataClassification as DataClassification] ?? pl.dataClassification)
					: null
				return [type, classification].filter(Boolean).join(" / ")
			})
			doc.fontSize(10).fillColor(darkText).text(lines.join("; "))
			doc.moveDown(0.5)
		}

		if (routine.oracleRoleCriticalities.length > 0) {
			doc.fontSize(9).fillColor(subtle).text("Kritikalitet for Oracle-roller")
			doc
				.fontSize(10)
				.fillColor(darkText)
				.text(
					routine.oracleRoleCriticalities
						.map((orc) => groupCriticalityLabels[orc.criticality as GroupCriticality] ?? orc.criticality)
						.join(", "),
				)
			doc.moveDown(0.5)
		}

		if (routine.groupClassifications.length > 0) {
			doc.fontSize(9).fillColor(subtle).text("Tilgangsklassifisering for Entra ID-grupper")
			doc
				.fontSize(10)
				.fillColor(darkText)
				.text(
					routine.groupClassifications
						.map(
							(gc) =>
								groupAccessClassificationLabels[gc.classification as GroupAccessClassification] ?? gc.classification,
						)
						.join(", "),
				)
			doc.moveDown(0.5)
		}

		const activityTypes = [...new Set(routine.activityTypes)]
		if (activityTypes.length > 0) {
			doc.fontSize(9).fillColor(subtle).text("Vedlikeholdsaktiviteter")
			doc
				.fontSize(10)
				.fillColor(darkText)
				.text(activityTypes.map((type) => activityTypeLabels[type] ?? type).join(", "))
			doc.moveDown(0.5)
		}

		const manualActivities = routine.activityItems.filter((i) => i.type === "manual_activity")
		if (manualActivities.length > 0) {
			doc.fontSize(9).fillColor(subtle).text("Manuelle aktiviteter")
			doc.moveDown(0.2)
			manualActivities.forEach((item, idx) => {
				doc
					.fontSize(10)
					.fillColor(darkText)
					.text(item.stepTitle ?? `Manuell aktivitet ${idx + 1}`)
				if (item.stepDescription) {
					doc.fontSize(9).fillColor(subtle).text(item.stepDescription, { width: 495 })
				}
				if (item.stepComponents && item.stepComponents.length > 0) {
					doc
						.fontSize(9)
						.fillColor(subtle)
						.text(`Komponenter: ${item.stepComponents.map((c) => stepComponentLabels[c.type] ?? c.type).join(", ")}`)
				}
				doc.moveDown(0.3)
			})
		}

		// ─── Godkjenning ────────────────────────────────────────────────
		if (routine.status === "approved" && routine.approvedBy) {
			doc.moveDown(0.5)
			doc.fontSize(9).fillColor(subtle).text("Godkjenning")
			let approvalText = `Godkjent av ${formatUserRef(routine.approvedBy, nameByNavIdent)}`
			if (routine.approvedAt) approvalText += ` den ${new Date(routine.approvedAt).toLocaleString("nb-NO")}`
			doc.fontSize(10).fillColor(darkText).text(approvalText)
		}

		// ─── Opphav / erstattet av ────────────────────────────────────────
		if (routine.sourceRoutineId) {
			doc.moveDown(0.5)
			doc.fontSize(9).fillColor(subtle).text("Opphav")
			doc
				.fontSize(10)
				.fillColor(darkText)
				.text(predecessorInfo?.name ?? "Opprinnelig rutine")
		}

		if (routine.replacedByRoutineId) {
			doc.moveDown(0.5)
			doc.fontSize(9).fillColor(subtle).text("Erstattet av")
			doc
				.fontSize(10)
				.fillColor(darkText)
				.text(successorInfo?.name ?? "Erstattende rutine")
		}

		doc.end()
	})
}
