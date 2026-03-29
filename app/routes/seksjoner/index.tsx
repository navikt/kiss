import { BodyLong, Heading, VStack } from "@navikt/ds-react"

export default function Seksjoner() {
	return (
		<VStack gap="space-6">
			<Heading size="xlarge" level="2">
				Seksjoner
			</Heading>
			<BodyLong>Oversikt over seksjoner, klynger og utviklingsteam.</BodyLong>
		</VStack>
	)
}
