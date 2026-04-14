import { matchPath } from "react-router"

// ─── Types ──────────────────────────────────────────────────────────────────

export interface Crumb {
	label: string
	to: string | null // null = current page (not clickable)
}

type LabelFn = (data: Record<string, unknown>, params: Record<string, string>) => string
type PathFn = (params: Record<string, string>) => string

interface BreadcrumbSegment {
	label: string | LabelFn
	to?: string | PathFn // omit for last segment (current page)
}

interface BreadcrumbRule {
	pattern: string
	segments: BreadcrumbSegment[]
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function sectionName(data: Record<string, unknown>): string {
	const section = data.section as { name?: string } | undefined
	if (section?.name) return section.name
	if (typeof data.seksjonName === "string") return data.seksjonName
	return String(data.seksjon ?? "Seksjon")
}

function sectionPath(params: Record<string, string>) {
	return `/seksjoner/${params.seksjon}`
}

function routinePath(params: Record<string, string>) {
	return `/seksjoner/${params.seksjon}/rutiner`
}

function routineDetailPath(params: Record<string, string>) {
	return `/seksjoner/${params.seksjon}/rutiner/${params.rutineId}`
}

function rulesetPath(params: Record<string, string>) {
	return `/seksjoner/${params.seksjon}/regelsett`
}

function rulesetDetailPath(params: Record<string, string>) {
	return `/seksjoner/${params.seksjon}/regelsett/${params.regelSettId}`
}

function teamPath(params: Record<string, string>) {
	return `/seksjoner/${params.seksjon}/team/${params.team}`
}

function teamAppPath(params: Record<string, string>) {
	return `/seksjoner/${params.seksjon}/team/${params.team}/applikasjoner/${params.appId}/detaljer`
}

function mineTeamAppPath(params: Record<string, string>) {
	return `/mine-team/applikasjoner/${params.appId}/detaljer`
}

function domainPath(params: Record<string, string>) {
	return `/kontrollrammeverk/${params.domene}`
}

function controlPath(params: Record<string, string>) {
	return `/kontrollrammeverk/${params.domene}/${params.kontrollId}`
}

function appPath(params: Record<string, string>) {
	return `/applikasjoner/${params.appId}/detaljer`
}

function routineName(data: Record<string, unknown>): string {
	const routine = data.routine as { name?: string } | undefined
	return routine?.name ?? "Rutine"
}

function rulesetName(data: Record<string, unknown>): string {
	const ruleset = data.ruleset as { name?: string } | undefined
	return ruleset?.name ?? "Regelsett"
}

function controlLabel(data: Record<string, unknown>): string {
	const control = data.control as { controlId?: string; name?: string } | undefined
	if (control?.controlId && control?.name) return `${control.controlId}: ${control.name}`
	return control?.controlId ?? "Kontroll"
}

function domainName(data: Record<string, unknown>): string {
	const domain = data.domain as { name?: string } | undefined
	if (domain?.name) return domain.name
	const controlDomains = data.controlDomains as Array<{ domainName?: string }> | undefined
	if (controlDomains?.[0]?.domainName) return controlDomains[0].domainName
	if (typeof data.domainName === "string") return data.domainName
	return String(data.domene ?? "Domene")
}

function appName(data: Record<string, unknown>): string {
	const app = data.app as { name?: string } | undefined
	if (app?.name) return app.name
	if (typeof data.appName === "string") return data.appName
	return "Applikasjon"
}

function teamName(data: Record<string, unknown>): string {
	if (typeof data.teamName === "string") return data.teamName
	const team = data.team as { name?: string } | undefined
	return team?.name ?? "Team"
}

function riskLabel(data: Record<string, unknown>): string {
	const risk = data.risk as { riskId?: string; name?: string } | undefined
	if (risk?.riskId && risk?.name) return `${risk.riskId}: ${risk.name}`
	return risk?.riskId ?? "Risiko"
}

function naisTeamName(data: Record<string, unknown>): string {
	const detail = data.detail as { team?: { displayName?: string; slug?: string } } | undefined
	return detail?.team?.displayName ?? detail?.team?.slug ?? "Team"
}

function reviewLabel(data: Record<string, unknown>): string {
	const review = data.review as { reviewedAt?: string } | undefined
	if (review?.reviewedAt) {
		return `Gjennomgang ${new Date(review.reviewedAt).toLocaleDateString("nb-NO")}`
	}
	return "Gjennomgang"
}

// ─── Breadcrumb Segments ────────────────────────────────────────────────────

const SEKSJONER: BreadcrumbSegment = { label: "Seksjoner", to: "/seksjoner" }
const KONTROLLRAMMEVERK: BreadcrumbSegment = { label: "Kontrollrammeverk", to: "/kontrollrammeverk" }
const MINE_TEAM: BreadcrumbSegment = { label: "Mine team", to: "/mine-team" }
const ADMIN: BreadcrumbSegment = { label: "Admin", to: "/admin" }

// ─── Rules (ordered most specific first) ────────────────────────────────────

const rules: BreadcrumbRule[] = [
	// ── Seksjoner: Gjennomganger ──
	{
		pattern: "seksjoner/:seksjon/rutiner/:rutineId/gjennomgang/:gjennomgangId",
		segments: [
			SEKSJONER,
			{ label: sectionName, to: sectionPath },
			{ label: "Rutiner", to: routinePath },
			{ label: routineName, to: routineDetailPath },
			{ label: reviewLabel },
		],
	},
	{
		pattern: "seksjoner/:seksjon/rutiner/:rutineId/gjennomgang/ny",
		segments: [
			SEKSJONER,
			{ label: sectionName, to: sectionPath },
			{ label: "Rutiner", to: routinePath },
			{ label: routineName, to: routineDetailPath },
			{ label: "Ny gjennomgang" },
		],
	},

	// ── Seksjoner: Rutiner ──
	{
		pattern: "seksjoner/:seksjon/rutiner/:rutineId/rediger",
		segments: [
			SEKSJONER,
			{ label: sectionName, to: sectionPath },
			{ label: "Rutiner", to: routinePath },
			{ label: routineName, to: routineDetailPath },
			{ label: "Rediger" },
		],
	},
	{
		pattern: "seksjoner/:seksjon/rutiner/:rutineId",
		segments: [
			SEKSJONER,
			{ label: sectionName, to: sectionPath },
			{ label: "Rutiner", to: routinePath },
			{ label: routineName },
		],
	},
	{
		pattern: "seksjoner/:seksjon/rutiner/mangler",
		segments: [
			SEKSJONER,
			{ label: sectionName, to: sectionPath },
			{ label: "Rutiner", to: routinePath },
			{ label: "Mangler" },
		],
	},
	{
		pattern: "seksjoner/:seksjon/rutiner/gjennomfort",
		segments: [
			SEKSJONER,
			{ label: sectionName, to: sectionPath },
			{ label: "Rutiner", to: routinePath },
			{ label: "Gjennomført" },
		],
	},
	{
		pattern: "seksjoner/:seksjon/rutiner/ny",
		segments: [
			SEKSJONER,
			{ label: sectionName, to: sectionPath },
			{ label: "Rutiner", to: routinePath },
			{ label: "Ny rutine" },
		],
	},
	{
		pattern: "seksjoner/:seksjon/rutiner",
		segments: [SEKSJONER, { label: sectionName, to: sectionPath }, { label: "Rutiner" }],
	},

	// ── Seksjoner: Regelsett ──
	{
		pattern: "seksjoner/:seksjon/regelsett/:regelSettId/rediger",
		segments: [
			SEKSJONER,
			{ label: sectionName, to: sectionPath },
			{ label: "Regelsett", to: rulesetPath },
			{ label: rulesetName, to: rulesetDetailPath },
			{ label: "Rediger" },
		],
	},
	{
		pattern: "seksjoner/:seksjon/regelsett/:regelSettId",
		segments: [
			SEKSJONER,
			{ label: sectionName, to: sectionPath },
			{ label: "Regelsett", to: rulesetPath },
			{ label: rulesetName },
		],
	},
	{
		pattern: "seksjoner/:seksjon/regelsett/ny",
		segments: [
			SEKSJONER,
			{ label: sectionName, to: sectionPath },
			{ label: "Regelsett", to: rulesetPath },
			{ label: "Nytt regelsett" },
		],
	},
	{
		pattern: "seksjoner/:seksjon/regelsett",
		segments: [SEKSJONER, { label: sectionName, to: sectionPath }, { label: "Regelsett" }],
	},

	// ── Seksjoner: Team → Applikasjoner (kontekstuell navigasjon) ──
	{
		pattern: "seksjoner/:seksjon/team/:team/applikasjoner/:appId/compliance-krav",
		segments: [
			SEKSJONER,
			{ label: sectionName, to: sectionPath },
			{ label: teamName, to: teamPath },
			{ label: appName, to: teamAppPath },
			{ label: "Kravgjennomgang" },
		],
	},
	{
		pattern: "seksjoner/:seksjon/team/:team/applikasjoner/:appId/compliance",
		segments: [
			SEKSJONER,
			{ label: sectionName, to: sectionPath },
			{ label: teamName, to: teamPath },
			{ label: appName, to: teamAppPath },
			{ label: "Compliance" },
		],
	},
	{
		pattern: "seksjoner/:seksjon/team/:team/applikasjoner/:appId/rediger",
		segments: [
			SEKSJONER,
			{ label: sectionName, to: sectionPath },
			{ label: teamName, to: teamPath },
			{ label: appName, to: teamAppPath },
			{ label: "Administrer" },
		],
	},
	{
		pattern: "seksjoner/:seksjon/team/:team/applikasjoner/:appId/detaljer",
		segments: [
			SEKSJONER,
			{ label: sectionName, to: sectionPath },
			{ label: teamName, to: teamPath },
			{ label: appName },
		],
	},

	// ── Seksjoner: Team ──
	{
		pattern: "seksjoner/:seksjon/team/:team/rediger",
		segments: [
			SEKSJONER,
			{ label: sectionName, to: sectionPath },
			{ label: teamName, to: (p) => `/seksjoner/${p.seksjon}/team/${p.team}` },
			{ label: "Rediger" },
		],
	},
	{
		pattern: "seksjoner/:seksjon/team/:team",
		segments: [SEKSJONER, { label: sectionName, to: sectionPath }, { label: teamName }],
	},

	// ── Seksjoner: Screening ──
	{
		pattern: "seksjoner/:seksjon/screening/:questionId/rediger",
		segments: [
			SEKSJONER,
			{ label: sectionName, to: sectionPath },
			{ label: "Screening", to: (p) => `/seksjoner/${p.seksjon}/screening` },
			{ label: "Rediger" },
		],
	},
	{
		pattern: "seksjoner/:seksjon/screening",
		segments: [SEKSJONER, { label: sectionName, to: sectionPath }, { label: "Screening" }],
	},

	// ── Seksjoner: Andre ──
	{
		pattern: "seksjoner/:seksjon/nais-team",
		segments: [SEKSJONER, { label: sectionName, to: sectionPath }, { label: "Nais-team" }],
	},
	{
		pattern: "seksjoner/:seksjon/audit-logging",
		segments: [SEKSJONER, { label: sectionName, to: sectionPath }, { label: "Audit logging" }],
	},
	{
		pattern: "seksjoner/:seksjon/rediger",
		segments: [SEKSJONER, { label: sectionName, to: sectionPath }, { label: "Rediger" }],
	},
	{
		pattern: "seksjoner/:seksjon",
		segments: [SEKSJONER, { label: sectionName }],
	},
	{
		pattern: "seksjoner",
		segments: [{ label: "Seksjoner" }],
	},

	// ── Kontrollrammeverk ──
	{
		pattern: "kontrollrammeverk/:domene/:kontrollId/rediger",
		segments: [
			KONTROLLRAMMEVERK,
			{ label: domainName, to: domainPath },
			{ label: controlLabel, to: controlPath },
			{ label: "Rediger" },
		],
	},
	{
		pattern: "kontrollrammeverk/:domene/:kontrollId",
		segments: [KONTROLLRAMMEVERK, { label: domainName, to: domainPath }, { label: controlLabel }],
	},
	{
		pattern: "kontrollrammeverk/risiko/:risikoId",
		segments: [KONTROLLRAMMEVERK, { label: riskLabel }],
	},
	{
		pattern: "kontrollrammeverk/:domene",
		segments: [KONTROLLRAMMEVERK, { label: domainName }],
	},
	{
		pattern: "kontrollrammeverk",
		segments: [{ label: "Kontrollrammeverk" }],
	},

	// ── Mine team → Applikasjoner (kontekstuell navigasjon) ──
	{
		pattern: "mine-team/applikasjoner/:appId/compliance-krav",
		segments: [MINE_TEAM, { label: appName, to: mineTeamAppPath }, { label: "Kravgjennomgang" }],
	},
	{
		pattern: "mine-team/applikasjoner/:appId/compliance",
		segments: [MINE_TEAM, { label: appName, to: mineTeamAppPath }, { label: "Compliance" }],
	},
	{
		pattern: "mine-team/applikasjoner/:appId/rediger",
		segments: [MINE_TEAM, { label: appName, to: mineTeamAppPath }, { label: "Administrer" }],
	},
	{
		pattern: "mine-team/applikasjoner/:appId/detaljer",
		segments: [MINE_TEAM, { label: appName }],
	},
	{
		pattern: "mine-team",
		segments: [{ label: "Mine team" }],
	},

	// ── Applikasjoner (direkte, uten kontekst) ──
	{
		pattern: "applikasjoner/:appId/compliance-krav",
		segments: [{ label: appName, to: appPath }, { label: "Kravgjennomgang" }],
	},
	{
		pattern: "applikasjoner/:appId/compliance",
		segments: [{ label: appName, to: appPath }, { label: "Compliance" }],
	},
	{
		pattern: "applikasjoner/:appId/rediger",
		segments: [{ label: appName, to: appPath }, { label: "Administrer" }],
	},
	{
		pattern: "applikasjoner/:appId/detaljer",
		segments: [{ label: appName }],
	},

	// ── Admin: Nais-overvåking ──
	{
		pattern: "admin/nais-overvaking/endringslogg",
		segments: [ADMIN, { label: "Nais-overvåking", to: "/admin/nais-overvaking" }, { label: "Endringslogg" }],
	},
	{
		pattern: "admin/nais-overvaking/:team",
		segments: [ADMIN, { label: "Nais-overvåking", to: "/admin/nais-overvaking" }, { label: naisTeamName }],
	},
	{
		pattern: "admin/nais-overvaking",
		segments: [ADMIN, { label: "Nais-overvåking" }],
	},

	// ── Admin ──
	{
		pattern: "admin/screening/:questionId/rediger",
		segments: [ADMIN, { label: "Screening", to: "/admin/screening" }, { label: "Rediger" }],
	},
	{ pattern: "admin/import", segments: [ADMIN, { label: "Import" }] },
	{ pattern: "admin/seksjoner", segments: [ADMIN, { label: "Seksjoner" }] },
	{ pattern: "admin/brukere", segments: [ADMIN, { label: "Brukere" }] },
	{ pattern: "admin/screening", segments: [ADMIN, { label: "Screening" }] },
	{ pattern: "admin/link-suggestions", segments: [ADMIN, { label: "Lenkeforslag" }] },
	{ pattern: "admin/domener", segments: [ADMIN, { label: "Domener" }] },
	{ pattern: "admin/teknologielementer", segments: [ADMIN, { label: "Teknologielementer" }] },
	{ pattern: "admin/dokumenter", segments: [ADMIN, { label: "Dokumenter" }] },
	{ pattern: "admin", segments: [{ label: "Admin" }] },

	// ── Andre ──
	{ pattern: "hjelp/markdown", segments: [{ label: "Hjelp", to: "/" }, { label: "Markdown" }] },
]

// ─── Build Breadcrumbs ──────────────────────────────────────────────────────

export function buildBreadcrumbs(
	pathname: string,
	loaderData: Record<string, unknown>,
	params: Record<string, string | undefined>,
): Crumb[] {
	if (pathname === "/") return []

	for (const rule of rules) {
		const match = matchPath({ path: rule.pattern, end: true }, pathname)
		if (!match) continue

		const merged: Record<string, string> = {}
		for (const [k, v] of Object.entries({ ...params, ...match.params })) {
			if (v != null) merged[k] = v
		}

		const crumbs: Crumb[] = []

		for (let i = 0; i < rule.segments.length; i++) {
			const seg = rule.segments[i]
			const label = typeof seg.label === "function" ? seg.label(loaderData, merged) : seg.label
			const isLast = i === rule.segments.length - 1

			if (isLast) {
				crumbs.push({ label, to: null })
			} else {
				const to = seg.to ? (typeof seg.to === "function" ? seg.to(merged) : seg.to) : null
				crumbs.push({ label, to })
			}
		}

		return crumbs
	}

	return []
}
