import { CheckmarkCircleFillIcon } from "@navikt/aksel-icons"
import { BodyLong, BodyShort, Button, ExpansionCard, Heading, HStack, Tag, VStack } from "@navikt/ds-react"
import type { EconomyClassificationData, RulesetOption, ScreeningQuestion } from "../shared"

type Props = {
	questions: ScreeningQuestion[]
	rulesetOptions: RulesetOption[]
	economyClassification?: EconomyClassificationData
	readOnly?: boolean
	onNavigateToQuestion: (questionId: string) => void
}

function getAnswerLabel(
	q: ScreeningQuestion,
	rulesetOptions: RulesetOption[],
	economyClassification?: EconomyClassificationData,
): string {
	if (q.answerType === "boolean") {
		if (q.answer === "yes") return "Ja"
		if (q.answer === "no") return "Nei"
		return q.answer ?? "Ikke besvart"
	}
	if (q.answerType === "single_choice") {
		return q.answer ?? "Ikke besvart"
	}
	if (q.answerType === "persistence" || q.answerType === "entra_id_groups" || q.answerType === "economy_system") {
		if (q.answer !== "confirmed") return "Ikke bekreftet"
		if (q.answerType === "economy_system") {
			if (!economyClassification || economyClassification.isExpired) return "Utløpt – trenger revisjon"
		}
		return "Bekreftet"
	}
	if (q.answerType === "ruleset") {
		if (!q.answer) return "Ikke valgt"
		const ruleset = rulesetOptions.find((rs) => rs.id === q.answer)
		return ruleset?.name ?? q.answer
	}
	return q.answer ?? "Ikke besvart"
}

export function WizardCompletionPage({
	questions,
	rulesetOptions,
	economyClassification,
	readOnly,
	onNavigateToQuestion,
}: Props) {
	return (
		<VStack gap="space-8">
			<HStack gap="space-4" align="center">
				<CheckmarkCircleFillIcon fontSize="2.5rem" color="var(--ax-text-action-success)" aria-hidden />
				<Heading size="medium" level="2">
					Ferdig! Alle innledende spørsmål er besvart
				</Heading>
			</HStack>

			{!readOnly && (
				<BodyLong>
					Svarene dine påvirker hvilke kontroller som gjelder for denne applikasjonen. Du kan når som helst komme
					tilbake og endre svar ved å klikke på et spørsmål i stepperen til venstre.
				</BodyLong>
			)}

			<VStack gap="space-4">
				<Heading size="small" level="3">
					Hva nå?
				</Heading>
				<BodyLong>
					Basert på svarene dine er det generert en oversikt over kontroller som applikasjonen din må følge. Gå videre
					til kontrollgjennomgangen for å se status.
				</BodyLong>
			</VStack>

			<ExpansionCard aria-label="Se alle svar">
				<ExpansionCard.Header>
					<ExpansionCard.Title size="small">Se alle svar</ExpansionCard.Title>
					<ExpansionCard.Description>Oppsummering av dine {questions.length} svar</ExpansionCard.Description>
				</ExpansionCard.Header>
				<ExpansionCard.Content>
					<VStack gap="space-4" as="ul" style={{ listStyle: "none", padding: 0, margin: 0 }}>
						{questions.map((q) => (
							<li key={q.id}>
								<HStack gap="space-4" align="center" wrap>
									<CheckmarkCircleFillIcon fontSize="1.25rem" color="var(--ax-text-action-success)" aria-hidden />
									<BodyShort size="small" style={{ flex: 1 }}>
										{q.questionText}
									</BodyShort>
									<Tag variant="neutral" size="xsmall">
										{getAnswerLabel(q, rulesetOptions, economyClassification)}
									</Tag>
									<Button type="button" variant="tertiary" size="xsmall" onClick={() => onNavigateToQuestion(q.id)}>
										{readOnly ? "Gå til" : "Endre"}
									</Button>
								</HStack>
							</li>
						))}
					</VStack>
				</ExpansionCard.Content>
			</ExpansionCard>
		</VStack>
	)
}
