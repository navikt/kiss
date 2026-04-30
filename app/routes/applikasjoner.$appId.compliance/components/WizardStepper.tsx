import { BodyShort } from "@navikt/ds-react"
import { useCallback } from "react"
import type { ScreeningQuestion } from "../shared"
import styles from "./wizard.module.css"

type Props = {
	questions: ScreeningQuestion[]
	currentQuestionId: string | null
	isComplete?: boolean
	onNavigate: (questionId: string) => void
	onNavigateComplete?: () => void
}

function isQuestionAnswered(q: ScreeningQuestion) {
	if (q.answerType === "persistence" || q.answerType === "entra_id_groups" || q.answerType === "oracle_roles") {
		return q.answer === "confirmed"
	}
	return q.answer !== null
}

export function WizardStepper({ questions, currentQuestionId, isComplete, onNavigate, onNavigateComplete }: Props) {
	const getStepStatus = useCallback(
		(q: ScreeningQuestion) => {
			if (!isComplete && q.id === currentQuestionId) return "active"
			if (isQuestionAnswered(q)) return "done"
			return "pending"
		},
		[currentQuestionId, isComplete],
	)

	const answeredCount = questions.filter(isQuestionAnswered).length
	const allAnswered = answeredCount === questions.length

	const statusClass = {
		done: styles.stepperItemDone,
		active: styles.stepperItemActive,
		pending: styles.stepperItemPending,
	}

	return (
		<aside className={styles.stepper} aria-label="Fremdrift">
			<BodyShort size="small" className={styles.stepperTitle}>
				Innledende spørsmål
			</BodyShort>
			<BodyShort size="small" textColor="subtle" className={styles.stepperCount}>
				{answeredCount} av {questions.length} besvart
			</BodyShort>
			<ol className={styles.stepperList}>
				{questions.map((q, index) => {
					const status = getStepStatus(q)
					const canNavigate = status === "done" || status === "active"
					return (
						<li key={q.id} className={`${styles.stepperItem} ${statusClass[status]}`}>
							<button
								type="button"
								className={styles.stepperButton}
								onClick={() => onNavigate(q.id)}
								disabled={!canNavigate}
								aria-current={status === "active" ? "step" : undefined}
								aria-label={`Steg ${index + 1}: ${q.questionText}${status === "done" ? " (besvart)" : ""}`}
							>
								<span className={styles.stepperDot}>{status === "done" ? "✓" : index + 1}</span>
								<span className={styles.stepperLabel}>{q.questionText}</span>
							</button>
						</li>
					)
				})}
				<li
					className={`${styles.stepperItem} ${statusClass[isComplete ? "active" : allAnswered ? "done" : "pending"]}`}
				>
					<button
						type="button"
						className={styles.stepperButton}
						onClick={() => onNavigateComplete?.()}
						disabled={!allAnswered}
						aria-current={isComplete ? "step" : undefined}
						aria-label="Fullført – oppsummering"
					>
						<span className={styles.stepperDot}>{allAnswered ? "✓" : questions.length + 1}</span>
						<span className={styles.stepperLabel}>Fullført</span>
					</button>
				</li>
			</ol>
		</aside>
	)
}
