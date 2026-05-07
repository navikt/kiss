import { Select, VStack } from "@navikt/ds-react"
import type { RulesetOption, ScreeningQuestion } from "../shared"

export function RulesetSection({ question: q, rulesets }: { question: ScreeningQuestion; rulesets: RulesetOption[] }) {
	return (
		<VStack gap="space-4">
			<Select label="Velg regelsett" name="answer" size="small" defaultValue={q.answer ?? ""} id="ruleset-field">
				<option value="">— Ikke valgt —</option>
				{rulesets.map((rs) => (
					<option key={rs.id} value={rs.id}>
						{rs.name}
					</option>
				))}
			</Select>
		</VStack>
	)
}
