import { BodyLong, Heading, VStack } from "@navikt/ds-react"

export default function Import() {
	return (
		<VStack gap="space-6">
			<Heading size="xlarge" level="2">
				Importer kontrollrammeverk
			</Heading>
			<BodyLong>Last opp Excel-fil med kontrollrammeverk-data for import.</BodyLong>
		</VStack>
	)
}
