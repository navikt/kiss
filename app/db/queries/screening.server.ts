import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm"
import { db } from "../connection.server"
import { applicationEnvironments, naisTeams } from "../schema/applications"
import { type ComplianceStatus, complianceAssessmentHistory, complianceAssessments } from "../schema/compliance"
import { applicationTechnologyElements, frameworkControls } from "../schema/framework"
import { routineControls, routines } from "../schema/routines"
import {
	screeningAnswers,
	screeningChoiceEffects,
	screeningQuestionChoices,
	screeningQuestionEffects,
	screeningQuestions,
	screeningQuestionTechnologyElements,
	screeningRoutineSelections,
} from "../schema/screening"
import { writeAuditLog } from "./audit.server"

// ─── Questions CRUD ──────────────────────────────────────────────────────

export async function getScreeningQuestions() {
	return db
		.select()
		.from(screeningQuestions)
		.where(isNull(screeningQuestions.sectionId))
		.orderBy(screeningQuestions.displayOrder)
}

/** Get screening questions scoped to a section. */
export async function getSectionScreeningQuestions(sectionId: string) {
	return db
		.select()
		.from(screeningQuestions)
		.where(eq(screeningQuestions.sectionId, sectionId))
		.orderBy(screeningQuestions.displayOrder)
}

export async function getScreeningQuestion(id: string) {
	const [q] = await db.select().from(screeningQuestions).where(eq(screeningQuestions.id, id)).limit(1)
	return q ?? null
}

export async function createScreeningQuestion(
	questionText: string,
	description: string | null,
	displayOrder: number,
	createdBy: string,
	sectionId?: string | null,
	answerType = "boolean",
	rulesetId?: string | null,
) {
	const [q] = await db
		.insert(screeningQuestions)
		.values({
			questionText,
			description,
			displayOrder,
			createdBy,
			updatedBy: createdBy,
			sectionId: sectionId ?? null,
			answerType,
			rulesetId: rulesetId ?? null,
		})
		.returning()

	// Auto-create default choices for boolean questions
	if (answerType === "boolean") {
		await db.insert(screeningQuestionChoices).values([
			{ questionId: q.id, label: "Ja", displayOrder: 0 },
			{ questionId: q.id, label: "Nei", displayOrder: 1 },
		])
	}

	await writeAuditLog({
		action: "screening_question_created",
		entityType: "screening_question",
		entityId: q.id,
		newValue: questionText,
		performedBy: createdBy,
	})

	return q
}

export async function updateScreeningQuestion(
	id: string,
	questionText: string,
	description: string | null,
	displayOrder: number,
	updatedBy: string,
	rulesetId?: string | null,
) {
	const [q] = await db
		.update(screeningQuestions)
		.set({ questionText, description, displayOrder, updatedAt: new Date(), updatedBy, rulesetId: rulesetId ?? null })
		.where(eq(screeningQuestions.id, id))
		.returning()

	await writeAuditLog({
		action: "screening_question_updated",
		entityType: "screening_question",
		entityId: id,
		newValue: questionText,
		performedBy: updatedBy,
	})

	return q
}

export async function reorderScreeningQuestions(orderedIds: string[], performedBy: string) {
	for (let i = 0; i < orderedIds.length; i++) {
		await db
			.update(screeningQuestions)
			.set({ displayOrder: i, updatedAt: new Date(), updatedBy: performedBy })
			.where(eq(screeningQuestions.id, orderedIds[i]))
	}

	await writeAuditLog({
		action: "screening_question_updated",
		entityType: "screening_question",
		entityId: orderedIds.join(","),
		newValue: `Reordered: ${orderedIds.join(", ")}`,
		performedBy,
	})
}

export async function deleteScreeningQuestion(id: string, performedBy: string) {
	await db.delete(screeningQuestions).where(eq(screeningQuestions.id, id))

	await writeAuditLog({
		action: "screening_question_deleted",
		entityType: "screening_question",
		entityId: id,
		performedBy,
	})
}

// ─── Question Technology Elements ────────────────────────────────────────

export async function getQuestionTechnologyElements(questionId: string) {
	return db
		.select({ elementId: screeningQuestionTechnologyElements.elementId })
		.from(screeningQuestionTechnologyElements)
		.where(eq(screeningQuestionTechnologyElements.questionId, questionId))
}

