import { PlusIcon } from "@navikt/aksel-icons"
import { Box, Button, Checkbox, Heading, HStack, TextField, VStack } from "@navikt/ds-react"
import { Form } from "react-router"
import type { ControlOption, PendingChoice, PendingEffectItem, ServerChoice } from "../shared"
import { AddPendingChoiceForm } from "./AddPendingChoiceForm"
import { ChoiceCard } from "./ChoiceCard"

export function ChoicesSection({
	isNew,
	answerType,
	choices,
	pendingChoices,
	controls,
	onAddPendingChoice,
	onRemovePendingChoice,
	onAddPendingEffect,
	onRemovePendingEffect,
	onRequestDeleteChoice,
	onRequestDeleteEffect,
}: {
	isNew: boolean
	answerType: string
	choices: ServerChoice[]
	pendingChoices: PendingChoice[]
	controls: ControlOption[]
	onAddPendingChoice: (choice: PendingChoice) => void
	onRemovePendingChoice: (clientId: string) => void
	onAddPendingEffect: (choiceClientId: string, eff: PendingEffectItem) => void
	onRemovePendingEffect: (choiceClientId: string, effClientId: string) => void
	onRequestDeleteChoice: (id: string, label: string) => void
	onRequestDeleteEffect: (effectId: string, label: string) => void
}) {
	if (
		answerType === "" ||
		answerType === "persistence" ||
		answerType === "entra_id_groups" ||
		answerType === "ruleset"
	) {
		return null
	}

	const items: Array<ServerChoice | PendingChoice> = isNew ? pendingChoices : choices

	return (
		<Box padding="space-12" borderWidth="1" borderColor="neutral-subtle" borderRadius="8">
			<VStack gap="space-6">
				<Heading size="small" level="3">
					Valgmuligheter
				</Heading>

				{items.map((choice) => (
					<ChoiceCard
						key={"clientId" in choice ? choice.clientId : choice.id}
						choice={choice}
						controls={controls}
						onDeleteChoice={
							answerType === "boolean"
								? undefined
								: (label) => {
										const id = "clientId" in choice ? choice.clientId : choice.id
										onRequestDeleteChoice(id, label)
									}
						}
						onDeleteEffect={onRequestDeleteEffect}
						onAddPendingEffect={isNew ? onAddPendingEffect : undefined}
						onRemovePendingEffect={isNew ? onRemovePendingEffect : undefined}
						onRemovePendingChoice={isNew && answerType !== "boolean" ? onRemovePendingChoice : undefined}
					/>
				))}

				{answerType !== "boolean" &&
					(isNew ? (
						<AddPendingChoiceForm existingCount={pendingChoices.length} onAdd={onAddPendingChoice} />
					) : (
						<Form method="post">
							<input type="hidden" name="intent" value="addChoice" />
							<HStack gap="space-4" align="end" wrap>
								<TextField label="Navn" name="label" size="small" />
								<Checkbox name="requiresComment" size="small">
									Krev kommentar
								</Checkbox>
								<Checkbox name="requiresLink" size="small">
									Krev lenke
								</Checkbox>
								<Button type="submit" size="small" variant="secondary-neutral" icon={<PlusIcon aria-hidden />}>
									Legg til valg
								</Button>
							</HStack>
						</Form>
					))}
			</VStack>
		</Box>
	)
}
