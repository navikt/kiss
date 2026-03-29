import { BodyLong, Heading, VStack } from "@navikt/ds-react"

export default function Rapporter() {
	return (
		<VStack gap="space-6">
			<Heading size="xlarge" level="2">
				Rapporter
			</Heading>
			<BodyLong>Generer og last ned compliance-rapporter.</BodyLong>
		</VStack>
	)
}
