import { BodyShort, Stepper } from "@navikt/ds-react"
import type { ReviewStep } from "./shared"
import styles from "./wizard.module.css"

type Props = {
	steps: ReviewStep[]
	currentStepId: string
	completedSteps: Set<string>
	onStepChange: (stepId: string) => void
}

export function ReviewWizardStepper({ steps, currentStepId, completedSteps, onStepChange }: Props) {
	const activeStep = Math.max(
		steps.findIndex((s) => s.id === currentStepId),
		0,
	)

	const handleStepChange = (step: number) => {
		const targetStep = steps[step - 1]
		if (targetStep) {
			onStepChange(targetStep.id)
		}
	}

	return (
		<aside className={styles.stepper} aria-label="Fremdrift">
			<BodyShort size="small" className={styles.stepperTitle}>
				Gjennomgang
			</BodyShort>
			<Stepper activeStep={activeStep + 1} onStepChange={handleStepChange} orientation="vertical">
				{steps.map((step) => (
					<Stepper.Step key={step.id} as="button" completed={completedSteps.has(step.id)}>
						{step.label}
					</Stepper.Step>
				))}
			</Stepper>
		</aside>
	)
}