export async function setQuestionTechnologyElements(questionId: string, elementIds: string[]) {
	await db
		.delete(screeningQuestionTechnologyElements)
		.where(eq(screeningQuestionTechnologyElements.questionId, questionId))

	if (elementIds.length > 0) {
		await db
			.insert(screeningQuestionTechnologyElements)
			.values(elementIds.map((elementId) => ({ questionId, elementId })))
	}
}

// ─── Choices CRUD ────────────────────────────────────────────────────────

export async function getChoicesForQuestion(questionId: string) {
	return db
		.select()
		.from(screeningQuestionChoices)
		.where(eq(screeningQuestionChoices.questionId, questionId))
		.orderBy(screeningQuestionChoices.displayOrder)
}

export async function createChoice(params: {
	questionId: string
	label: string
	requiresComment?: boolean
	requiresLink?: boolean
	displayOrder?: number
}) {
	const [choice] = await db
		.insert(screeningQuestionChoices)
		.values({
			questionId: params.questionId,
			label: params.label,
			requiresComment: params.requiresComment ?? false,
			requiresLink: params.requiresLink ?? false,
			displayOrder: params.displayOrder ?? 0,
		})
		.returning()
	return choice
}

export async function updateChoice(
	choiceId: string,
	params: { label?: string; requiresComment?: boolean; requiresLink?: boolean },
) {
	const [choice] = await db
		.update(screeningQuestionChoices)
		.set(params)
		.where(eq(screeningQuestionChoices.id, choiceId))
		.returning()
	return choice
}

export async function deleteChoice(choiceId: string) {
	await db.delete(screeningQuestionChoices).where(eq(screeningQuestionChoices.id, choiceId))
}

export async function reorderChoices(orderedIds: string[]) {
	for (let i = 0; i < orderedIds.length; i++) {
		await db
			.update(screeningQuestionChoices)
			.set({ displayOrder: i })
			.where(eq(screeningQuestionChoices.id, orderedIds[i]))
	}
}

// ─── Choice Effects CRUD ─────────────────────────────────────────────────

export async function getChoiceEffects(choiceId: string) {
	return db
		.select({
			id: screeningChoiceEffects.id,
			choiceId: screeningChoiceEffects.choiceId,
			controlId: screeningChoiceEffects.controlId,
			controlTextId: frameworkControls.controlId,
			controlName: frameworkControls.shortTitle,
			effect: screeningChoiceEffects.effect,
			comment: screeningChoiceEffects.comment,
		})
		.from(screeningChoiceEffects)
		.innerJoin(frameworkControls, eq(screeningChoiceEffects.controlId, frameworkControls.id))
		.where(eq(screeningChoiceEffects.choiceId, choiceId))
		.orderBy(frameworkControls.controlId)
}

export async function addChoiceEffect(params: {
	choiceId: string
	controlTextId: string
	effect: string | null
	comment: string | null
}) {
	const [ctrl] = await db
		.select({ id: frameworkControls.id })
		.from(frameworkControls)
		.where(eq(frameworkControls.controlId, params.controlTextId))
		.limit(1)

	if (!ctrl) throw new Error(`Kontroll ${params.controlTextId} ikke funnet`)

	const [eff] = await db
		.insert(screeningChoiceEffects)
		.values({
			choiceId: params.choiceId,
			controlId: ctrl.id,
			effect: (params.effect as ComplianceStatus) || null,
			comment: params.comment || null,
		})
		.returning()

	return eff
}

export async function deleteChoiceEffect(effectId: string) {
	await db.delete(screeningChoiceEffects).where(eq(screeningChoiceEffects.id, effectId))
}

// ─── Legacy Effects (kept during migration) ──────────────────────────────

export async function getEffectsForQuestion(questionId: string) {
	return db
		.select({
			id: screeningQuestionEffects.id,
			questionId: screeningQuestionEffects.questionId,
			controlId: screeningQuestionEffects.controlId,
			controlTextId: frameworkControls.controlId,
			controlName: frameworkControls.shortTitle,
			yesEffect: screeningQuestionEffects.yesEffect,
			noEffect: screeningQuestionEffects.noEffect,
			yesComment: screeningQuestionEffects.yesComment,
			noComment: screeningQuestionEffects.noComment,
		})
		.from(screeningQuestionEffects)
		.innerJoin(frameworkControls, eq(screeningQuestionEffects.controlId, frameworkControls.id))
		.where(eq(screeningQuestionEffects.questionId, questionId))
		.orderBy(frameworkControls.controlId)
}

