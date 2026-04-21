import { BodyLong, Box, Button, Heading, HStack, Select, VStack } from "@navikt/ds-react"
import { Form } from "react-router"
import type { AppElement } from "../shared"
import { TechnologyElementRow } from "./TechnologyElementRow"

export function TechnologyElementsSection({
	appElements,
	availableElements,
}: {
	appElements: AppElement[]
	availableElements: Array<{ id: string; name: string }>
}) {
	return (
		<Box>
			<Heading size="medium" level="3" spacing>
				Teknologielementer
			</Heading>
			<BodyLong spacing>
				Teknologielementer bestemmer hvilke kontroller som er relevante for denne applikasjonen.
			</BodyLong>
			{appElements.length > 0 ? (
				<VStack gap="space-4">
					{appElements.map((el) => (
						<TechnologyElementRow key={el.id} element={el} />
					))}
				</VStack>
			) : (
				<BodyLong>Ingen teknologielementer er tilordnet.</BodyLong>
			)}
			{availableElements.length > 0 && (
				<VStack gap="space-4">
					<Form method="post">
						<input type="hidden" name="intent" value="addElement" />
						<HStack gap="space-2" align="end">
							<Select label="Legg til element" name="elementId" size="small">
								{availableElements.map((el) => (
									<option key={el.id} value={el.id}>
										{el.name}
									</option>
								))}
							</Select>
							<Button variant="secondary" size="small" type="submit">
								Legg til
							</Button>
						</HStack>
					</Form>
				</VStack>
			)}
		</Box>
	)
}
