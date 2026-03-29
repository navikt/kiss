/**
 * Shared mock data for placeholder domain/risk/control hierarchy.
 * Will be replaced with database queries.
 */

export interface MockControl {
	id: string
	name: string
}

export interface MockRisk {
	id: string
	name: string
	controls: MockControl[]
}

export interface MockDomain {
	code: string
	name: string
	risks: MockRisk[]
}

export const mockDomains: Record<string, MockDomain> = {
	ST: {
		code: "ST",
		name: "Styring",
		risks: [
			{
				id: "R-ST.01",
				name: "Mangelfull styring av IT-sikkerhet og kontrollmiljø",
				controls: [{ id: "K-ST.01", name: "Etablert sikkerhetspolicy og styringsrammeverk" }],
			},
			{
				id: "R-ST.02",
				name: "Mangelfull risikovurdering og oppfølging",
				controls: [{ id: "K-ST.02", name: "Periodisk risikovurdering og oppfølging" }],
			},
		],
	},
	TS: {
		code: "TS",
		name: "Tilgangsstyring",
		risks: [
			{
				id: "R-TS.01",
				name: "Uautorisert tilgang til systemer og data",
				controls: [
					{ id: "K-TS.01", name: "Tilgangspolicy og rollebasert tilgangskontroll" },
					{ id: "K-TS.02", name: "Brukeropprettelse og godkjenning" },
					{ id: "K-TS.03", name: "Periodisk gjennomgang av tilganger" },
					{ id: "K-TS.04", name: "Fjerning av tilganger ved endring/avslutning" },
					{ id: "K-TS.05", name: "Privilegert tilgangsstyring" },
					{ id: "K-TS.06", name: "Autentiseringsmekanismer og flerfaktorautentisering" },
				],
			},
			{
				id: "R-TS.02",
				name: "Uautorisert tilgang til infrastruktur og nettverk",
				controls: [
					{ id: "K-TS.07", name: "Nettverkssegmentering og brannmurregler" },
					{ id: "K-TS.08", name: "Logging og overvåking av tilganger" },
					{ id: "K-TS.09", name: "Sikker fjerntilgang (VPN/Zero Trust)" },
					{ id: "K-TS.10", name: "Tjenestekonto- og API-nøkkelhåndtering" },
					{ id: "K-TS.11", name: "Fysisk tilgangskontroll til datasentre" },
				],
			},
		],
	},
	EH: {
		code: "EH",
		name: "Endringshåndtering",
		risks: [
			{
				id: "R-EH.01",
				name: "Uautoriserte eller feilaktige endringer i produksjonsmiljø",
				controls: [
					{ id: "K-EH.01", name: "Formell endringshåndteringsprosess" },
					{ id: "K-EH.02", name: "Segregering av utviklings-, test- og produksjonsmiljø" },
					{ id: "K-EH.03", name: "Kodegjennomgang og godkjenning før produksjonssetting" },
					{ id: "K-EH.04", name: "Automatisert bygg- og distribusjonspipeline" },
					{ id: "K-EH.05", name: "Nødendringsprosedyre" },
				],
			},
		],
	},
	DR: {
		code: "DR",
		name: "Drift",
		risks: [
			{
				id: "R-TI.01",
				name: "Tap av data eller manglende gjenoppretting",
				controls: [{ id: "K-DR.01", name: "Sikkerhetskopiering og gjenopprettingstesting" }],
			},
			{
				id: "R-TI.02",
				name: "Nedetid og manglende tilgjengelighet",
				controls: [{ id: "K-DR.02", name: "Overvåking, varsling og hendelseshåndtering" }],
			},
			{
				id: "R-TI.03",
				name: "Sikkerhetshendelser og datainnbrudd",
				controls: [
					{ id: "K-DR.03", name: "Sårbarhetshåndtering og patching" },
					{ id: "K-DR.04", name: "Sikkerhetslogging og hendelsesrespons" },
				],
			},
			{
				id: "R-DR.04",
				name: "Manglende driftskontinuitet",
				controls: [
					{ id: "K-DR.05", name: "Kapasitetsstyring og ytelsesovervåking" },
					{ id: "K-DR.06", name: "Kontinuitetsplan og katastrofegjenoppretting" },
				],
			},
		],
	},
}

export interface MockControlDetail {
	id: string
	name: string
	teknologielement: string
	krav: string
	ansvarlig: string
	rutine: string
	frekvens: string
	dokumentasjonskrav: string
	testprosedyre: string
	avhengigheter: string
	referanser: string
	vanligeFallgruver: string
}

