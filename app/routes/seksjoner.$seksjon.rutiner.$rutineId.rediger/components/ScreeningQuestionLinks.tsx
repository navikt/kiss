import { PlusIcon, TrashIcon } from "@navikt/aksel-icons"
import { BodyShort, Button, HStack, Label, Select, VStack } from "@navikt/ds-react"
import type { QuestionLink } from "../shared"

interface QuestionWithChoices {
	id: string
	questionText: string
	isSection: boolean
	choices: { id: string; label: string }[]
}

interface Props {
	links: QuestionLink[]
	questionsWithChoices: QuestionWithChoices[]
	onAdd: () => void
	onRemove: (index: number) => void
	onUpdate: (index: number, field: "questionId" | "choiceValue", value: string) => void
}

export function ScreeningQuestionLinks({ links, questionsWithChoices, onAdd, onRemove, onUpdate }: Props) {
	return (
		<VStack gap="space-2">
			<Label size="small">Innledende spørsmål</Label>
			<BodyShort size="small" textColor="subtle">
				Knytt rutinen til ett eller flere spørsmål. Apper som svarer med valgt svarverdi vil måtte gjennomføre rutinen.
			</BodyShort>
			{links.map((link, index) => {
				const question = questionsWithChoices.find((q) => q.id === link.questionId)
				return (
					// TODO: flytt inline style til CSS
					<HStack key={link.key} gap="space-2" align="end" style={{ flexWrap: "wrap" }}>
						{/* TODO: flytt inline style til CSS */}
						<div style={{ flex: 2, minWidth: "15rem" }}>
							<Select
								label={index === 0 ? "Spørsmål" : undefined}
								hideLabel={index > 0}
								aria-label="Spørsmål"
								size="small"
								value={link.questionId}
								onChange={(e) => onUpdate(index, "questionId", e.target.value)}
							>
								<option value="">Velg spørsmål …</option>
								{questionsWithChoices.filter((q) => q.isSection).length > 0 && (
									<optgroup label="Seksjonens spørsmål">
										{questionsWithChoices
											.filter((q) => q.isSection)
											.map((q) => (
												<option key={q.id} value={q.id}>
													{q.questionText}
												</option>
											))}
									</optgroup>
								)}
								<optgroup label="Globale spørsmål">
									{questionsWithChoices
										.filter((q) => !q.isSection)
										.map((q) => (
											<option key={q.id} value={q.id}>
												{q.questionText}
											</option>
										))}
								</optgroup>
							</Select>
						</div>
						{/* TODO: flytt inline style til CSS */}
						<div style={{ flex: 1, minWidth: "10rem" }}>
							<Select
								label={index === 0 ? "Svarverdi" : undefined}
								hideLabel={index > 0}
								aria-label="Svarverdi"
								size="small"
								value={link.choiceValue}
								onChange={(e) => onUpdate(index, "choiceValue", e.target.value)}
								disabled={!question || question.choices.length === 0}
							>
								<option value="">Velg …</option>
								{question?.choices.map((c) => (
									<option key={c.id} value={c.label}>
										{c.label}
									</option>
								))}
							</Select>
						</div>
						<input type="hidden" name="questionId" value={link.questionId} />
						<input type="hidden" name="choiceValue" value={link.choiceValue} />
						<Button
							type="button"
							variant="tertiary-neutral"
							size="small"
							icon={<TrashIcon aria-hidden />}
							onClick={() => onRemove(index)}
							aria-label="Fjern spørsmål"
						/>
					</HStack>
				)
			})}
			<div>
				<Button type="button" variant="secondary" size="xsmall" icon={<PlusIcon aria-hidden />} onClick={onAdd}>
					Legg til spørsmål
				</Button>
			</div>
		</VStack>
	)
}