export async function addEffect(params: {
	questionId: string
	controlTextId: string
	yesEffect: string | null
	noEffect: string | null
	yesComment: string | null
	noComment: string | null
}) {
	const [ctrl] = await db
		.select({ id: frameworkControls.id })
		.from(frameworkControls)
		.where(eq(frameworkControls.controlId, params.controlTextId))
		.limit(1)

	if (!ctrl) throw new Error(`Kontroll ${params.controlTextId} ikke funnet`)

	const [effect] = await db
		.insert(screeningQuestionEffects)
		.values({
			questionId: params.questionId,
			controlId: ctrl.id,
			yesEffect: (params.yesEffect as ComplianceStatus) || null,
			noEffect: (params.noEffect as ComplianceStatus) || null,
			yesComment: params.yesComment || null,
			noComment: params.noComment || null,
		})
		.returning()

	return effect
}

export async function deleteEffect(effectId: string) {
	await db.delete(screeningQuestionEffects).where(eq(screeningQuestionEffects.id, effectId))
}

// ─── Answers ─────────────────────────────────────────────────────────────

export async function getScreeningAnswersForApp(applicationId: string) {
	return db.select().from(screeningAnswers).where(eq(screeningAnswers.applicationId, applicationId))
}

/** Save a screening answer and auto-apply effects to compliance assessments. */
export async function saveScreeningAnswer(
	applicationId: string,
	questionId: string,
	answer: string | null,
	answeredBy: string,
	answerComment?: string | null,
	answerLink?: string | null,
) {
	await db
		.insert(screeningAnswers)
		.values({
			applicationId,
			questionId,
			answer,
			comment: answerComment ?? null,
			link: answerLink ?? null,
			answeredBy,
			answeredAt: new Date(),
		})
		.onConflictDoUpdate({
			target: [screeningAnswers.applicationId, screeningAnswers.questionId],
			set: {
				answer,
				comment: answerComment ?? null,
				link: answerLink ?? null,
				answeredBy,
				answeredAt: new Date(),
			},
		})

	await writeAuditLog({
		action: "screening_answer_saved",
		entityType: "screening_answer",
		entityId: `${applicationId}/${questionId}`,
		newValue: answer ?? "null",
		performedBy: answeredBy,
	})

	// Apply effects
	if (answer !== null) {
		await applyChoiceEffects(applicationId, questionId, answer, answeredBy)
	}
}

/** Apply choice-based effects to compliance assessments. */
async function applyChoiceEffects(applicationId: string, questionId: string, answerValue: string, performedBy: string) {
	// Find the choice matching the answer
	const [choice] = await db
		.select({ id: screeningQuestionChoices.id })
		.from(screeningQuestionChoices)
		.where(
			sql`${screeningQuestionChoices.questionId} = ${questionId} AND ${screeningQuestionChoices.label} = ${answerValue}`,
		)
		.limit(1)

	if (!choice) return

	// Get effects for this choice
	const effects = await db.select().from(screeningChoiceEffects).where(eq(screeningChoiceEffects.choiceId, choice.id))

	for (const effect of effects) {
		if (!effect.effect || effect.effect === "select_routine") continue

		const [existing] = await db
			.select()
			.from(complianceAssessments)
			.where(
				sql`${complianceAssessments.applicationId} = ${applicationId} AND ${complianceAssessments.controlId} = ${effect.controlId}`,
			)
			.limit(1)

		if (existing) {
			await db.insert(complianceAssessmentHistory).values({
				assessmentId: existing.id,
				previousStatus: existing.status,
				newStatus: effect.effect,
				previousComment: existing.comment,
				newComment: effect.comment ?? existing.comment,
				changedBy: `screening:${performedBy}`,
			})

			await db
				.update(complianceAssessments)
				.set({
					status: effect.effect,
					comment: effect.comment ?? existing.comment,
					assessedBy: `screening:${performedBy}`,
					assessedAt: new Date(),
					updatedAt: new Date(),
					updatedBy: performedBy,
				})
				.where(eq(complianceAssessments.id, existing.id))
		} else {
			const [inserted] = await db
				.insert(complianceAssessments)
				.values({
					applicationId,
					controlId: effect.controlId,
					status: effect.effect,
					comment: effect.comment,
					assessedBy: `screening:${performedBy}`,
					assessedAt: new Date(),
					createdBy: performedBy,
					updatedBy: performedBy,
				})
				.returning()

			await db.insert(complianceAssessmentHistory).values({
				assessmentId: inserted.id,
				previousStatus: null,
				newStatus: effect.effect,
				newComment: effect.comment,
				changedBy: `screening:${performedBy}`,
			})
		}
	}
}

