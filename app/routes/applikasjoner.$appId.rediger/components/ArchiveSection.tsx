import { Alert, BodyLong, Box, Button, Heading, VStack } from "@navikt/ds-react"
import { Form } from "react-router"

interface ArchiveSectionProps {
	appName: string
	archivedAt: Date | string | null
	archivedBy: string | null
}

export function ArchiveSection({ appName, archivedAt, archivedBy }: ArchiveSectionProps) {
	if (archivedAt) {
		const archivedAtDate = archivedAt instanceof Date ? archivedAt : new Date(archivedAt)
		return (
			<Box padding="space-16" borderRadius="8" borderColor="warning-subtle" borderWidth="1">
				<VStack gap="space-8">
					<Heading size="medium" level="3">
						Applikasjonen er arkivert
					</Heading>
					<Alert variant="warning" inline>
						Arkivert {archivedAtDate.toLocaleString("nb-NO")}
						{archivedBy ? ` av ${archivedBy}` : ""}. Den er skjult fra brukervendte lister, men all data,
						compliance-historikk og audit-logg er bevart.
					</Alert>
					<Form method="post">
						<input type="hidden" name="intent" value="unarchive" />
						<Button variant="secondary" size="small" type="submit">
							Reaktiver {appName}
						</Button>
					</Form>
				</VStack>
			</Box>
		)
	}

	return (
		<Box padding="space-16" borderRadius="8" borderColor="warning-subtle" borderWidth="1">
			<VStack gap="space-8">
				<Heading size="medium" level="3">
					Arkiver applikasjon
				</Heading>
				<BodyLong>
					Denne applikasjonen finnes ikke på Nais og har ingen lenkede applikasjoner. Du kan arkivere den. All data og
					historikk bevares (i henhold til Navs krav til sporbarhet), men applikasjonen vil skjules fra brukervendte
					lister. Arkivering kan reverseres.
				</BodyLong>
				<Form
					method="post"
					onSubmit={(e) => !confirm(`Er du sikker på at du vil arkivere ${appName}?`) && e.preventDefault()}
				>
					<input type="hidden" name="intent" value="archive" />
					<Button variant="danger" size="small" type="submit">
						Arkiver {appName}
					</Button>
				</Form>
			</VStack>
		</Box>
	)
}
