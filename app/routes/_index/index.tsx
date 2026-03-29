import { BodyLong, Heading, VStack } from "@navikt/ds-react"

export default function Index() {
	return (
		<VStack gap="space-6">
			<Heading size="xlarge" level="2">
				Dashboard
			</Heading>
			<BodyLong>
				Kontrollrammeverk for Integrert Sikker Systemutvikling (KISS) gir oversikt over SDLC compliance for
				applikasjoner i Nav.
			</BodyLong>
		</VStack>
	)
}
