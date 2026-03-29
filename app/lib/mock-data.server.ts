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

/** Calculate compliance percentage (implemented counts fully, partial counts 50%) */
export function compliancePercent(implemented: number, partial: number, total: number): number {
	return total > 0 ? Math.round(((implemented + partial * 0.5) / total) * 100) : 0
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