// ─── Loading all screening data for compliance page ──────────────────────

export async function getScreeningDataForApp(applicationId: string) {
	// Get global questions + section-scoped questions for the app's section(s)
	const globalQuestions = await getScreeningQuestions()

	// Find section IDs for this app via its nais team environments
	const sectionRows = await db
		.selectDistinct({ sectionId: naisTeams.sectionId })
		.from(applicationEnvironments)
		.innerJoin(naisTeams, eq(applicationEnvironments.naisTeamId, naisTeams.id))
		.where(and(eq(applicationEnvironments.applicationId, applicationId), isNotNull(naisTeams.sectionId)))

	const sectionIds = sectionRows.map((r) => r.sectionId).filter((id): id is string => id !== null)

	let sectionQuestions: Awaited<ReturnType<typeof getScreeningQuestions>> = []
	if (sectionIds.length > 0) {
		sectionQuestions = await db
			.select()
			.from(screeningQuestions)
			.where(inArray(screeningQuestions.sectionId, sectionIds))
			.orderBy(screeningQuestions.displayOrder)
	}

	const allQuestions = [...globalQuestions, ...sectionQuestions]

	// Load technology element links for all questions
	const allQuestionTechLinks =
		allQuestions.length > 0
			? await db
					.select()
					.from(screeningQuestionTechnologyElements)
					.where(
						inArray(
							screeningQuestionTechnologyElements.questionId,
							allQuestions.map((q) => q.id),
						),
					)
			: []

	const techElementsByQuestion = new Map<string, string[]>()
	for (const link of allQuestionTechLinks) {
		const list = techElementsByQuestion.get(link.questionId) ?? []
		list.push(link.elementId)
		techElementsByQuestion.set(link.questionId, list)
	}

	// Get app's technology element IDs for filtering
	const appTechRows = await db
		.select({ elementId: applicationTechnologyElements.elementId })
		.from(applicationTechnologyElements)
		.where(eq(applicationTechnologyElements.applicationId, applicationId))
	const appTechElementIds = new Set(appTechRows.map((r) => r.elementId))

	// Filter: include questions with no tech links (apply to all) or matching at least one app tech element
	const questions = allQuestions.filter((q) => {
		const requiredElements = techElementsByQuestion.get(q.id)
		if (!requiredElements || requiredElements.length === 0) return true
		return requiredElements.some((elId) => appTechElementIds.has(elId))
	})

	const answers = await getScreeningAnswersForApp(applicationId)

	const answerMap = new Map<
		string,
		{
			answer: string | null
			comment: string | null
			link: string | null
			answeredBy: string | null
			answeredAt: Date | null
		}
	>()
	for (const a of answers) {
		answerMap.set(a.questionId, {
			answer: a.answer,
			comment: a.comment,
			link: a.link,
			answeredBy: a.answeredBy,
			answeredAt: a.answeredAt,
		})
	}

	// Load choices for all questions
	const allChoices = await db.select().from(screeningQuestionChoices).orderBy(screeningQuestionChoices.displayOrder)

	const choicesByQuestion = new Map<string, (typeof allChoices)[number][]>()
	for (const c of allChoices) {
		const list = choicesByQuestion.get(c.questionId) ?? []
		list.push(c)
		choicesByQuestion.set(c.questionId, list)
	}

	// Load choice effects for displaying affected controls
	const allChoiceEffects = await db
		.select({
			id: screeningChoiceEffects.id,
			choiceId: screeningChoiceEffects.choiceId,
			controlId: screeningChoiceEffects.controlId,
			controlTextId: frameworkControls.controlId,
			effect: screeningChoiceEffects.effect,
		})
		.from(screeningChoiceEffects)
		.innerJoin(frameworkControls, eq(screeningChoiceEffects.controlId, frameworkControls.id))

	const effectsByChoice = new Map<string, (typeof allChoiceEffects)[number][]>()
	for (const e of allChoiceEffects) {
		const list = effectsByChoice.get(e.choiceId) ?? []
		list.push(e)
		effectsByChoice.set(e.choiceId, list)
	}

	// Collect control UUIDs that have select_routine effects to load routine options
	const selectRoutineControlIds = new Set<string>()
	const selectRoutineEffectIds = new Set<string>()
	for (const effects of effectsByChoice.values()) {
		for (const e of effects) {
			if (e.effect === "select_routine") {
				selectRoutineControlIds.add(e.controlId)
				selectRoutineEffectIds.add(e.id)
			}
		}
	}

	// Load routines linked to these controls via routineControls
	const routineOptionsByControl = new Map<string, Array<{ id: string; name: string; sectionId: string }>>()
	if (selectRoutineControlIds.size > 0) {
		const linkedRoutines = await db
			.select({
				controlId: routineControls.controlId,
				routineId: routines.id,
				routineName: routines.name,
				sectionId: routines.sectionId,
			})
			.from(routineControls)
			.innerJoin(routines, eq(routineControls.routineId, routines.id))
			.where(inArray(routineControls.controlId, [...selectRoutineControlIds]))

		for (const lr of linkedRoutines) {
			const list = routineOptionsByControl.get(lr.controlId) ?? []
			list.push({ id: lr.routineId, name: lr.routineName, sectionId: lr.sectionId })
			routineOptionsByControl.set(lr.controlId, list)
		}
	}

	// Load existing routine selections for this app
	const existingSelections = new Map<string, string | null>()
	if (selectRoutineEffectIds.size > 0) {
		const selections = await db
			.select()
			.from(screeningRoutineSelections)
			.where(
				and(
					eq(screeningRoutineSelections.applicationId, applicationId),
					inArray(screeningRoutineSelections.choiceEffectId, [...selectRoutineEffectIds]),
				),
			)
		for (const s of selections) {
			existingSelections.set(s.choiceEffectId, s.routineId)
		}
	}

	return {
		sectionIds,
		questions: questions.map((q) => {
			const saved = answerMap.get(q.id)
			const choices = choicesByQuestion.get(q.id) ?? []
			// Collect unique control IDs affected by any choice
			const affectedControls = new Set<string>()
			for (const c of choices) {
				for (const e of effectsByChoice.get(c.id) ?? []) {
					affectedControls.add(e.controlTextId)
				}
			}

			// Build select_routine effects per choice
			const choicesWithRoutines = choices.map((c) => {
				const effects = effectsByChoice.get(c.id) ?? []
				const routineSelections = effects
					.filter((e) => e.effect === "select_routine")
					.map((e) => ({
						effectId: e.id,
						controlTextId: e.controlTextId,
						routines: routineOptionsByControl.get(e.controlId) ?? [],
						selectedRoutineId: existingSelections.get(e.id) ?? null,
					}))

				return {
					id: c.id,
					label: c.label,
					requiresComment: c.requiresComment,
					requiresLink: c.requiresLink,
					routineSelections,
				}
			})

			return {
				id: q.id,
				questionText: q.questionText,
				description: q.description,
				displayOrder: q.displayOrder,
				answerType: q.answerType,
				answer: saved?.answer ?? null,
				answerComment: saved?.comment ?? null,
				answerLink: saved?.link ?? null,
				answeredBy: saved?.answeredBy ?? null,
				answeredAt: saved?.answeredAt?.toISOString() ?? null,
				choices: choicesWithRoutines,
				affectedControls: [...affectedControls],
			}
		}),
	}
}

