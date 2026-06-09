import { ExternalLinkIcon } from "@navikt/aksel-icons"
import { Alert, BodyShort, Button, Heading, HStack, Tag, VStack } from "@navikt/ds-react"
import { useCallback, useRef } from "react"
import { Form, Link, useFetcher, useParams, useSearchParams } from "react-router"
import type {
	EconomyClassificationData,
	EntraGroupsData,
	OracleRolesData,
	PersistenceEntry,
	RulesetOption,
	ScreeningQuestion,
} from "../shared"
import { isQuestionAnswered, slugify } from "../shared"
import { EconomySystemSection } from "./EconomySystemSection"
import { EntraGroupsSection } from "./EntraGroupsSection"
import { OracleRolesScreeningSection } from "./OracleRolesScreeningSection"
import { PersistenceSection } from "./PersistenceSection"
import {
	ReadOnlyAnswer,
	ReadOnlyEconomy,
	ReadOnlyEntraGroups,
	ReadOnlyOracleRoles,
	ReadOnlyPersistence,
	ReadOnlyRuleset,
} from "./ReadOnlyViews"
import { RulesetSection } from "./RulesetSection"
import { ScreeningAnswerForm } from "./ScreeningAnswerForm"
import { WizardCompletionPage } from "./WizardCompletionPage"
import { WizardStepper } from "./WizardStepper"
import styles from "./wizard.module.css"

function isComplexQuestion(q: ScreeningQuestion) {
	return ["persistence", "entra_id_groups", "oracle_roles"].includes(q.answerType)
}

type Props = {
	screening: ScreeningQuestion[]
	persistence: PersistenceEntry[]
	rulesetOptions: RulesetOption[]
	entraGroupsData: EntraGroupsData
	oracleRolesData: OracleRolesData
	economyClassification: EconomyClassificationData
	canAdmin: boolean
	readOnly?: boolean
	participantsStep?: {
		isActive: boolean
		isDone: boolean
		label: string
		onNavigate: () => void
	}
	participantsContent?: React.ReactNode
	completionAction?: React.ReactNode
	autoSave?: boolean
}