export const mockControlDetails: Record<string, MockControlDetail> = {
	"K-ST.01": {
		id: "K-ST.01",
		name: "Etablert sikkerhetspolicy og styringsrammeverk",
		teknologielement: "Styringsverktøy, dokumenthåndteringssystem",
		krav: "Organisasjonen skal ha en dokumentert og godkjent IT-sikkerhetspolicy",
		ansvarlig: "CISO / IT-sikkerhetsansvarlig",
		rutine: "Årlig gjennomgang og oppdatering av sikkerhetspolicy",
		frekvens: "Årlig",
		dokumentasjonskrav: "Godkjent sikkerhetspolicy, møtereferat fra ledelsesgjennomgang",
		testprosedyre: "Verifiser at policy er oppdatert og godkjent av ledelsen",
		avhengigheter: "Ingen",
		referanser: "ISO 27001 A.5, NIST CSF GV.PO",
		vanligeFallgruver: "Policy som ikke er forankret i ledelsen eller som ikke oppdateres jevnlig",
	},
	"K-ST.02": {
		id: "K-ST.02",
		name: "Periodisk risikovurdering og oppfølging",
		teknologielement: "Risikostyringsverktøy",
		krav: "Det skal gjennomføres periodiske risikovurderinger av IT-miljøet",
		ansvarlig: "CISO / Risikoeier",
		rutine: "Gjennomføring av risikovurdering med oppfølging av tiltak",
		frekvens: "Årlig, eller ved vesentlige endringer",
		dokumentasjonskrav: "Risikovurderingsrapport, tiltaksplan, oppfølgingslogg",
		testprosedyre: "Gjennomgå at risikovurdering er utført og tiltak er fulgt opp",
		avhengigheter: "K-ST.01",
		referanser: "ISO 27001 A.8, NIST CSF ID.RA",
		vanligeFallgruver: "Risikovurderinger som ikke følges opp med konkrete tiltak",
	},
}

const defaultControlDetail: Omit<MockControlDetail, "id" | "name"> = {
	teknologielement: "Ikke spesifisert",
	krav: "Ikke spesifisert",
	ansvarlig: "Ikke tildelt",
	rutine: "Ikke definert",
	frekvens: "Ikke definert",
	dokumentasjonskrav: "Ikke spesifisert",
	testprosedyre: "Ikke definert",
	avhengigheter: "Ingen kjente",
	referanser: "Ikke spesifisert",
	vanligeFallgruver: "Ikke dokumentert",
}

export function getControlDetail(kontrollId: string): MockControlDetail {
	return (
		mockControlDetails[kontrollId] ?? {
			...defaultControlDetail,
			id: kontrollId,
			name: `Kontroll ${kontrollId}`,
		}
	)
}

/** Get domain summaries derived from the mock hierarchy */
export function getDomainSummaries(): Array<{ code: string; name: string; riskCount: number; controlCount: number }> {
	return Object.values(mockDomains).map((domain) => {
		const controlCount = domain.risks.reduce((sum, r) => sum + r.controls.length, 0)
		return {
			code: domain.code,
			name: domain.name,
			riskCount: domain.risks.length,
			controlCount,
		}
	})
}

/* ── Mock: Applikasjoner ── */

export interface MockAppSummary {
	id: string
	name: string
	teams: string[]
	controlsImplemented: number
	controlsPartial: number
	controlsTotal: number
}

export const mockApps: MockAppSummary[] = [
	{
		id: "app-1",
		name: "pensjon-regler",
		teams: ["team-pensjon"],
		controlsImplemented: 18,
		controlsPartial: 4,
		controlsTotal: 24,
	},
	{
		id: "app-2",
		name: "arbeid-api",
		teams: ["team-arbeid"],
		controlsImplemented: 10,
		controlsPartial: 6,
		controlsTotal: 24,
	},
	{
		id: "app-3",
		name: "helserefusjon-web",
		teams: ["team-helserefusjon"],
		controlsImplemented: 5,
		controlsPartial: 3,
		controlsTotal: 24,
	},
]

/* ── Mock: Compliance-vurderinger ── */

export interface MockControlAssessment {
	controlId: string
	controlName: string
	domain: string
	status: "not_relevant" | "not_implemented" | "partially_implemented" | "implemented" | null
	comment: string | null
	assessedBy: string | null
	assessedAt: string | null
}