// ─── Screening routine selections ────────────────────────────────────────

export async function saveRoutineSelection(
	applicationId: string,
	choiceEffectId: string,
	routineId: string | null,
	selectedBy: string,
) {
	await db
		.insert(screeningRoutineSelections)
		.values({
			applicationId,
			choiceEffectId,
			routineId,
			selectedBy,
			selectedAt: new Date(),
		})
		.onConflictDoUpdate({
			target: [screeningRoutineSelections.applicationId, screeningRoutineSelections.choiceEffectId],
			set: {
				routineId,
				selectedBy,
				selectedAt: new Date(),
			},
		})

	await writeAuditLog({
		action: "screening_routine_selected",
		entityType: "screening_routine_selection",
		entityId: `${applicationId}/${choiceEffectId}`,
		newValue: routineId ?? "null",
		performedBy: selectedBy,
	})
}

/** Get all routine selections for an app (for the routines tab). */
export async function getRoutineSelectionsForApp(applicationId: string) {
	return db
		.select({
			routineId: screeningRoutineSelections.routineId,
			effectId: screeningRoutineSelections.choiceEffectId,
			controlTextId: frameworkControls.controlId,
		})
		.from(screeningRoutineSelections)
		.innerJoin(screeningChoiceEffects, eq(screeningRoutineSelections.choiceEffectId, screeningChoiceEffects.id))
		.innerJoin(frameworkControls, eq(screeningChoiceEffects.controlId, frameworkControls.id))
		.where(
			and(eq(screeningRoutineSelections.applicationId, applicationId), isNotNull(screeningRoutineSelections.routineId)),
		)
}
