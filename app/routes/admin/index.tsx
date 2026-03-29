import { BodyLong, Heading, VStack } from "@navikt/ds-react"

export default function Admin() {
	return (
		<VStack gap="space-6">
			<Heading size="xlarge" level="2">
				Administrasjon
			</Heading>
			<BodyLong>Administrer brukere, seksjoner og systeminnstillinger.</BodyLong>
		</VStack>
	)
}
