import { PlusIcon } from "@navikt/aksel-icons"
import { Box, Button, Heading, HStack, Select, TextField, VStack } from "@navikt/ds-react"
import { useFetcher } from "react-router"
import { type DataClassification, dataClassificationLabels, persistenceTypeEnum } from "~/db/schema/applications"
import { persistenceLabels } from "../shared"

export function AddPersistenceForm() {
	const fetcher = useFetcher()
	const isSubmitting = fetcher.state !== "idle"

	return (
		<Box background="sunken" padding="space-8" borderRadius="8">
			<fetcher.Form method="post">
				<input type="hidden" name="intent" value="add-persistence" />
				<VStack gap="space-4">
					<Heading size="xsmall" level="3">
						Legg til database manuelt
					</Heading>
					<HStack gap="space-4" align="end" wrap>
						<Select label="Type" name="persistenceType" style={{ minWidth: "12rem" }}>
							{persistenceTypeEnum.map((t) => (
								<option key={t} value={t}>
									{persistenceLabels[t] ?? t}
								</option>
							))}
						</Select>
						<TextField label="Navn" name="persistenceName" size="small" style={{ minWidth: "14rem" }} />
						<Select label="Dataklassifisering" name="dataClassification">
							<option value="">Ikke satt</option>
							{(Object.entries(dataClassificationLabels) as [DataClassification, string][]).map(([value, label]) => (
								<option key={value} value={value}>
									{label}
								</option>
							))}
						</Select>
						<Button
							type="submit"
							variant="secondary"
							size="small"
							icon={<PlusIcon aria-hidden />}
							loading={isSubmitting}
						>
							Legg til
						</Button>
					</HStack>
				</VStack>
			</fetcher.Form>
		</Box>
	)
}
