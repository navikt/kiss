import { BodyShort, Button, HStack, Radio, RadioGroup, Select, TextField, VStack } from "@navikt/ds-react"
import { useState } from "react"
import { useFetcher } from "react-router"
import type { ScreeningQuestion } from "../shared"

export function ScreeningAnswerForm({ question: q }: { question: ScreeningQuestion }) {
	const [selectedValue, setSelectedValue] = useState<string>(q.answer ?? "")
	const selectedChoice = q.choices.find((c) => c.label === selectedValue)
	const routineSelections = selectedChoice?.routineSelections ?? []
	const fetcher = useFetcher()

	return (
		<VStack gap="space-4">
			{q.answerType === "boolean" && q.choices.length === 2 ? (
				<VStack gap="space-4">
					<RadioGroup
						legend="Svar"
						name="answer"
						size="small"
						defaultValue={q.answer ?? ""}
						hideLegend
						onChange={(val) => setSelectedValue(val)}
						id="answer-field"
					>
						<HStack gap="space-4">
							{q.choices.map((c) => (
								<Radio key={c.label} value={c.label}>
									{c.label}
								</Radio>
							))}
						</HStack>
					</RadioGroup>
					{selectedChoice?.requiresComment && (
						<TextField label="Kommentar" name="answerComment" size="small" defaultValue={q.answerComment ?? ""} />
					)}
					{selectedChoice?.requiresLink && (
						<TextField label="Lenke" name="answerLink" size="small" defaultValue={q.answerLink ?? ""} />
					)}
				</VStack>
			) : (
				<VStack gap="space-4">
					<Select
						label="Svar"
						name="answer"
						size="small"
						defaultValue={q.answer ?? ""}
						onChange={(e) => setSelectedValue(e.target.value)}
						id="answer-field"
					>
						<option value="" disabled>
							Velg svar
						</option>
						{q.choices.map((c) => (
							<option key={c.label} value={c.label}>
								{c.label}
							</option>
						))}
					</Select>
					{selectedChoice?.requiresComment && (
						<TextField label="Kommentar" name="answerComment" size="small" defaultValue={q.answerComment ?? ""} />
					)}
					{selectedChoice?.requiresLink && (
						<TextField label="Lenke" name="answerLink" size="small" defaultValue={q.answerLink ?? ""} />
					)}
				</VStack>
			)}
			{routineSelections.map((rs) => {
				if (rs.presetRoutineId) {
					if (!rs.presetRoutineName) {
						return (
							<BodyShort key={rs.effectId} size="small">
								<strong>Advarsel:</strong> En forvalgt rutine for {rs.controlTextId}
								{rs.controlName ? `: ${rs.controlName}` : ""} er ikke lenger tilgjengelig (arkivert eller ikke godkjent)
								og vil ikke tildeles automatisk. Velg en rutine manuelt.
							</BodyShort>
						)
					}
					return (
						<BodyShort key={rs.effectId} size="small">
							Rutinen <strong>{rs.presetRoutineName}</strong> tildeles automatisk for {rs.controlTextId}
							{rs.controlName ? `: ${rs.controlName}` : ""}.
						</BodyShort>
					)
				}
				const selectId = `routine-select-${rs.effectId}`
				return (
					<HStack gap="space-4" align="end" key={rs.effectId}>
						<Select
							label={`Velg rutine for ${rs.controlTextId}${rs.controlName ? `: ${rs.controlName}` : ""}`}
							size="small"
							defaultValue={rs.selectedRoutineId ?? ""}
							id={selectId}
						>
							<option value="">– Ikke valgt –</option>
							{rs.routines.map((r) => (
								<option key={r.id} value={r.id}>
									{r.name}
								</option>
							))}
						</Select>
						<Button
							type="button"
							size="small"
							variant="secondary-neutral"
							onClick={() => {
								const select = document.getElementById(selectId) as HTMLSelectElement | null
								fetcher.submit(
									{ intent: "selectRoutine", choiceEffectId: rs.effectId, routineId: select?.value ?? "" },
									{ method: "post" },
								)
							}}
						>
							Lagre
						</Button>
					</HStack>
				)
			})}
		</VStack>
	)
}
