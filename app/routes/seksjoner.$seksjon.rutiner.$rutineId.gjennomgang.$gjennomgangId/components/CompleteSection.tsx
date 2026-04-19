import { Alert, BodyShort, Box, Button, ConfirmationPanel, Heading, HStack, VStack } from "@navikt/ds-react"
import { useState } from "react"
import { useActionData, useNavigation, useSubmit } from "react-router"
import type { ActionResult } from "../shared"

export function CompleteSection() {
	const submit = useSubmit()
	const navigation = useNavigation()
	const actionData = useActionData<ActionResult>()
	const [confirmed, setConfirmed] = useState(false)
	const isSubmitting = navigation.state === "submitting"

	function handleComplete() {
		if (!confirmed) return
		const formData = new FormData()
		formData.set("intent", "complete")
		submit(formData, { method: "post" })
	}

	return (
		<Box padding="space-8" borderWidth="1" borderColor="warning" borderRadius="8" background="warning-softA">
			<VStack gap="space-4">
				<Heading size="small" level="4">
					Fullfør gjennomgang
				</Heading>
				<BodyShort>
					Når gjennomgangen er fullført kan den ikke lenger redigeres. Sørg for at alle vedlegg er lastet opp og
					oppsummeringen er korrekt.
				</BodyShort>

				{actionData?.intent === "complete" && actionData.error && (
					<Alert variant="error" size="small">
						{actionData.error}
					</Alert>
				)}

				<ConfirmationPanel
					checked={confirmed}
					onChange={() => setConfirmed(!confirmed)}
					label="Jeg bekrefter at gjennomgangen er komplett"
					size="small"
				/>

				<HStack>
					<Button
						type="button"
						variant="primary"
						size="small"
						onClick={handleComplete}
						disabled={!confirmed}
						loading={isSubmitting}
					>
						Fullfør gjennomgang
					</Button>
				</HStack>
			</VStack>
		</Box>
	)
}
