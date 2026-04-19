import { PencilIcon } from "@navikt/aksel-icons"
import { Button, Heading, Textarea, TextField, VStack } from "@navikt/ds-react"
import { Form } from "react-router"
import type { SectionData } from "../shared"

export function SeksjonTab({ section }: { section: SectionData }) {
	return (
		<VStack gap="space-8">
			<VStack gap="space-6">
				<Heading size="medium" level="3">
					Seksjonsinformasjon
				</Heading>
				<Form method="post">
					<input type="hidden" name="intent" value="update-section" />
					{/* TODO: flytt inline style til CSS module */}
					<VStack gap="space-6" style={{ maxWidth: "40rem" }}>
						<TextField label="Navn" name="name" defaultValue={section.name} autoComplete="off" />
						<Textarea label="Beskrivelse" name="description" defaultValue={section.description ?? ""} minRows={3} />
						<div>
							<Button type="submit" variant="primary" size="small" icon={<PencilIcon aria-hidden />}>
								Lagre endringer
							</Button>
						</div>
					</VStack>
				</Form>
			</VStack>
		</VStack>
	)
}
