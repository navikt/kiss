import { PlusIcon, TrashIcon } from "@navikt/aksel-icons"
import { BodyShort, Box, Button, Heading, HStack, Select, Table, Tag, VStack } from "@navikt/ds-react"
import { Form } from "react-router"
import { screeningEffectLabels } from "~/db/schema/screening"
import { getStatusLabel } from "~/lib/compliance-status"
import type { ControlOption, PendingChoice, PendingEffectItem, ServerChoice } from "../shared"
import { AddPendingEffectForm } from "./AddPendingEffectForm"

export function ChoiceCard({
	choice,
	controls,
	onDeleteChoice,
	onDeleteEffect,
	onAddPendingEffect,
	onRemovePendingEffect,
	onRemovePendingChoice,
}: {
	choice: ServerChoice | PendingChoice
	controls: ControlOption[]
	onDeleteChoice?: (label: string) => void
	onDeleteEffect: (effectId: string, label: string) => void
	onAddPendingEffect?: (choiceClientId: string, eff: PendingEffectItem) => void
	onRemovePendingEffect?: (choiceClientId: string, effClientId: string) => void
	onRemovePendingChoice?: (clientId: string) => void
}) {
	const isPending = "clientId" in choice
	const effects = isPending ? choice.effects : choice.effects
	const choiceLabel = choice.label

	return (
		<Box padding="space-8" borderWidth="1" borderColor="neutral-subtle" borderRadius="8">
			<VStack gap="space-4">
				<HStack justify="space-between" align="center">
					<HStack gap="space-4" align="center">
						<Heading size="xsmall" level="4">
							{choiceLabel}
						</Heading>
						{choice.requiresComment && (
							<Tag variant="neutral" size="xsmall">
								Krev kommentar
							</Tag>
						)}
						{choice.requiresLink && (
							<Tag variant="neutral" size="xsmall">
								Krev lenke
							</Tag>
						)}
					</HStack>
					{(onDeleteChoice || (isPending && onRemovePendingChoice)) && (
						<Button
							type="button"
							size="xsmall"
							variant="tertiary-neutral"
							icon={<TrashIcon aria-hidden />}
							onClick={() => {
								if (isPending && onRemovePendingChoice) {
									onRemovePendingChoice(choice.clientId)
								} else if (onDeleteChoice) {
									onDeleteChoice(choiceLabel)
								}
							}}
						>
							Slett
						</Button>
					)}
				</HStack>

				{effects.length > 0 && (
					<Table size="small">
						<Table.Header>
							<Table.Row>
								<Table.HeaderCell scope="col">Kontroll</Table.HeaderCell>
								<Table.HeaderCell scope="col">Effekt</Table.HeaderCell>
								<Table.HeaderCell scope="col" />
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{effects.map((e) => {
								const effectId = "clientId" in e ? e.clientId : e.id
								return (
									<Table.Row key={effectId}>
										<Table.DataCell>
											<Tag variant="info" size="xsmall">
												{e.controlTextId}
												{e.controlName ? ` – ${e.controlName}` : ""}
											</Tag>
										</Table.DataCell>
										<Table.DataCell>
											{e.effect ? (
												<Tag variant="neutral" size="xsmall">
													{screeningEffectLabels[e.effect] ?? getStatusLabel(e.effect)}
												</Tag>
											) : (
												<BodyShort size="small" textColor="subtle">
													—
												</BodyShort>
											)}
										</Table.DataCell>
										<Table.DataCell>
											{isPending && onRemovePendingEffect ? (
												<Button
													type="button"
													size="xsmall"
													variant="tertiary-neutral"
													icon={<TrashIcon aria-hidden />}
													onClick={() => onRemovePendingEffect(choice.clientId, effectId)}
												/>
											) : (
												<Button
													type="button"
													size="xsmall"
													variant="tertiary-neutral"
													icon={<TrashIcon aria-hidden />}
													onClick={() =>
														onDeleteEffect(effectId, `${e.controlTextId}${e.controlName ? ` – ${e.controlName}` : ""}`)
													}
												/>
											)}
										</Table.DataCell>
									</Table.Row>
								)
							})}
						</Table.Body>
					</Table>
				)}

				{isPending && onAddPendingEffect ? (
					<AddPendingEffectForm choiceClientId={choice.clientId} controls={controls} onAdd={onAddPendingEffect} />
				) : !isPending ? (
					<Form method="post">
						<input type="hidden" name="intent" value="addEffect" />
						<input type="hidden" name="choiceId" value={choice.id} />
						<HStack gap="space-4" align="end" wrap>
							<Select label="Kontroll" name="controlTextId" size="small">
								<option value="">Velg kontroll</option>
								{controls.map((c) => (
									<option key={c.controlId} value={c.controlId}>
										{c.controlId} – {c.name}
									</option>
								))}
							</Select>
							<Select label="Effekt" name="effect" size="small">
								<option value="">Ingen</option>
								{Object.entries(screeningEffectLabels).map(([v, l]) => (
									<option key={v} value={v}>
										{l}
									</option>
								))}
							</Select>
							<Button type="submit" size="small" variant="secondary-neutral" icon={<PlusIcon aria-hidden />}>
								Legg til effekt
							</Button>
						</HStack>
					</Form>
				) : null}
			</VStack>
		</Box>
	)
}
