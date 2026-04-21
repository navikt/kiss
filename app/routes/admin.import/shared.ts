import type { FileRejectionReason } from "@navikt/ds-react"
import type { computeImportDiff } from "~/db/queries/framework.server"
import { cronFrequencyLabels } from "~/lib/frequency-mapping"

export interface SerializedControl {
	controlId: string
	domain: string
	riskId: string
	riskDescription: string | null
	technologyElement: string | null
	requirement: string | null
	responsible: string | null
	routine: string | null
	frequency: string | null
	documentationRequirement: string | null
	testProcedure: string | null
	dependencies: string | null
	references: string | null
	commonPitfalls: string | null
}

export interface SerializedSummary {
	domainCount: number
	riskCount: number
	controlCount: number
	fileName: string
	uploadedAt: string
	uploadedBy: string
	controls: SerializedControl[]
}

export type StagingDiff = Awaited<ReturnType<typeof computeImportDiff>>

export type ActionResult =
	| { success: true; summary: SerializedSummary; versionId: string; stagingDiff: StagingDiff }
	| { success: false; error: string }
	| { activated: true }
	| { discarded: true }

export const MAX_SIZE_MB = 10
export const MAX_SIZE = MAX_SIZE_MB * 1024 * 1024

export const rejectionErrors: Record<FileRejectionReason, string> = {
	fileType: "Filformatet støttes ikke. Last opp en .xlsx-fil.",
	fileSize: `Filen er større enn ${MAX_SIZE_MB} MB.`,
}

const actionLabels: Record<string, string> = {
	framework_imported: "Kontrollrammeverk importert",
	framework_activated: "Kontrollrammeverk aktivert",
	framework_archived: "Kontrollrammeverk arkivert",
	risk_short_title_updated: "Risiko-tittel endret",
	control_short_title_updated: "Kontroll-tittel endret",
}

export function formatAction(action: string): string {
	return actionLabels[action] ?? action
}

export const diffFieldLabels: Record<string, string> = {
	description: "Beskrivelse",
	technologyElement: "Teknologielement",
	requirement: "Krav",
	responsible: "Ansvarlig",
	routine: "Rutine",
	frequency: "Frekvens",
	cronFrequency: "Kronologisk frekvens",
	documentationRequirement: "Dokumentasjonskrav",
	testProcedure: "Testprosedyre",
	dependencies: "Avhengigheter",
	references: "Referanser",
	commonPitfalls: "Vanlige fallgruver",
}

export function truncateValue(value: string | null, maxLength = 80): string {
	if (!value) return "(tom)"
	return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value
}

export function resolveDiffValue(field: string, value: string | null): string | null {
	if (field === "cronFrequency" && value) {
		return cronFrequencyLabels[value] ?? value
	}
	return value
}

export function formatDetails(entry: {
	action: string
	entityId: string
	previousValue: string | null
	newValue: string | null
}): string {
	if (entry.action === "risk_short_title_updated" || entry.action === "control_short_title_updated") {
		const prev = entry.previousValue ?? "(tom)"
		const next = entry.newValue ?? "(tom)"
		return `${entry.entityId}: «${prev}» → «${next}»`
	}
	if (entry.action === "framework_imported") {
		return entry.newValue ?? entry.entityId
	}
	if (entry.action === "framework_activated" || entry.action === "framework_archived") {
		return entry.newValue ?? entry.previousValue ?? entry.entityId
	}
	return entry.entityId
}

export const allColumns = [
	{ key: "domain", label: "Domene" },
	{ key: "riskId", label: "Risiko-ID" },
	{ key: "riskDescription", label: "Risiko" },
	{ key: "controlId", label: "Kontroll-ID" },
	{ key: "technologyElement", label: "Teknologielement" },
	{ key: "requirement", label: "Krav" },
	{ key: "responsible", label: "Ansvarlig" },
	{ key: "routine", label: "Rutine" },
	{ key: "frequency", label: "Frekvens" },
	{ key: "documentationRequirement", label: "Dokumentasjonskrav" },
	{ key: "testProcedure", label: "Testprosedyre" },
	{ key: "dependencies", label: "Avhengigheter" },
	{ key: "references", label: "Referanser" },
	{ key: "commonPitfalls", label: "Vanlige fallgruver" },
] satisfies Array<{ key: keyof SerializedControl; label: string }>

export const basicColumnKeys = new Set<keyof SerializedControl>([
	"domain",
	"riskId",
	"controlId",
	"requirement",
	"responsible",
	"frequency",
])
