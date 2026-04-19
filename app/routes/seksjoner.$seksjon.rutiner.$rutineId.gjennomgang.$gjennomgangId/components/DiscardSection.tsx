import { BodyShort, Box, Button, Dialog, Heading, HStack, VStack } from "@navikt/ds-react"
import { useState } from "react"
import { Form, useNavigation } from "react-router"

export function DiscardSection() {
	const [dialogOpen, setDialogOpen] = useState(false)
	const navigation = useNavigation()
	const isSubmitting = navigation.state === "submitting"

	return (
		<Box padding="space-8" borderWidth="1" borderColor="neutral-subtle" borderRadius="8">
			<VStack gap="space-4">
				<Heading size="small" level="4">
					Forkast gjennomgang
				</Heading>
				<BodyShort>
					Forkaster du gjennomgangen vil den fjernes fra alle oversikter. Dataene beholdes for sporbarhet.
				</BodyShort>
				<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
					<Dialog.Trigger>
						<Button type="button" variant="danger" size="small">
							Forkast gjennomgang
						</Button>
					</Dialog.Trigger>
					<Dialog.Popup width="small" position="center" closeOnOutsideClick aria-label="Bekreft forkasting">
						<Dialog.Header>Forkast gjennomgang?</Dialog.Header>
						<Dialog.Body>
							<VStack gap="space-6">
								<BodyShort>
									Er du sikker på at du vil forkaste denne gjennomgangen? Handlingen kan ikke angres.
								</BodyShort>
								<Form method="post">
									<input type="hidden" name="intent" value="discard-review" />
									<HStack gap="space-4">
										<Button type="submit" variant="danger" size="small" loading={isSubmitting}>
											Ja, forkast
										</Button>
										<Button type="button" variant="secondary" size="small" onClick={() => setDialogOpen(false)}>
											Avbryt
										</Button>
									</HStack>
								</Form>
							</VStack>
						</Dialog.Body>
					</Dialog.Popup>
				</Dialog>
			</VStack>
		</Box>
	)
}
