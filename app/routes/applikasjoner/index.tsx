import { BodyLong, Heading, VStack } from "@navikt/ds-react"

export default function Applikasjoner() {
	return (
		<VStack gap="space-6">
			<Heading size="xlarge" level="2">
				Applikasjoner
			</Heading>
			<BodyLong>Oversikt over overvåkede applikasjoner og deres compliance-status.</BodyLong>
		</VStack>
	)
}
