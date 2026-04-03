import { eq, isNull, sql } from "drizzle-orm"
import { db } from "../connection.server"
import { type ComplianceStatus, complianceAssessmentHistory, complianceAssessments } from "../schema/compliance"
import { frameworkControls } from "../schema/framework"
import { screeningAnswers, screeningQuestionEffects, screeningQuestions } from "../schema/screening"
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
) {
	const [q] = await db
		.insert(screeningQuestions)
		.values({ questionText, description, displayOrder, createdBy, updatedBy: createdBy, sectionId: sectionId ?? null })
		.returning()

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
) {
	const [q] = await db
		.update(screeningQuestions)
		.set({ questionText, description, displayOrder, updatedAt: new Date(), updatedBy })
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

// ─── Effects CRUD ────────────────────────────────────────────────────────

export async function getEffectsForQuestion(questionId: string) {
	return db
		.select({
			id: screeningQuestionEffects.id,
			questionId: screeningQuestionEffects.questionId,
			controlId: screeningQuestionEffects.controlId,
			controlTextId: frameworkControls.controlId,
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
	// Resolve control text ID to UUID
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
	answer: boolean | null,
	answeredBy: string,
) {
	// Upsert the answer
	await db
		.insert(screeningAnswers)
		.values({
			applicationId,
			questionId,
			answer,
			answeredBy,
			answeredAt: new Date(),
		})
		.onConflictDoUpdate({
			target: [screeningAnswers.applicationId, screeningAnswers.questionId],
			set: {
				answer,
				answeredBy,
				answeredAt: new Date(),
			},
		})

	await writeAuditLog({
		action: "screening_answer_saved",
		entityType: "screening_answer",
		entityId: `${applicationId}/${questionId}`,
		newValue: answer === null ? "null" : String(answer),
		performedBy: answeredBy,
	})

	// Apply effects
	if (answer !== null) {
		await applyScreeningEffects(applicationId, questionId, answer, answeredBy)
	}
}

/** Apply screening question effects to compliance assessments. */
async function applyScreeningEffects(applicationId: string, questionId: string, answer: boolean, performedBy: string) {
	const effects = await db
		.select()
		.from(screeningQuestionEffects)
		.where(eq(screeningQuestionEffects.questionId, questionId))

	for (const effect of effects) {
		const targetEffect = answer ? effect.yesEffect : effect.noEffect
		const targetComment = answer ? effect.yesComment : effect.noComment

		if (!targetEffect) continue

		// Check existing assessment
		const [existing] = await db
			.select()
			.from(complianceAssessments)
			.where(
				sql`${complianceAssessments.applicationId} = ${applicationId} AND ${complianceAssessments.controlId} = ${effect.controlId}`,
			)
			.limit(1)

		if (existing) {
			// Write history
			await db.insert(complianceAssessmentHistory).values({
				assessmentId: existing.id,
				previousStatus: existing.status,
				newStatus: targetEffect,
				previousComment: existing.comment,
				newComment: targetComment ?? existing.comment,
				changedBy: `screening:${performedBy}`,
			})

			// Update
			await db
				.update(complianceAssessments)
				.set({
					status: targetEffect,
					comment: targetComment ?? existing.comment,
					assessedBy: `screening:${performedBy}`,
					assessedAt: new Date(),
					updatedAt: new Date(),
					updatedBy: performedBy,
				})
				.where(eq(complianceAssessments.id, existing.id))
		} else {
			// Insert new assessment
			const [inserted] = await db
				.insert(complianceAssessments)
				.values({
					applicationId,
					controlId: effect.controlId,
					status: targetEffect,
					comment: targetComment,
					assessedBy: `screening:${performedBy}`,
					assessedAt: new Date(),
					createdBy: performedBy,
					updatedBy: performedBy,
				})
				.returning()

			await db.insert(complianceAssessmentHistory).values({
				assessmentId: inserted.id,
				previousStatus: null,
				newStatus: targetEffect,
				newComment: targetComment,
				changedBy: `screening:${performedBy}`,
			})
		}
	}
}

// ─── Loading all screening data for compliance page ──────────────────────

export interface ScreeningQuestionWithEffects {
	id: string
	questionText: string
	description: string | null
	displayOrder: number
	effects: Array<{
		controlTextId: string
		yesEffect: string | null
		noEffect: string | null
	}>
}

export async function getScreeningDataForApp(applicationId: string) {
	const questions = await getScreeningQuestions()
	const answers = await getScreeningAnswersForApp(applicationId)

	const answerMap = new Map<string, boolean | null>()
	for (const a of answers) {
		answerMap.set(a.questionId, a.answer)
	}

	// Load effects for all questions
	const allEffects = await db
		.select({
			questionId: screeningQuestionEffects.questionId,
			controlTextId: frameworkControls.controlId,
			yesEffect: screeningQuestionEffects.yesEffect,
			noEffect: screeningQuestionEffects.noEffect,
		})
		.from(screeningQuestionEffects)
		.innerJoin(frameworkControls, eq(screeningQuestionEffects.controlId, frameworkControls.id))

	const effectsByQuestion = new Map<string, typeof allEffects>()
	for (const e of allEffects) {
		const list = effectsByQuestion.get(e.questionId) ?? []
		list.push(e)
		effectsByQuestion.set(e.questionId, list)
	}

	return {
		questions: questions.map((q) => ({
			id: q.id,
			questionText: q.questionText,
			description: q.description,
			displayOrder: q.displayOrder,
			answer: answerMap.get(q.id) ?? null,
			effects: effectsByQuestion.get(q.id) ?? [],
		})),
	}
}
