import { BodyShort, Stepper } from "@navikt/ds-react"
import { useCallback } from "react"
import type { EconomyClassificationData, ScreeningQuestion } from "../shared"
import { isQuestionAnswered } from "../shared"
import styles from "./wizard.module.css"

type Props = {
	questions: ScreeningQuestion[]
	currentQuestionId: string | null
	isComplete?: boolean
	economyClassification?: EconomyClassificationData
	onNavigate: (questionId: string) => void
	onNavigateComplete?: () => void
	onSaveAndNavigate: (navigate: () => void) => void
	participantsStep?: {
		isActive: boolean
		isDone: boolean
		label: string
		onNavigate: () => void
	}
}

export function WizardStepper({
	questions,
	currentQuestionId,
	isComplete,
	economyClassification,
	onNavigate,
	onNavigateComplete,
	onSaveAndNavigate,
	participantsStep,
}: Props) {
	const isAnswered = useCallback(
		(q: ScreeningQuestion) => isQuestionAnswered(q, economyClassification),
		[economyClassification],
	)

	const answeredCount = questions.filter(isAnswered).length
	const allAnswered = answeredCount === questions.length

	const stepOffset = participantsStep ? 1 : 0

	const getActiveStep = () => {
		if (participantsStep?.isActive) return 1
		if (!isComplete && currentQuestionId) {
			const idx = questions.findIndex((q) => q.id === currentQuestionId)
			if (idx >= 0) return idx + 1 + stepOffset
		}
		if (isComplete) return questions.length + 1 + stepOffset
		return 1
	}

	const handleStepChange = (step: number) => {
		if (participantsStep && step === 1) {
			onSaveAndNavigate(() => participantsStep.onNavigate())
			return
		}
		const questionIndex = step - 1 - stepOffset
		if (questionIndex >= 0 && questionIndex < questions.length) {
			onSaveAndNavigate(() => onNavigate(questions[questionIndex].id))
			return
		}
		if (step === questions.length + 1 + stepOffset && allAnswered) {
			onSaveAndNavigate(() => onNavigateComplete?.())
		}
	}

	return (
		<aside className={styles.stepper} aria-label="Fremdrift">
			<BodyShort size="small" className={styles.stepperTitle}>
				Innledende spørsmål
			</BodyShort>
			<BodyShort size="small" textColor="subtle" className={styles.stepperCount}>
				{answeredCount} av {questions.length} besvart
			</BodyShort>
			<Stepper activeStep={getActiveStep()} onStepChange={handleStepChange} orientation="vertical">
				{participantsStep && (
					<Stepper.Step as="button" completed={participantsStep.isDone}>
						{participantsStep.label}
					</Stepper.Step>
				)}
				{questions.map((q) => (
					<Stepper.Step key={q.id} as="button" completed={isAnswered(q)}>
						{q.questionText}
					</Stepper.Step>
				))}
				<Stepper.Step as="button" completed={allAnswered && isComplete} interactive={allAnswered}>
					Fullført
				</Stepper.Step>
			</Stepper>
		</aside>
	)
}
