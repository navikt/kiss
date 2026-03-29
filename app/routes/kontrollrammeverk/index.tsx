import { BodyLong, Heading, VStack } from "@navikt/ds-react"

export default function Kontrollrammeverk() {
	return (
		<VStack gap="space-6">
			<Heading size="xlarge" level="2">
				Kontrollrammeverk
			</Heading>
			<BodyLong>Oversikt over domener, risikoer og kontroller i kontrollrammeverket.</BodyLong>
		</VStack>
	)
}
