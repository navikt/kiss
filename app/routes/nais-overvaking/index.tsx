import { BodyLong, Heading, VStack } from "@navikt/ds-react"

export default function NaisOvervaking() {
	return (
		<VStack gap="space-6">
			<Heading size="xlarge" level="2">
				Nais-overvåking
			</Heading>
			<BodyLong>Overvåk Nais-plattformen for automatisk oppdagelse av applikasjoner.</BodyLong>
		</VStack>
	)
}
