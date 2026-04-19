import { LinkIcon } from "@navikt/aksel-icons"
import { Alert, Box, Button, Heading, HStack, TextField, VStack } from "@navikt/ds-react"
import { useState } from "react"
import { Form, useActionData, useNavigation } from "react-router"
import type { ActionResult } from "../shared"

export function AddLinkSection() {
	const actionData = useActionData<ActionResult>()
	const navigation = useNavigation()
	const isSubmitting = navigation.state === "submitting"
	const [url, setUrl] = useState("")
	const [title, setTitle] = useState("")

	return (
		<Box padding="space-6" borderWidth="1" borderColor="neutral-subtle" borderRadius="8">
			<Heading size="small" level="4" spacing>
				Legg til lenke
			</Heading>
			<Form
				method="post"
				onSubmit={() => {
					setTimeout(() => {
						setUrl("")
						setTitle("")
					}, 100)
				}}
			>
				<input type="hidden" name="intent" value="add-link" />
				<VStack gap="space-4">
					<HStack gap="space-4" align="end" style={{ flexWrap: "wrap" }}>
						<TextField
							label="Tittel (valgfritt)"
							name="linkTitle"
							size="small"
							autoComplete="off"
							value={title}
							onChange={(e) => setTitle(e.target.value)}
							style={{ minWidth: "15rem", flex: 1 }}
						/>
						<TextField
							label="URL"
							name="url"
							size="small"
							type="url"
							autoComplete="off"
							value={url}
							onChange={(e) => setUrl(e.target.value)}
							placeholder="https://..."
							style={{ minWidth: "20rem", flex: 2 }}
						/>
						<Button
							type="submit"
							variant="secondary"
							size="small"
							loading={isSubmitting}
							icon={<LinkIcon aria-hidden />}
						>
							Legg til
						</Button>
					</HStack>
					{actionData?.intent === "add-link" && actionData.error && (
						<Alert variant="error" size="small">
							{actionData.error}
						</Alert>
					)}
				</VStack>
			</Form>
		</Box>
	)
}
