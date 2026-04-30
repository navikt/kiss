import { Alert, BodyShort, Button, Heading, HStack, Tag, VStack } from "@navikt/ds-react"
import { useCallback, useEffect } from "react"
import { useSearchParams } from "react-router"
import type { EntraGroupsData, OracleRolesData, PersistenceEntry, RulesetOption, ScreeningQuestion } from "../shared"
import { slugify } from "../shared"
import { EntraGroupsSection } from "./EntraGroupsSection"
import { OracleRolesScreeningSection } from "./OracleRolesScreeningSection"
import { PersistenceSection } from "./PersistenceSection"
import { RulesetSection } from "./RulesetSection"
import { ScreeningAnswerForm } from "./ScreeningAnswerForm"
import { WizardCompletionPage } from "./WizardCompletionPage"
import { WizardStepper } from "./WizardStepper"
import styles from "./wizard.module.css"

type Props = {
	screening: ScreeningQuestion[]
	persistence: PersistenceEntry[]
	rulesetOptions: RulesetOption[]
	entraGroupsData: EntraGroupsData
	oracleRolesData: OracleRolesData
	canAdmin: boolean
}

function isQuestionAnswered(q: ScreeningQuestion) {
	if (q.answerType === "persistence" || q.answerType === "entra_id_groups" || q.answerType === "oracle_roles") {
		return q.answer === "confirmed"
	}
	return q.answer !== null
}

export function ScreeningWizard({
	screening,
	persistence,
	rulesetOptions,
	entraGroupsData,
	oracleRolesData,
	canAdmin,
}: Props) {
	const [searchParams, setSearchParams] = useSearchParams()

	const stepParam = searchParams.get("step")
	const isComplete = stepParam === "complete"

	// Determine current question from URL or first unanswered
	const currentQuestion = isComplete
		? null
		: (screening.find((q) => q.id === stepParam) ??
			screening.find((q) => !isQuestionAnswered(q)) ??
			screening[0] ??
			null)

	const currentIndex = currentQuestion ? screening.indexOf(currentQuestion) : -1

	const navigateTo = useCallback(
		(questionId: string) => {
			setSearchParams(
				(prev) => {
					const next = new URLSearchParams(prev)
					next.set("step", questionId)
					return next
				},
				{ replace: true },
			)
		},
		[setSearchParams],
	)

	const navigateToComplete = useCallback(() => {
		setSearchParams(
			(prev) => {
				const next = new URLSearchParams(prev)
				next.set("step", "complete")
				return next
			},
			{ replace: true },
		)
	}, [setSearchParams])

	const goToNext = useCallback(() => {
		if (currentIndex < screening.length - 1) {
			navigateTo(screening[currentIndex + 1].id)
		} else {
			navigateToComplete()
		}
	}, [currentIndex, screening, navigateTo, navigateToComplete])

	const goToPrevious = useCallback(() => {
		if (currentIndex > 0) {
			navigateTo(screening[currentIndex - 1].id)
		}
	}, [currentIndex, screening, navigateTo])

	const allAnswered = screening.length > 0 && screening.every(isQuestionAnswered)
	const answeredCount = screening.filter(isQuestionAnswered).length

	// If step=complete but not all answered, redirect to first unanswered
	useEffect(() => {
		if (isComplete && !allAnswered && screening.length > 0) {
			const firstUnanswered = screening.find((q) => !isQuestionAnswered(q))
			if (firstUnanswered) {
				navigateTo(firstUnanswered.id)
			}
		}
	}, [isComplete, allAnswered, screening, navigateTo])

	if (screening.length === 0) {
		return (
			<Alert variant="info" size="small">
				Det er ingen godkjente innledende spørsmål for denne seksjonen ennå.
			</Alert>
		)
	}

	// Show completion page
	if (isComplete && allAnswered) {
		return (
			<div className={styles.layout}>
				<WizardStepper
					questions={screening}
					currentQuestionId={null}
					isComplete
					onNavigate={navigateTo}
					onNavigateComplete={navigateToComplete}
				/>
				<main className={styles.content}>
					<VStack gap="space-6">
						<BodyShort size="small" textColor="subtle">
							{answeredCount} av {screening.length} spørsmål besvart
						</BodyShort>
						<WizardCompletionPage questions={screening} onNavigateToQuestion={navigateTo} />
					</VStack>
				</main>
			</div>
		)
	}

	if (isComplete && !allAnswered) {
		return null
	}

	if (!currentQuestion) return null

	return (
		<div className={styles.layout}>
			<WizardStepper
				questions={screening}
				currentQuestionId={currentQuestion.id}
				onNavigate={navigateTo}
				onNavigateComplete={navigateToComplete}
			/>

			<main className={styles.content}>
				<VStack gap="space-6">
					<BodyShort size="small" textColor="subtle">
						{answeredCount} av {screening.length} spørsmål besvart
					</BodyShort>

					<div className={styles.questionCard} id={`q-${slugify(currentQuestion.questionText)}`}>
						<VStack gap="space-4">
							<Heading size="small" level="3">
								{currentQuestion.questionText}
							</Heading>
							{currentQuestion.descriptionHtml && (
								<div
									className="markdown-content"
									// biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized with DOMPurify
									dangerouslySetInnerHTML={{ __html: currentQuestion.descriptionHtml }}
								/>
							)}
							{currentQuestion.affectedControls.length > 0 && (
								<HStack gap="space-2" wrap>
									<BodyShort size="small" textColor="subtle">
										Påvirker:
									</BodyShort>
									{currentQuestion.affectedControls.map((controlId) => (
										<Tag key={controlId} variant="neutral" size="xsmall">
											{controlId}
										</Tag>
									))}
								</HStack>
							)}

							{currentQuestion.answerType === "persistence" ? (
								<PersistenceSection
									key={currentQuestion.id}
									entries={persistence}
									questionId={currentQuestion.id}
									confirmed={currentQuestion.answer === "confirmed"}
								/>
							) : currentQuestion.answerType === "entra_id_groups" ? (
								<EntraGroupsSection
									key={currentQuestion.id}
									entraGroupsData={entraGroupsData}
									questionId={currentQuestion.id}
									confirmed={currentQuestion.answer === "confirmed"}
								/>
							) : currentQuestion.answerType === "oracle_roles" ? (
								<OracleRolesScreeningSection
									key={currentQuestion.id}
									oracleRolesData={oracleRolesData}
									questionId={currentQuestion.id}
									confirmed={currentQuestion.answer === "confirmed"}
									canAdmin={canAdmin}
								/>
							) : currentQuestion.answerType === "ruleset" ? (
								<RulesetSection key={currentQuestion.id} question={currentQuestion} rulesets={rulesetOptions} />
							) : (
								<ScreeningAnswerForm key={currentQuestion.id} question={currentQuestion} />
							)}
						</VStack>
					</div>

					<nav className={styles.navigation} aria-label="Spørsmålsnavigasjon">
						<Button type="button" variant="secondary" size="small" onClick={goToPrevious} disabled={currentIndex === 0}>
							← Forrige
						</Button>
						<Button type="button" variant="primary" size="small" onClick={goToNext}>
							Neste →
						</Button>
					</nav>
				</VStack>
			</main>
		</div>
	)
}
