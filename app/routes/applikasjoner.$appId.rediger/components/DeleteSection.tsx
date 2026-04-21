import { BodyLong, Box, Button, Heading, VStack } from "@navikt/ds-react"
import { Form } from "react-router"

export function DeleteSection({ appName }: { appName: string }) {
	return (
		<Box padding="space-16" borderRadius="8" borderColor="danger-subtle" borderWidth="1">
			<VStack gap="space-8">
				<Heading size="medium" level="3">
					Slett applikasjon
				</Heading>
				<BodyLong>
					Denne applikasjonen finnes ikke på Nais og har ingen lenkede applikasjoner. Du kan slette den permanent. Alle
					tilhørende vurderinger, screening-svar og annen data vil bli fjernet.
				</BodyLong>
				<Form
					method="post"
					onSubmit={(e) => !confirm(`Er du sikker på at du vil slette ${appName}?`) && e.preventDefault()}
				>
					<input type="hidden" name="intent" value="delete" />
					<Button variant="danger" size="small" type="submit">
						Slett {appName}
					</Button>
				</Form>
			</VStack>
		</Box>
	)
}
