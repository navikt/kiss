import { BodyLong, Detail, Heading, Label, VStack } from "@navikt/ds-react"
import type { LoaderFunctionArgs } from "react-router"
import { data, useLoaderData } from "react-router"

interface ControlDetail {
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

const controls: Record<string, ControlDetail> = {
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

function getControlDetail(kontrollId: string): ControlDetail {
	return (
		controls[kontrollId] ?? {
			id: kontrollId,
			name: `Kontroll ${kontrollId}`,
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
	)
}

export async function loader({ params }: LoaderFunctionArgs) {
	const domene = params.domene?.toUpperCase()
	const kontrollId = params.kontrollId?.toUpperCase()

	if (!domene || !kontrollId) {
		throw new Response("Mangler parametere", { status: 400 })
	}

	const control = getControlDetail(kontrollId)

	return data({ domene, control })
}

function FieldRow({ label, value }: { label: string; value: string }) {
	return (
		<VStack gap="space-2">
			<Label size="small">{label}</Label>
			<BodyLong>{value}</BodyLong>
		</VStack>
	)
}

export default function ControlDetailPage() {
	const { domene, control } = useLoaderData<typeof loader>()

	return (
		<VStack gap="space-6">
			<VStack gap="space-2">
				<Detail>Domene: {domene} / Kontroll</Detail>
				<Heading size="xlarge" level="2">
					{control.id}: {control.name}
				</Heading>
			</VStack>

			<VStack gap="space-4">
				<FieldRow label="Teknologielement" value={control.teknologielement} />
				<FieldRow label="Krav" value={control.krav} />
				<FieldRow label="Ansvarlig" value={control.ansvarlig} />
				<FieldRow label="Rutine" value={control.rutine} />
				<FieldRow label="Frekvens" value={control.frekvens} />
				<FieldRow label="Dokumentasjonskrav" value={control.dokumentasjonskrav} />
				<FieldRow label="Testprosedyre" value={control.testprosedyre} />
				<FieldRow label="Avhengigheter" value={control.avhengigheter} />
				<FieldRow label="Referanser" value={control.referanser} />
				<FieldRow label="Vanlige fallgruver" value={control.vanligeFallgruver} />
			</VStack>
		</VStack>
	)
}
