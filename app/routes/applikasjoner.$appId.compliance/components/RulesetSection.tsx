import { Button, ErrorSummary, HStack, Select, Tag, VStack } from "@navikt/ds-react"
import { type FormEvent, useRef, useState } from "react"
import { Form } from "react-router"
import type { RulesetOption, ScreeningQuestion } from "../shared"

export function RulesetSection({ question: q, rulesets }: { question: ScreeningQuestion; rulesets: RulesetOption[] }) {
	const selectedRuleset = rulesets.find((rs) => rs.id === q.answer)
	const isAnswered = q.answer !== null
	const [selectedValue, setSelectedValue] = useState(q.answer ?? "")
	const [hasAttempted, setHasAttempted] = useState(false)
	const errorSummaryRef = useRef<HTMLDivElement>(null)

	const showError = hasAttempted && !selectedValue

	function handleSubmit(e: FormEvent<HTMLFormElement>) {
		if (!selectedValue) {
			e.preventDefault()
			setHasAttempted(true)
			setTimeout(() => errorSummaryRef.current?.focus(), 0)
		}
	}

	return (
		<VStack gap="space-4">
			<Form method="post" onSubmit={handleSubmit}>
				<input type="hidden" name="intent" value="screening" />
				<input type="hidden" name="questionId" value={q.id} />
				<VStack gap="space-4">
					{showError && (
						<ErrorSummary ref={errorSummaryRef} heading="Du må velge et regelsett">
							<ErrorSummary.Item href="#ruleset-field">Velg et regelsett fra listen</ErrorSummary.Item>
						</ErrorSummary>
					)}
					<Select
						label="Velg regelsett"
						name="answer"
						size="small"
						defaultValue={q.answer ?? ""}
						error={showError ? "Du må velge et regelsett" : undefined}
						onChange={(e) => {
							setSelectedValue(e.target.value)
							if (hasAttempted && e.target.value) setHasAttempted(false)
						}}
						id="ruleset-field"
					>
						<option value="">— Ikke valgt —</option>
						{rulesets.map((rs) => (
							<option key={rs.id} value={rs.id}>
								{rs.name}
							</option>
						))}
					</Select>
					<HStack gap="space-4" align="center" justify="end">
						{isAnswered && (
							<Tag variant="success" size="xsmall">
								✓ Besvart: {selectedRuleset?.name ?? q.answer}
							</Tag>
						)}
						<Button type="submit" size="small" variant={isAnswered ? "secondary" : "primary"}>
							{isAnswered ? "Oppdater" : "Lagre og gå videre"}
						</Button>
					</HStack>
				</VStack>
			</Form>
		</VStack>
	)
}
