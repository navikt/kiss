import { Alert, Button, HStack, Modal, Textarea, TextField, VStack } from "@navikt/ds-react"
import { useEffect } from "react"
import { useFetcher } from "react-router"
import { PersonSingleCombobox } from "./PersonSingleCombobox"

interface OpprettSeksjonModalProps {
	open: boolean
	onClose: () => void
}

interface ActionResult {
	success: boolean
	message?: string
	error?: string
}

/**
 * Modal for å opprette en ny seksjon med seksjonsleder og teknologileder.
 * Poster til /admin/seksjoner med intent=create-section-with-leaders.
 * Graph API-oppslag skjer client-side via PersonSingleCombobox — aldri i server-transaksjon.
 */
export function OpprettSeksjonModal({ open, onClose }: OpprettSeksjonModalProps) {
	const fetcher = useFetcher<ActionResult>()
	const isSubmitting = fetcher.state !== "idle"
	const result = fetcher.data

	// Lukk modal og reset ved suksess — vent til fetcher er tilbake i idle
	useEffect(() => {
		if (fetcher.state === "idle" && result?.success) {
			onClose()
		}
	}, [fetcher.state, result, onClose])

	return (
		<Modal
			open={open}
			onClose={isSubmitting ? undefined : onClose}
			header={{ heading: "Opprett ny seksjon" }}
			width="medium"
		>
			<fetcher.Form method="post" action="/admin/seksjoner">
				<input type="hidden" name="intent" value="create-section-with-leaders" />
				<Modal.Body>
					<VStack gap="space-6">
						{result && !result.success && result.error && <Alert variant="error">{result.error}</Alert>}

						<TextField label="Navn" name="name" required autoComplete="off" />

						<Textarea label="Beskrivelse" name="description" rows={3} />

						<PersonSingleCombobox
							name="sectionLeader"
							label="Seksjonsleder"
							description="Søk på navn eller NAV-ident"
							required
						/>

						<PersonSingleCombobox
							name="techLead"
							label="Teknologileder"
							description="Søk på navn eller NAV-ident"
							required
						/>
					</VStack>
				</Modal.Body>
				<Modal.Footer>
					<HStack gap="space-4">
						<Button type="submit" variant="primary" loading={isSubmitting}>
							Opprett seksjon
						</Button>
						<Button type="button" variant="tertiary" onClick={onClose} disabled={isSubmitting}>
							Avbryt
						</Button>
					</HStack>
				</Modal.Footer>
			</fetcher.Form>
		</Modal>
	)
}
