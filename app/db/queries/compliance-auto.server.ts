/**
 * Batch queries for automatic compliance status computation.
 *
 * These are designed to be called once per app, returning data
 * grouped by control for efficient auto-status derivation.
 */
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm"
import { db } from "../connection.server"
import { applicationEnvironments, naisTeams } from "../schema/applications"
import { applicationTechnologyElements } from "../schema/framework"
import {
	screeningAnswers,
	screeningChoiceEffects,
	screeningQuestionChoices,
	screeningQuestions,
	screeningQuestionTechnologyElements,
} from "../schema/screening"

/** Build a composite key for screening effects: "controlId:techElementId" or "controlId:all". */
export function screeningKey(controlId: string, techElementId: string): string {
	return `${controlId}:${techElementId}`
}

/** Sentinel value used as the tech element part of a screening key for global questions. */
export const TECH_ELEMENT_ALL = "all" as const

/**
 * For each control that has screening choice effects, get the applicable
 * screening status for an application.
 *
 * Returns a map keyed by "controlId:techElementId" (for tech-scoped questions)
 * or "controlId:all" (for global questions without tech element constraints).
 */
export async function getScreeningEffectsByControlForApp(applicationId: string) {
	// 1. Get app's confirmed tech elements
	const appTechRows = await db
		.select({ elementId: applicationTechnologyElements.elementId })
		.from(applicationTechnologyElements)
		.where(
			and(
				eq(applicationTechnologyElements.applicationId, applicationId),
				isNull(applicationTechnologyElements.archivedAt),
				isNotNull(applicationTechnologyElements.confirmedAt),
				isNull(applicationTechnologyElements.rejectedAt),
			),
		)
	const appTechElementIds = new Set(appTechRows.map((r) => r.elementId))

	// 2. Find app's section IDs
	const sectionRows = await db
		.selectDistinct({ sectionId: naisTeams.sectionId })
		.from(applicationEnvironments)
		.innerJoin(naisTeams, eq(applicationEnvironments.naisTeamId, naisTeams.id))
		.where(and(eq(applicationEnvironments.applicationId, applicationId), isNotNull(naisTeams.sectionId)))
	const sectionIds = sectionRows.map((r) => r.sectionId).filter((id): id is string => id !== null)

	// 3. Load all applicable questions (global + section-scoped, kun aktive)
	const globalQuestions = await db
		.select()
		.from(screeningQuestions)
		.where(and(isNull(screeningQuestions.sectionId), isNull(screeningQuestions.archivedAt)))
	let sectionQuestions: typeof globalQuestions = []
	if (sectionIds.length > 0) {
		sectionQuestions = await db
			.select()
			.from(screeningQuestions)
			.where(and(inArray(screeningQuestions.sectionId, sectionIds), isNull(screeningQuestions.archivedAt)))
	}
	const allQuestions = [...globalQuestions, ...sectionQuestions]
	if (allQuestions.length === 0) return new Map<string, ScreeningEffectsForControl>()

	const questionIds = allQuestions.map((q) => q.id)

	// 4. Filter by tech elements (questions without tech links apply to all)
	const techLinks = await db
		.select()
		.from(screeningQuestionTechnologyElements)
		.where(
			and(
				inArray(screeningQuestionTechnologyElements.questionId, questionIds),
				isNull(screeningQuestionTechnologyElements.archivedAt),
			),
		)
	const techByQuestion = new Map<string, string[]>()
	for (const link of techLinks) {
		const list = techByQuestion.get(link.questionId) ?? []
		list.push(link.elementId)
		techByQuestion.set(link.questionId, list)
	}
	const applicableQuestionIds = new Set(
		allQuestions
			.filter((q) => {
				const required = techByQuestion.get(q.id)
				if (!required || required.length === 0) return true
				return required.some((elId) => appTechElementIds.has(elId))
			})
			.map((q) => q.id),
	)

	// 5. Load answers for applicable questions
	const answers = await db.select().from(screeningAnswers).where(eq(screeningAnswers.applicationId, applicationId))
	const answerByQuestion = new Map<string, string>()
	for (const a of answers) {
		if (a.answer && applicableQuestionIds.has(a.questionId)) {
			answerByQuestion.set(a.questionId, a.answer)
		}
	}

	// 6. Load choices for applicable questions (kun aktive)
	const allChoices = await db
		.select()
		.from(screeningQuestionChoices)
		.where(
			and(
				inArray(screeningQuestionChoices.questionId, [...applicableQuestionIds]),
				isNull(screeningQuestionChoices.archivedAt),
			),
		)
	const choicesByQuestion = new Map<string, typeof allChoices>()
	for (const c of allChoices) {
		const list = choicesByQuestion.get(c.questionId) ?? []
		list.push(c)
		choicesByQuestion.set(c.questionId, list)
	}

	// 7. Load all choice effects (kun aktive)
	const choiceIds = allChoices.map((c) => c.id)
	const allEffects =
		choiceIds.length > 0
			? await db
					.select({
						choiceId: screeningChoiceEffects.choiceId,
						controlId: screeningChoiceEffects.controlId,
						effect: screeningChoiceEffects.effect,
					})
					.from(screeningChoiceEffects)
					.where(and(inArray(screeningChoiceEffects.choiceId, choiceIds), isNull(screeningChoiceEffects.archivedAt)))
			: []

	// 8. Build: for each question, which choice did the app select, and what effects does it produce?
	// Group by composite key "controlId:techElementId" or "controlId:all" (for global questions).
	const result = new Map<string, ScreeningEffectsForControl>()

	// Build question title lookup
	const questionTitleById = new Map<string, string>()
	for (const q of allQuestions) {
		questionTitleById.set(q.id, q.questionText)
	}

	// Map: choiceId → effects
	const effectsByChoice = new Map<string, typeof allEffects>()
	for (const e of allEffects) {
		const list = effectsByChoice.get(e.choiceId) ?? []
		list.push(e)
		effectsByChoice.set(e.choiceId, list)
	}

	// For each question, determine what the answer means for each control,
	// scoped by the question's technology elements.
	for (const questionId of applicableQuestionIds) {
		const choices = choicesByQuestion.get(questionId) ?? []
		const answerValue = answerByQuestion.get(questionId)
		const questionTechElements = techByQuestion.get(questionId) ?? []

		for (const choice of choices) {
			const effects = effectsByChoice.get(choice.id) ?? []
			for (const effect of effects) {
				if (!effect.effect || effect.effect === "select_routine") continue

				// Determine composite keys: scope effects to the question's tech elements
				let keys: string[]
				if (questionTechElements.length === 0) {
					keys = [screeningKey(effect.controlId, TECH_ELEMENT_ALL)]
				} else {
					// Only create keys for tech elements the app actually has
					keys = questionTechElements
						.filter((te) => appTechElementIds.has(te))
						.map((te) => screeningKey(effect.controlId, te))
				}

				for (const key of keys) {
					const entry = result.get(key) ?? {
						effects: [],
						allQuestionsAnswered: true,
						hasQuestions: true,
						details: [],
					}
					entry.hasQuestions = true

					if (answerValue === choice.label) {
						entry.effects.push(effect.effect)
						entry.details.push({
							questionId,
							questionTitle: questionTitleById.get(questionId) ?? questionId,
							answer: answerValue,
							effect: effect.effect,
						})
					}

					// Track whether all questions that affect this control are answered
					if (!answerValue) {
						entry.allQuestionsAnswered = false
					}

					result.set(key, entry)
				}
			}
		}
	}

	return result
}

export interface ScreeningEffectsForControl {
	/** The active screening effects for this control (from answered questions) */
	effects: string[]
	/** Whether ALL screening questions that affect this control have been answered */
	allQuestionsAnswered: boolean
	/** Whether any screening questions target this control */
	hasQuestions: boolean
	/** Details about which questions/answers produced the effects */
	details: ScreeningEffectDetail[]
}

export interface ScreeningEffectDetail {
	questionId: string
	questionTitle: string
	answer: string
	effect: string
}
