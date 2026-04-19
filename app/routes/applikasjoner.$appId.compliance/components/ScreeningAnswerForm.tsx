import { BodyShort, Button, HStack, Radio, RadioGroup, Select, Tag, TextField, VStack } from "@navikt/ds-react"
import { useState } from "react"
import { Form, useFetcher } from "react-router"
import type { ScreeningQuestion } from "../shared"

export function ScreeningAnswerForm({ question: q }: { question: ScreeningQuestion }) {
	const [selectedValue, setSelectedValue] = useState<string>(q.answer ?? "")
	const selectedChoice = q.choices.find((c) => c.label === selectedValue)
	const fetcher = useFetcher()

	const answeredChoice = q.choices.find((c) => c.label === q.answer)
	const routineSelections = answeredChoice?.routineSelections ?? []

	if (q.answerType === "boolean" && q.choices.length === 2) {
		return (
			<VStack gap="space-4">
				<Form method="post">
					<input type="hidden" name="intent" value="screening" />
					<input type="hidden" name="questionId" value={q.id} />
					<VStack gap="space-4">
						<HStack gap="space-4" align="end">
							<RadioGroup
								legend="Svar"
								name="answer"
								size="small"
								defaultValue={q.answer ?? ""}
								hideLegend
								onChange={(val) => setSelectedValue(val)}
							>
								<HStack gap="space-4">
									{q.choices.map((c) => (
										<Radio key={c.label} value={c.label}>
											{c.label}
										</Radio>
									))}
								</HStack>
							</RadioGroup>
							<Button type="submit" size="small" variant="secondary-neutral">
								Lagre
							</Button>
							{q.answer !== null && (
								<HStack gap="space-2" align="center">
									<Tag variant="success" size="xsmall">
										Besvart: {q.answer}
									</Tag>
									{q.answeredBy && (
										<BodyShort size="small" textColor="subtle">
											av {q.answeredBy}
											{q.answeredAt && ` — ${new Date(q.answeredAt).toLocaleDateString("nb-NO")}`}
										</BodyShort>
									)}
								</HStack>
							)}
						</HStack>
						{selectedChoice?.requiresComment && (
							<TextField label="Kommentar" name="answerComment" size="small" defaultValue={q.answerComment ?? ""} />
						)}
						{selectedChoice?.requiresLink && (
							<TextField label="Lenke" name="answerLink" size="small" defaultValue={q.answerLink ?? ""} />
						)}
					</VStack>
				</Form>
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

	return (
		<VStack gap="space-4">
			<Form method="post">
				<input type="hidden" name="intent" value="screening" />
				<input type="hidden" name="questionId" value={q.id} />
				<VStack gap="space-4">
					<HStack gap="space-4" align="end">
						<Select
							label="Svar"
							name="answer"
							size="small"
							defaultValue={q.answer ?? ""}
							onChange={(e) => setSelectedValue(e.target.value)}
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
						<Button type="submit" size="small" variant="secondary-neutral">
							Lagre
						</Button>
						{q.answer !== null && (
							<HStack gap="space-2" align="center">
								<Tag variant="success" size="xsmall">
									Besvart: {q.answer}
								</Tag>
								{q.answeredBy && (
									<BodyShort size="small" textColor="subtle">
										av {q.answeredBy}
										{q.answeredAt && ` — ${new Date(q.answeredAt).toLocaleDateString("nb-NO")}`}
									</BodyShort>
								)}
							</HStack>
						)}
					</HStack>
					{selectedChoice?.requiresComment && (
						<TextField label="Kommentar" name="answerComment" size="small" defaultValue={q.answerComment ?? ""} />
					)}
					{selectedChoice?.requiresLink && (
						<TextField label="Lenke" name="answerLink" size="small" defaultValue={q.answerLink ?? ""} />
					)}
				</VStack>
			</Form>
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
