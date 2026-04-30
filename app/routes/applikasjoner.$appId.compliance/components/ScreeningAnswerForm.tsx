import { Button, ErrorSummary, HStack, Radio, RadioGroup, Select, Tag, TextField, VStack } from "@navikt/ds-react"
import { type FormEvent, useRef, useState } from "react"
import { Form, useFetcher } from "react-router"
import type { ScreeningQuestion } from "../shared"

export function ScreeningAnswerForm({ question: q }: { question: ScreeningQuestion }) {
	const [selectedValue, setSelectedValue] = useState<string>(q.answer ?? "")
	const [hasAttempted, setHasAttempted] = useState(false)
	const selectedChoice = q.choices.find((c) => c.label === selectedValue)
	const fetcher = useFetcher()
	const errorSummaryRef = useRef<HTMLDivElement>(null)

	const answeredChoice = q.choices.find((c) => c.label === q.answer)
	const routineSelections = answeredChoice?.routineSelections ?? []
	const isAnswered = q.answer !== null

	const showError = hasAttempted && !selectedValue

	function handleSubmit(e: FormEvent<HTMLFormElement>) {
		if (!selectedValue) {
			e.preventDefault()
			setHasAttempted(true)
			setTimeout(() => errorSummaryRef.current?.focus(), 0)
		}
	}

	if (q.answerType === "boolean" && q.choices.length === 2) {
		return (
			<VStack gap="space-4">
				<Form method="post" onSubmit={handleSubmit}>
					<input type="hidden" name="intent" value="screening" />
					<input type="hidden" name="questionId" value={q.id} />
					<VStack gap="space-4">
						{showError && (
							<ErrorSummary ref={errorSummaryRef} heading="Du må velge et svar">
								<ErrorSummary.Item href="#answer-field">Velg et alternativ</ErrorSummary.Item>
							</ErrorSummary>
						)}
						<RadioGroup
							legend="Svar"
							name="answer"
							size="small"
							defaultValue={q.answer ?? ""}
							hideLegend
							error={showError ? "Du må velge et alternativ" : undefined}
							onChange={(val) => {
								setSelectedValue(val)
								if (hasAttempted) setHasAttempted(false)
							}}
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
						<HStack gap="space-4" align="center" justify="end">
							{isAnswered && (
								<Tag variant="success" size="xsmall">
									✓ Besvart: {q.answer}
								</Tag>
							)}
							<Button type="submit" size="small" variant={isAnswered ? "secondary" : "primary"}>
								{isAnswered ? "Oppdater" : "Lagre og gå videre"}
							</Button>
						</HStack>
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
			<Form method="post" onSubmit={handleSubmit}>
				<input type="hidden" name="intent" value="screening" />
				<input type="hidden" name="questionId" value={q.id} />
				<VStack gap="space-4">
					{showError && (
						<ErrorSummary ref={errorSummaryRef} heading="Du må velge et svar">
							<ErrorSummary.Item href="#answer-field">Velg et alternativ fra listen</ErrorSummary.Item>
						</ErrorSummary>
					)}
					<Select
						label="Svar"
						name="answer"
						size="small"
						defaultValue={q.answer ?? ""}
						error={showError ? "Du må velge et alternativ" : undefined}
						onChange={(e) => {
							setSelectedValue(e.target.value)
							if (hasAttempted && e.target.value) setHasAttempted(false)
						}}
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
					<HStack gap="space-4" align="center" justify="end">
						{isAnswered && (
							<Tag variant="success" size="xsmall">
								✓ Besvart: {q.answer}
							</Tag>
						)}
						<Button type="submit" size="small" variant={isAnswered ? "secondary" : "primary"}>
							{isAnswered ? "Oppdater" : "Lagre og gå videre"}
						</Button>
					</HStack>
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
