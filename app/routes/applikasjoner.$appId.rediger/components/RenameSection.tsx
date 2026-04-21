import { Box, Button, Heading, HStack, TextField } from "@navikt/ds-react"
import { Form } from "react-router"

export function RenameSection({ name }: { name: string }) {
	return (
		<Box>
			<Heading size="medium" level="3" spacing>
				Navn
			</Heading>
			<Form method="post">
				<input type="hidden" name="intent" value="rename" />
				<HStack gap="space-4" align="end">
					<TextField label="Applikasjonsnavn" name="name" defaultValue={name} size="small" />
					<Button variant="secondary" size="small" type="submit">
						Lagre
					</Button>
				</HStack>
			</Form>
		</Box>
	)
}