export function getMockAssessments(_appId: string): MockControlAssessment[] {
	return [
		{
			controlId: "K-ST.01",
			controlName: "Scoping av økonomisystem",
			domain: "Styring",
			status: "implemented",
			comment: "Gjennomgått Q1 2026. Se https://jira.nav.no/browse/KISS-123",
			assessedBy: "A123456",
			assessedAt: "2026-03-15T10:00:00Z",
		},
		{
			controlId: "K-TS.01",
			controlName: "Tildeling av rettigheter",
			domain: "Tilgangsstyring",
			status: "partially_implemented",
			comment: "AD-grupper er satt opp, men periodisk gjennomgang mangler.",
			assessedBy: "B654321",
			assessedAt: "2026-03-10T14:00:00Z",
		},
		{
			controlId: "K-EH.01",
			controlName: "Regelsett for endringshåndtering",
			domain: "Endringshåndtering",
			status: null,
			comment: null,
			assessedBy: null,
			assessedAt: null,
		},
	]
}

/* ── Mock: Nais-team ── */

export interface MockNaisTeam {
	slug: string
	status: "pending" | "monitored" | "ignored"
	appCount: number
	discoveredAt: string
}

export const mockNaisTeams: MockNaisTeam[] = [
	{ slug: "team-pensjon", status: "monitored", appCount: 12, discoveredAt: "2026-03-01" },
	{ slug: "team-arbeid", status: "monitored", appCount: 8, discoveredAt: "2026-03-01" },
	{ slug: "team-helserefusjon", status: "pending", appCount: 5, discoveredAt: "2026-03-28" },
	{ slug: "team-deploy", status: "ignored", appCount: 3, discoveredAt: "2026-03-15" },
]

/* ── Mock: Rapport-detaljer ── */

export interface MockComplianceRow {
	controlId: string
	controlName: string
	status: "oppfylt" | "delvis" | "ikke-oppfylt" | "ikke-vurdert"
	comment: string
}

export interface MockReportDetail {
	rapportId: string
	name: string
	type: string
	scope: string
	createdAt: string
	appVersion: string
	complianceRows: MockComplianceRow[]
}

export function getMockReport(rapportId: string): MockReportDetail {
	return {
		rapportId,
		name: `Compliance-rapport ${rapportId}`,
		type: "Seksjon",
		scope: "Utvikling",
		createdAt: "2026-03-29T10:00:00Z",
		appVersion: "1.0.0",
		complianceRows: [
			{ controlId: "K-ST.01", controlName: "Styringsansvar", status: "oppfylt", comment: "Dokumentert i rutine." },
			{
				controlId: "K-TS.01",
				controlName: "Tilgangskontroll",
				status: "delvis",
				comment: "Mangler periodisk gjennomgang.",
			},
			{ controlId: "K-TS.02", controlName: "Sterk autentisering", status: "oppfylt", comment: "MFA aktivert." },
			{
				controlId: "K-EH.01",
				controlName: "Endringslogg",
				status: "ikke-oppfylt",
				comment: "Ingen endringslogg funnet.",
			},
			{ controlId: "K-DR.01", controlName: "Overvåking", status: "ikke-vurdert", comment: "" },
		],
	}
}

/* ── Mock: Seksjon-team ── */

export interface MockTeamStatus {
	slug: string
	name: string
	apps: number
	implemented: number
	partial: number
	notImplemented: number
	total: number
}

export const mockSeksjonTeams: MockTeamStatus[] = [
	{ slug: "team-alfa", name: "Team Alfa", apps: 4, implemented: 12, partial: 5, notImplemented: 7, total: 24 },
	{ slug: "team-bravo", name: "Team Bravo", apps: 3, implemented: 8, partial: 3, notImplemented: 4, total: 15 },
	{ slug: "team-charlie", name: "Team Charlie", apps: 2, implemented: 5, partial: 6, notImplemented: 1, total: 12 },
	{ slug: "team-delta", name: "Team Delta", apps: 5, implemented: 18, partial: 4, notImplemented: 8, total: 30 },
]

/* ── Mock: Team-applikasjoner ── */

export interface MockTeamApp {
	appId: string
	appName: string
	implemented: number
	partial: number
	notImplemented: number
	total: number
}

export const mockTeamApps: MockTeamApp[] = [
	{ appId: "app-001", appName: "Behandlingsflyt", implemented: 8, partial: 2, notImplemented: 2, total: 12 },
	{ appId: "app-002", appName: "Søknadsportal", implemented: 5, partial: 3, notImplemented: 4, total: 12 },
	{ appId: "app-003", appName: "Dokumentarkiv", implemented: 10, partial: 1, notImplemented: 1, total: 12 },
]
