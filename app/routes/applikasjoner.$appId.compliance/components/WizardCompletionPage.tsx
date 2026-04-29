import { CheckmarkCircleFillIcon } from "@navikt/aksel-icons"
import { BodyLong, BodyShort, Button, ExpansionCard, Heading, HStack, Tag, VStack } from "@navikt/ds-react"
import type { ScreeningQuestion } from "../shared"

type Props = {
	questions: ScreeningQuestion[]
	onNavigateToQuestion: (questionId: string) => void
}

function getAnswerLabel(q: ScreeningQuestion): string {
	if (q.answerType === "boolean") {
		if (q.answer === "yes") return "Ja"
		if (q.answer === "no") return "Nei"
		// The answer might be the label itself (e.g. "Ja" / "Nei")
		return q.answer ?? "Ikke besvart"
	}
	if (q.answerType === "single_choice") {
		return q.answer ?? "Ikke besvart"
	}
	if (q.answerType === "persistence" || q.answerType === "entra_id_groups" || q.answerType === "oracle_roles") {
		return q.answer === "confirmed" ? "Bekreftet" : "Ikke bekreftet"
	}
	if (q.answerType === "ruleset") {
		return q.answer ?? "Ikke valgt"
	}
	return q.answer ?? "Ikke besvart"
}

export function WizardCompletionPage({ questions, onNavigateToQuestion }: Props) {
	return (
		<VStack gap="space-8">
			<HStack gap="space-4" align="center">
				<CheckmarkCircleFillIcon fontSize="2.5rem" color="var(--ax-text-action-success)" aria-hidden />
				<Heading size="medium" level="2">
					Ferdig! Alle innledende spørsmål er besvart
				</Heading>
			</HStack>

			<BodyLong>
				Svarene dine påvirker hvilke kontroller som gjelder for denne applikasjonen. Du kan når som helst komme tilbake
				og endre svar ved å klikke på et spørsmål i stepperen til venstre.
			</BodyLong>

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
										{getAnswerLabel(q)}
									</Tag>
									<Button type="button" variant="tertiary" size="xsmall" onClick={() => onNavigateToQuestion(q.id)}>
										Endre
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
