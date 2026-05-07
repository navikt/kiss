import { Button, HStack, Radio, RadioGroup, Select, TextField, VStack } from "@navikt/ds-react"
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
			{routineSelections.map((rs) => (
				<fetcher.Form method="post" key={rs.effectId}>
					<input type="hidden" name="intent" value="selectRoutine" />
					<input type="hidden" name="choiceEffectId" value={rs.effectId} />
					<HStack gap="space-4" align="end">
						<Select
							label={`Velg rutine for ${rs.controlTextId}${rs.controlName ? `: ${rs.controlName}` : ""}`}
							name="routineId"
							size="small"
							defaultValue={rs.selectedRoutineId ?? ""}
						>
							<option value="">– Ikke valgt –</option>
							{rs.routines.map((r) => (
								<option key={r.id} value={r.id}>
									{r.name}
								</option>
							))}
						</Select>
						<Button type="submit" size="small" variant="secondary-neutral">
							Lagre
						</Button>
					</HStack>
				</fetcher.Form>
			))}
		</VStack>
	)
}
