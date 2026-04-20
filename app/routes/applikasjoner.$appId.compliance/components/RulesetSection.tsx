import { BodyShort, Button, HStack, Select, Tag, VStack } from "@navikt/ds-react"
import { Form } from "react-router"
import type { RulesetOption, ScreeningQuestion } from "../shared"

export function RulesetSection({ question: q, rulesets }: { question: ScreeningQuestion; rulesets: RulesetOption[] }) {
	const selectedRuleset = rulesets.find((rs) => rs.id === q.answer)

	return (
		<VStack gap="space-4">
			<Form method="post">
				<input type="hidden" name="intent" value="screening" />
				<input type="hidden" name="questionId" value={q.id} />
				<HStack gap="space-4" align="end">
					<Select label="Velg regelsett" name="answer" size="small" defaultValue={q.answer ?? ""}>
						<option value="">— Ikke valgt —</option>
						{rulesets.map((rs) => (
							<option key={rs.id} value={rs.id}>
								{rs.name}
							</option>
						))}
					</Select>
					<Button type="submit" size="small" variant="secondary-neutral">
						Lagre
					</Button>
					{q.answer !== null && (
						<HStack gap="space-2" align="center">
							<Tag variant="success" size="xsmall">
								Besvart: {selectedRuleset?.name ?? q.answer}
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
			</Form>
		</VStack>
	)
}
