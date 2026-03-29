import { Accordion, BodyLong, Heading, VStack } from "@navikt/ds-react"
import type { LoaderFunctionArgs } from "react-router"
import { data, Link, useLoaderData } from "react-router"

interface Control {
	id: string
	name: string
}

interface Risk {
	id: string
	name: string
	controls: Control[]
}

interface Domain {
	code: string
	name: string
	risks: Risk[]
}

const domains: Record<string, Domain> = {
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

export async function loader({ params }: LoaderFunctionArgs) {
	const domainCode = params.domene?.toUpperCase()
	const domain = domainCode ? domains[domainCode] : undefined

	if (!domain) {
		throw new Response("Domene ikke funnet", { status: 404 })
	}

	return data({ domain })
}

export default function DomainDetail() {
	const { domain } = useLoaderData<typeof loader>()

	return (
		<VStack gap="space-6">
			<VStack gap="space-2">
				<Heading size="xlarge" level="2">
					{domain.name}
				</Heading>
				<BodyLong>
					Risikoer og kontroller for domenet {domain.name} ({domain.code}).
				</BodyLong>
			</VStack>

			<Accordion>
				{domain.risks.map((risk) => (
					<Accordion.Item key={risk.id}>
						<Accordion.Header>
							{risk.id}: {risk.name}
						</Accordion.Header>
						<Accordion.Content>
							<VStack gap="space-4">
								{risk.controls.map((control) => (
									<Link key={control.id} to={`/kontrollrammeverk/${domain.code}/${control.id}`} className="navds-link">
										{control.id}: {control.name}
									</Link>
								))}
							</VStack>
						</Accordion.Content>
					</Accordion.Item>
				))}
			</Accordion>
		</VStack>
	)
}
