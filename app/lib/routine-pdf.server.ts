import type PDFDocument from "pdfkit"
import type { getRoutine, getRoutineNamesByIds } from "~/db/queries/routines.server"
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
import { activityTypeLabels } from "~/lib/activity-types"
import { renderMarkdownToPdf } from "~/lib/markdown-pdf.server"
import { getCompositeFrequencyLabel } from "~/lib/routine-frequencies"
import { routinePriorityLabels } from "~/lib/routine-priorities"
import { formatUserRef } from "~/lib/user-display"

export const routineStatusLabels: Record<string, string> = {
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

export interface RoutinePdfColors {
	blue: string
	dark: string
	gray: string
}

export type RoutinePdfData = NonNullable<Awaited<ReturnType<typeof getRoutine>>>

export interface RoutineLineageInfo {
	name: string
	status: string
}

/**
 * Delt av den frittstående rutine-PDF-en (`/api/rutiner/:id/pdf`) og rutine-seksjonen i
 * seksjons- og app-compliance-rapporter (`reports.server.ts`), slik at feltsettet er identisk
 * uansett hvor rutinen vises. Kaller er ansvarlig for tittel/overskrift siden størrelsen varierer.
 */
export function renderRoutineSection(
	doc: InstanceType<typeof PDFDocument>,
	colors: RoutinePdfColors,
	routine: RoutinePdfData,
	nameByNavIdent: ReadonlyMap<string, string>,
	options: {
		sectionName?: string
		predecessorInfo?: RoutineLineageInfo | null
		successorInfo?: RoutineLineageInfo | null
		effectiveRole?: string | null
		/** Vis "Generert: <nå>"-linje. Slås av når rutine-seksjonen inngår i en større rapport. */
		showGeneratedAt?: boolean
		/** Vis beskrivelsen. Slås av når brukeren har valgt bort rutinebeskrivelse i rapportgenereringen. */
		includeDescription?: boolean
	} = {},
) {
	const { blue, dark, gray } = colors
	const { sectionName, predecessorInfo, successorInfo, showGeneratedAt = false, includeDescription = true } = options
	const effectiveRole =
		options.effectiveRole !== undefined
			? options.effectiveRole
			: routine.responsibleRole || routine.controls.find((c) => c.responsible)?.responsible || null

	doc.fontSize(9).fillColor(gray)
	if (sectionName) doc.text(`Seksjon: ${sectionName}`)
	doc.text(`Status: ${routineStatusLabels[routine.status] ?? routine.status}`)
	if (routine.archivedAt) doc.text(`Arkivert: ${new Date(routine.archivedAt).toLocaleString("nb-NO")}`)
	if (routine.isSectionRoutine === 1) doc.text("Type: Seksjonsrutine")
	if (showGeneratedAt) doc.text(`Generert: ${new Date().toLocaleString("nb-NO")}`)
	doc.moveDown(1)

	if (routine.isSectionRoutine === 1) {
		doc
			.fontSize(10)
			.fillColor(dark)
			.text(`Eier / Utførende rolle: ${routine.sectionRoutineOwnerRole ?? "Ikke satt"}`)
		doc
			.fontSize(9)
			.fillColor(gray)
			.text("Denne rutinen gjennomgås på seksjonsnivå og gjelder alle applikasjoner i seksjonen.")
		doc.moveDown(0.8)
	}

	if (includeDescription && routine.description) {
		doc.fontSize(11).fillColor(blue).text("Beskrivelse")
		doc.moveDown(0.2)
		doc.fontSize(10).fillColor(dark)
		renderMarkdownToPdf(doc, routine.description, { width: 495 })
		doc.moveDown(1)
	}

	doc.fontSize(13).fillColor(blue).text("Konfigurasjon")
	doc.moveDown(0.4)

	doc.fontSize(9).fillColor(gray).text("Frekvens")
	doc.fontSize(10).fillColor(dark).text(getCompositeFrequencyLabel(routine.frequency, routine.eventFrequency))
	doc.moveDown(0.5)

	doc.fontSize(9).fillColor(gray).text("Prioritet")
	doc
		.fontSize(10)
		.fillColor(dark)
		.text(routinePriorityLabels[routine.priority as 1 | 2 | 3] ?? "Ukjent")
	doc.moveDown(0.5)

	if (effectiveRole) {
		doc.fontSize(9).fillColor(gray).text("Ansvarlig rolle")
		doc
			.fontSize(10)
			.fillColor(dark)
			.text(`${effectiveRole}${routine.responsibleRole ? "" : " (arvet fra krav)"}`)
		doc.moveDown(0.5)
	}

	if (routine.appliesToAllInSection === 1 || routine.isSectionRoutine === 1) {
		const scopeTags = [
			...(routine.isSectionRoutine === 1 ? ["Seksjonsrutine"] : []),
			...(routine.appliesToAllInSection === 1 ? ["Gjelder alle applikasjoner i seksjonen"] : []),
		]
		doc.fontSize(9).fillColor(gray).text("Scope")
		doc.fontSize(10).fillColor(dark).text(scopeTags.join(", "))
		doc.moveDown(0.5)
	}

	if (routine.technologyElements.length > 0) {
		doc.fontSize(9).fillColor(gray).text("Teknologielementer")
		doc
			.fontSize(10)
			.fillColor(dark)
			.text(routine.technologyElements.map((te) => te.name).join(", "))
		doc.moveDown(0.5)
	}

	if (routine.controls.length > 0) {
		doc.fontSize(9).fillColor(gray).text("Tilknyttede krav")
		doc
			.fontSize(10)
			.fillColor(dark)
			.text(routine.controls.map((ctrl) => `${ctrl.controlId} – ${ctrl.name}`).join(", "))
		doc.moveDown(0.5)
	}

	if (routine.persistenceLinks.length > 0) {
		doc.fontSize(9).fillColor(gray).text("Database og klassifisering")
		const lines = routine.persistenceLinks.map((pl) => {
			const type = pl.persistenceType
				? (persistenceTypeLabels[pl.persistenceType as PersistenceType] ?? pl.persistenceType)
				: null
			const classification = pl.dataClassification
				? (dataClassificationLabels[pl.dataClassification as DataClassification] ?? pl.dataClassification)
				: null
			return [type, classification].filter(Boolean).join(" / ")
		})
		doc.fontSize(10).fillColor(dark).text(lines.join("; "))
		doc.moveDown(0.5)
	}

	if (routine.oracleRoleCriticalities.length > 0) {
		doc.fontSize(9).fillColor(gray).text("Kritikalitet for Oracle-roller")
		doc
			.fontSize(10)
			.fillColor(dark)
			.text(
				routine.oracleRoleCriticalities
					.map((orc) => groupCriticalityLabels[orc.criticality as GroupCriticality] ?? orc.criticality)
					.join(", "),
			)
		doc.moveDown(0.5)
	}

	if (routine.groupClassifications.length > 0) {
		doc.fontSize(9).fillColor(gray).text("Tilgangsklassifisering for Entra ID-grupper")
		doc
			.fontSize(10)
			.fillColor(dark)
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
		doc.fontSize(9).fillColor(gray).text("Vedlikeholdsaktiviteter")
		doc
			.fontSize(10)
			.fillColor(dark)
			.text(activityTypes.map((type) => activityTypeLabels[type] ?? type).join(", "))
		doc.moveDown(0.5)
	}

	const manualActivities = routine.activityItems.filter((i) => i.type === "manual_activity")
	if (manualActivities.length > 0) {
		doc.fontSize(9).fillColor(gray).text("Manuelle aktiviteter")
		doc.moveDown(0.2)
		manualActivities.forEach((item, idx) => {
			doc
				.fontSize(10)
				.fillColor(dark)
				.text(item.stepTitle ?? `Manuell aktivitet ${idx + 1}`)
			if (item.stepDescription) {
				doc.fontSize(9).fillColor(gray).text(item.stepDescription, { width: 495 })
			}
			if (item.stepComponents && item.stepComponents.length > 0) {
				doc
					.fontSize(9)
					.fillColor(gray)
					.text(`Komponenter: ${item.stepComponents.map((c) => stepComponentLabels[c.type] ?? c.type).join(", ")}`)
			}
			doc.moveDown(0.3)
		})
	}

	if (routine.status === "approved" && routine.approvedBy) {
		doc.moveDown(0.5)
		doc.fontSize(9).fillColor(gray).text("Godkjenning")
		let approvalText = `Godkjent av ${formatUserRef(routine.approvedBy, nameByNavIdent)}`
		if (routine.approvedAt) approvalText += ` den ${new Date(routine.approvedAt).toLocaleString("nb-NO")}`
		doc.fontSize(10).fillColor(dark).text(approvalText)
	}

	if (routine.sourceRoutineId) {
		doc.moveDown(0.5)
		doc.fontSize(9).fillColor(gray).text("Opphav")
		doc
			.fontSize(10)
			.fillColor(dark)
			.text(predecessorInfo?.name ?? "Opprinnelig rutine")
	}

	if (routine.replacedByRoutineId) {
		doc.moveDown(0.5)
		doc.fontSize(9).fillColor(gray).text("Erstattet av")
		doc
			.fontSize(10)
			.fillColor(dark)
			.text(successorInfo?.name ?? "Erstattende rutine")
	}
}

export async function getRoutineLineageInfo(
	routine: Pick<RoutinePdfData, "sourceRoutineId" | "replacedByRoutineId">,
	getRoutineNamesByIdsFn: typeof getRoutineNamesByIds,
): Promise<{ predecessorInfo: RoutineLineageInfo | null; successorInfo: RoutineLineageInfo | null }> {
	const lineageIds = [routine.sourceRoutineId, routine.replacedByRoutineId].filter(
		(id): id is string => id !== null && id !== undefined,
	)
	const lineageNames = await getRoutineNamesByIdsFn(lineageIds)
	return {
		predecessorInfo: routine.sourceRoutineId ? (lineageNames.get(routine.sourceRoutineId) ?? null) : null,
		successorInfo: routine.replacedByRoutineId ? (lineageNames.get(routine.replacedByRoutineId) ?? null) : null,
	}
}
