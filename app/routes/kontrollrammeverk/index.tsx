import { BodyLong, Heading, HGrid, VStack } from "@navikt/ds-react"
import type { LoaderFunctionArgs } from "react-router"
import { data, Link, useLoaderData } from "react-router"

const domainColors: Record<string, string> = {
	Styring: "#f9d4a0",
	Tilgangsstyring: "#a0c4f9",
	Endringshåndtering: "#f9f0a0",
	Drift: "#a0f9d4",
}

interface DomainSummary {
	code: string
	name: string
	riskCount: number
	controlCount: number
}

export async function loader(_args: LoaderFunctionArgs) {
	const domains: DomainSummary[] = [
		{ code: "ST", name: "Styring", riskCount: 2, controlCount: 2 },
		{ code: "TS", name: "Tilgangsstyring", riskCount: 2, controlCount: 11 },
		{ code: "EH", name: "Endringshåndtering", riskCount: 1, controlCount: 5 },
		{ code: "DR", name: "Drift", riskCount: 4, controlCount: 6 },
	]

	return data({ domains })
}

export default function Kontrollrammeverk() {
	const { domains } = useLoaderData<typeof loader>()

	return (
		<VStack gap="space-6">
			<Heading size="xlarge" level="2">
				Kontrollrammeverk
			</Heading>
			<BodyLong>Oversikt over domener, risikoer og kontroller i Minimum kontrollrammeverk (MKR v1.1).</BodyLong>

			<HGrid gap="space-6" columns={{ xs: 1, sm: 2, md: 4 }}>
				{domains.map((domain) => (
					<Link
						key={domain.code}
						to={`/kontrollrammeverk/${domain.code}`}
						className="domain-card"
						style={{
							backgroundColor: domainColors[domain.name] ?? "#f0f0f0",
							textDecoration: "none",
							color: "inherit",
						}}
					>
						<Heading size="medium" level="3">
							{domain.name}
						</Heading>
						<BodyLong size="small">
							{domain.riskCount} risikoer · {domain.controlCount} kontroller
						</BodyLong>
					</Link>
				))}
			</HGrid>
		</VStack>
	)
}
