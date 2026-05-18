import { ArrowLeftIcon, ArrowRightIcon } from "@navikt/aksel-icons"
import { Button, Heading, HStack, Tag, VStack } from "@navikt/ds-react"
import { useCallback, useMemo, useRef } from "react"
import { useActionData, useNavigation, useSubmit } from "react-router"
import { ReviewWizardStepper } from "./ReviewWizardStepper"
import { buildSteps, getStepIndex } from "./shared"
import styles from "./wizard.module.css"

type Props = {
	/** The current step content to render */
	children: React.ReactNode
	/** Current review status */
	status: "draft" | "needs_follow_up" | "completed" | "discarded"
	/** Review title */
	title: string
	/** Whether the routine has controls */
	hasControls: boolean
	/** Whether the routine has linked rulesets */
	hasRulesets: boolean
	/** Whether the routine has an activity type */
	hasActivity: boolean
	/** Called to get the current step ID from URL */
	currentStepId: string
	/** Which steps are "completed" (have data) */
	completedSteps: Set<string>
	/** Called when the step changes */
	onStepChange: (stepId: string) => void
}

const statusLabels: Record<string, string> = {
	draft: "Utkast",
	needs_follow_up: "Må følges opp",
	completed: "Fullført",
	discarded: "Forkastet",
}

const statusVariants: Record<string, "warning" | "success" | "neutral"> = {
	draft: "warning",
	needs_follow_up: "warning",
	completed: "success",
	discarded: "neutral",
}

/** Marker attribute for wizard step forms that should auto-save on navigation */
export const WIZARD_FORM_ATTR = "data-wizard-form"

export function ReviewWizard({
	children,
	status,
	title,
	hasControls,
	hasRulesets,
	hasActivity,
	currentStepId,
	completedSteps,
	onStepChange,
}: Props) {
	const steps = useMemo(
		() => buildSteps({ hasControls, hasRulesets, hasActivity }),
		[hasControls, hasRulesets, hasActivity],
	)
	const submit = useSubmit()
	const navigation = useNavigation()
	const actionData = useActionData<{ success: boolean }>()
	const pendingStepRef = useRef<string | null>(null)

	// When a submission completes, only navigate if the action succeeded
	if (navigation.state === "idle" && pendingStepRef.current) {
		if (actionData?.success !== false) {
			const nextStep = pendingStepRef.current
			pendingStepRef.current = null
			// Use queueMicrotask to avoid setState during render
			queueMicrotask(() => onStepChange(nextStep))
		} else {
			// Action failed — cancel pending navigation so user stays on current step
			pendingStepRef.current = null
		}
	}

	const navigateToStep = useCallback(
		(targetStepId: string) => {
			const form = document.querySelector(`[${WIZARD_FORM_ATTR}]`) as HTMLFormElement | null
			if (form) {
				submit(form, { method: "post" })
				pendingStepRef.current = targetStepId
			} else {
				onStepChange(targetStepId)
			}
		},
		[submit, onStepChange],
	)

	const currentIndex = getStepIndex(steps, currentStepId)
	const hasPrevious = currentIndex > 0
	const hasNext = currentIndex < steps.length - 1

	const goToPrevious = useCallback(() => {
		if (hasPrevious) {
			navigateToStep(steps[currentIndex - 1].id)
		}
	}, [hasPrevious, steps, currentIndex, navigateToStep])

	const goToNext = useCallback(() => {
		if (hasNext) {
			navigateToStep(steps[currentIndex + 1].id)
		}
	}, [hasNext, steps, currentIndex, navigateToStep])

	return (
		<VStack gap="space-8">
			<HStack gap="space-4" align="center">
				<Heading size="xlarge" level="2">
					{title}
				</Heading>
				<Tag variant={statusVariants[status] ?? "neutral"} size="small">
					{statusLabels[status] ?? status}
				</Tag>
			</HStack>

			<div className={styles.layout}>
				<ReviewWizardStepper
					steps={steps}
					currentStepId={currentStepId}
					completedSteps={completedSteps}
					onStepChange={navigateToStep}
				/>

				<div className={styles.content}>
					<div className={styles.stepCard}>{children}</div>

					<div className={styles.navigation}>
						<Button
							variant="secondary"
							size="small"
							icon={<ArrowLeftIcon aria-hidden />}
							onClick={goToPrevious}
							disabled={!hasPrevious}
						>
							Forrige
						</Button>
						<Button
							variant="secondary"
							size="small"
							iconPosition="right"
							icon={<ArrowRightIcon aria-hidden />}
							onClick={goToNext}
							disabled={!hasNext}
						>
							Neste
						</Button>
					</div>
				</div>
			</div>
		</VStack>
	)
}
