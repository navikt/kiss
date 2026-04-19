import { persistenceTypeLabels } from "~/db/schema/applications"

export const persistenceLabels = persistenceTypeLabels as Record<string, string>

export const persistenceVariants: Record<
	string,
	"info" | "success" | "warning" | "error" | "neutral" | "alt1" | "alt2" | "alt3"
> = {
	cloud_sql_postgres: "info",
	nais_postgres: "info",
	on_prem_postgres: "warning",
	opensearch: "alt1",
	bucket: "alt2",
	valkey: "alt3",
	oracle: "warning",
	other: "neutral",
}

export const authLabels: Record<string, string> = {
	entra_id: "Entra ID",
	token_x: "TokenX",
	id_porten: "ID-porten",
	maskinporten: "Maskinporten",
}

export const conclusionConfig: Record<string, { label: string; variant: "success" | "warning" | "error" | "neutral" }> =
	{
		FULLSTENDIG: { label: "Fullstendig", variant: "success" },
		MANGELFULL: { label: "Mangelfull", variant: "warning" },
		AV: { label: "Av", variant: "error" },
		UKJENT: { label: "Ukjent", variant: "neutral" },
	}

export const findingSeverityVariant: Record<string, "error" | "warning" | "info"> = {
	KRITISK: "error",
	ADVARSEL: "warning",
	INFO: "info",
}

export const criticalityTagVariant: Record<string, "success" | "warning" | "neutral" | "error"> = {
	low: "success",
	medium: "warning",
	high: "warning",
	very_high: "error",
}

export const criticalityTagColor: Record<string, string> = {
	high: "var(--ax-bg-warning-moderate)",
}

export interface AccessPolicyRule {
	id: string
	direction: string
	ruleApplication: string
	ruleNamespace: string | null
	ruleCluster: string | null
}

export interface TrafficRow {
	appName: string
	namespace: string
	cluster: string
	count: number
}

export function parseTrafficCsv(text: string): TrafficRow[] {
	const lines = text.trim().split(/\r?\n/)
	if (lines.length < 2) return []

	return lines.slice(1).flatMap((line) => {
		const trimmed = line.trim()
		if (!trimmed) return []
		const match = trimmed.match(/^"([^"]+)"[,;]"?([^"]*)"?$/)
		if (!match) return []
		const parts = match[1].split(":")
		if (parts.length !== 3) return []
		const countStr = match[2].replace(/,/g, "")
		const count = Number.parseInt(countStr, 10)
		if (Number.isNaN(count)) return []
		return [{ cluster: parts[0], namespace: parts[1], appName: parts[2], count }]
	})
}

export const statusSortOrder: Record<string, number> = {
	monitored: 0,
	discovered: 1,
	acknowledged: 2,
	unknown: 3,
}

export function getStatusKey(
	resolution: { status: string; appId?: string } | undefined,
	ack: { comment: string; acknowledgedBy: string; acknowledgedAt: string } | undefined,
): string {
	if (resolution?.status === "monitored") return "monitored"
	if (resolution?.status === "discovered") return "discovered"
	if (ack) return "acknowledged"
	return "unknown"
}

export type UnifiedGroup = {
	groupId: string
	source: "nais" | "manual" | "removed"
	manualGroupDbId?: string
	createdBy?: string
}

export function createControlLink(sectionSlug: string | null, domainCode: string, controlId: string): string {
	if (sectionSlug) {
		return `/seksjoner/${sectionSlug}/kontrollrammeverk/${domainCode}/${controlId}`
	}
	return `/kontrollrammeverk/${domainCode}/${controlId}`
}