export function ScreeningWizard({
	screening,
	persistence,
	rulesetOptions,
	entraGroupsData,
	oracleRolesData,
	economyClassification,
	canAdmin,
	readOnly,
	participantsStep,
	participantsContent,
	completionAction,
	autoSave,
}: Props) {
	const [searchParams, setSearchParams] = useSearchParams()
	const { seksjon } = useParams<{ seksjon?: string }>()

	const stepParam = searchParams.get("step")
	const isComplete = stepParam === "complete"

	// Determine current question from URL or first unanswered
	const currentQuestion = isComplete
		? null
		: (screening.find((q) => q.id === stepParam) ??
			screening.find((q) => !isQuestionAnswered(q, economyClassification)) ??
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

	const answeredCount = screening.filter((q) => isQuestionAnswered(q, economyClassification)).length

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
		} else if (participantsStep) {
			participantsStep.onNavigate()
		}
	}, [currentIndex, screening, navigateTo, participantsStep])

	const formRef = useRef<HTMLFormElement>(null)
	const fetcher = useFetcher()

	const saveAndNavigate = useCallback(
		(navigate: () => void) => {
			if (!autoSave) {
				navigate()
				return
			}
			if (formRef.current) {
				const formData = new FormData(formRef.current)
				const intent = formData.get("intent")
				if (intent === "update-participants") {
					fetcher.submit(formData, { method: "post" })
				} else if (intent === "save-economy-classification") {
					// Economy: save when user has made a selection (replaces previous staging)
					const isEconomy = formData.get("isEconomySystem")
					if (isEconomy) {
						fetcher.submit(formData, { method: "post" })
					}
				} else if (formData.get("answer") || formData.get("answerComment") || formData.get("answerLink")) {
					fetcher.submit(formData, { method: "post" })
				}
			} else if (currentQuestion && isComplexQuestion(currentQuestion) && currentQuestion.answer !== "confirmed") {
				// Complex questions (persistence/entra/oracle) auto-confirm when the user
				// navigates away, marking that the section has been reviewed. The actual
				// compliance data lives in the inventory tables (persistence entries,
				// groups, roles) — "confirmed" only signals the user visited the step.
				const formData = new FormData()
				formData.set("intent", "screening")
				formData.set("questionId", currentQuestion.id)
				formData.set("answer", "confirmed")
				fetcher.submit(formData, { method: "post" })
			}
			navigate()
		},
		[autoSave, fetcher, currentQuestion],
	)

	const goToNextWithSave = useCallback(() => {
		saveAndNavigate(goToNext)
	}, [saveAndNavigate, goToNext])

	const goToPreviousWithSave = useCallback(() => {
		saveAndNavigate(goToPrevious)
	}, [saveAndNavigate, goToPrevious])

	if (screening.length === 0) {
		return (
			<Alert variant="info" size="small">
				Det er ingen godkjente innledende spørsmål for denne seksjonen ennå.
			</Alert>
		)
	}

	function renderQuestionContent(q: ScreeningQuestion) {
		if (readOnly) {
			if (q.answerType === "persistence") return <ReadOnlyPersistence key={q.id} entries={persistence} />
			if (q.answerType === "entra_id_groups")
				return <ReadOnlyEntraGroups key={q.id} entraGroupsData={entraGroupsData} />
			if (q.answerType === "oracle_roles") return <ReadOnlyOracleRoles key={q.id} oracleRolesData={oracleRolesData} />
			if (q.answerType === "ruleset") return <ReadOnlyRuleset key={q.id} question={q} rulesets={rulesetOptions} />
			if (q.answerType === "economy_system")
				return <ReadOnlyEconomy key={q.id} classification={economyClassification} />
			return <ReadOnlyAnswer key={q.id} question={q} />
		}
		if (q.answerType === "persistence") {
			return <PersistenceSection key={q.id} entries={persistence} />
		}
		if (q.answerType === "entra_id_groups") {
			return <EntraGroupsSection key={q.id} entraGroupsData={entraGroupsData} />
		}
		if (q.answerType === "oracle_roles") {
			return <OracleRolesScreeningSection key={q.id} oracleRolesData={oracleRolesData} canAdmin={canAdmin} />
		}
		if (q.answerType === "ruleset") {
			const filteredRulesets = q.rulesetCategoryFilter
				? rulesetOptions.filter((rs) => rs.category === q.rulesetCategoryFilter)
				: rulesetOptions
			return <RulesetSection key={q.id} question={q} rulesets={filteredRulesets} />
		}
		if (q.answerType === "economy_system") {
			return <EconomySystemSection key={q.id} classification={economyClassification} />
		}
		return <ScreeningAnswerForm key={q.id} question={q} />
	}

	// Show completion page
	if (isComplete) {
		const unansweredQuestions = screening.filter((q) => !isQuestionAnswered(q, economyClassification))
		return (
			<div className={styles.layout}>
				<WizardStepper
					questions={screening}
					currentQuestionId={null}
					isComplete
					economyClassification={economyClassification}
					onNavigate={navigateTo}
					onNavigateComplete={navigateToComplete}
					onSaveAndNavigate={saveAndNavigate}
					participantsStep={participantsStep}
				/>
				<main className={styles.content}>
					<VStack gap="space-6">
						<BodyShort size="small" textColor="subtle">
							{answeredCount} av {screening.length} spørsmål besvart
						</BodyShort>
						{unansweredQuestions.length > 0 ? (
							<VStack gap="space-4">
								<Alert variant="warning" size="small">
									{unansweredQuestions.length === 1
										? "1 spørsmål gjenstår før du kan fullføre screeningen:"
										: `${unansweredQuestions.length} spørsmål gjenstår før du kan fullføre screeningen:`}
								</Alert>
								<VStack gap="space-2" as="ul" style={{ listStyle: "none", padding: 0, margin: 0 }}>
									{unansweredQuestions.map((q) => (
										<li key={q.id}>
											<Button type="button" variant="tertiary" size="small" onClick={() => navigateTo(q.id)}>
												{q.questionText}
											</Button>
										</li>
									))}
								</VStack>
							</VStack>
						) : (
							<>
								<WizardCompletionPage
									questions={screening}
									rulesetOptions={rulesetOptions}
									economyClassification={economyClassification}
									readOnly={readOnly}
									onNavigateToQuestion={navigateTo}
								/>
								{!readOnly && completionAction}
							</>
						)}
					</VStack>
				</main>
			</div>
		)
	}

	if (!currentQuestion) return null

	// Show participants step content within the wizard layout
	if (participantsStep?.isActive && participantsContent) {
		return (
			<div className={styles.layout}>
				<WizardStepper
					questions={screening}
					currentQuestionId={null}
					economyClassification={economyClassification}
					onNavigate={navigateTo}
					onNavigateComplete={navigateToComplete}
					onSaveAndNavigate={saveAndNavigate}
					participantsStep={participantsStep}
				/>
				<main className={styles.content}>
					<VStack gap="space-6">
						<BodyShort size="small" textColor="subtle">
							{answeredCount} av {screening.length} spørsmål besvart
						</BodyShort>
						{autoSave ? (
							<Form method="post" ref={formRef}>
								<input type="hidden" name="intent" value="update-participants" />
								{participantsContent}
							</Form>
						) : (
							participantsContent
						)}
						<nav className={styles.navigation} aria-label="Spørsmålsnavigasjon">
							<span />
							<Button
								type="button"
								variant="secondary"
								size="small"
								onClick={() => {
									if (autoSave && formRef.current) {
										const formData = new FormData(formRef.current)
										fetcher.submit(formData, { method: "post" })
									}
									navigateTo(screening[0].id)
								}}
							>
								Neste →
							</Button>
						</nav>
					</VStack>
				</main>
			</div>
		)
	}

	return (
		<div className={styles.layout}>
			<WizardStepper
				questions={screening}
				currentQuestionId={currentQuestion.id}
				economyClassification={economyClassification}
				onNavigate={navigateTo}
				onNavigateComplete={navigateToComplete}
				onSaveAndNavigate={saveAndNavigate}
				participantsStep={participantsStep}
			/>

			<main className={styles.content}>
				<VStack gap="space-6">
					<BodyShort size="small" textColor="subtle">
						{answeredCount} av {screening.length} spørsmål besvart
					</BodyShort>

					<div id={`q-${slugify(currentQuestion.questionText)}`}>
						<VStack gap="space-4">
							<HStack align="center" gap="space-2">
								<Heading size="small" level="3">
									{currentQuestion.questionText}
								</Heading>
								{seksjon && currentQuestion.sectionId && (
									<Link
										to={`/seksjoner/${seksjon}/screening/${currentQuestion.id}`}
										target="_blank"
										rel="noopener noreferrer"
										title="Vis spørsmålsdetaljer"
										style={{ color: "var(--ax-text-subtle)", display: "flex", alignItems: "center" }}
									>
										<ExternalLinkIcon aria-hidden fontSize="1rem" />
									</Link>
								)}
							</HStack>
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

							{autoSave && !readOnly ? (
								isComplexQuestion(currentQuestion) ? (
									renderQuestionContent(currentQuestion)
								) : (
									<Form method="post" ref={formRef}>
										<input
											type="hidden"
											name="intent"
											value={
												currentQuestion.answerType === "economy_system" ? "save-economy-classification" : "screening"
											}
										/>
										<input type="hidden" name="questionId" value={currentQuestion.id} />
										{renderQuestionContent(currentQuestion)}
									</Form>
								)
							) : (
								renderQuestionContent(currentQuestion)
							)}
						</VStack>
					</div>

					<nav className={styles.navigation} aria-label="Spørsmålsnavigasjon">
						<Button
							type="button"
							variant="secondary"
							size="small"
							onClick={autoSave ? goToPreviousWithSave : goToPrevious}
							disabled={currentIndex === 0 && !participantsStep}
						>
							← Forrige
						</Button>
						<Button type="button" variant="secondary" size="small" onClick={autoSave ? goToNextWithSave : goToNext}>
							Neste →
						</Button>
					</nav>
				</VStack>
			</main>
		</div>
	)
}
