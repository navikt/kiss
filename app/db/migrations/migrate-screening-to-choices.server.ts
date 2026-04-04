/**
 * Migration: Convert legacy screening effects to choice-based model.
 *
 * For each existing boolean question:
 * 1. Create "Ja" and "Nei" choices
 * 2. Convert screeningQuestionEffects rows → screeningChoiceEffects
 * 3. Convert boolean answers (true/false) → text answers ("ja"/"nei")
 *
 * This is idempotent: it checks for existing choices before creating.
 */
import { eq, sql } from "drizzle-orm"
import { db } from "../connection.server"
import {
	screeningAnswers,
	screeningChoiceEffects,
	screeningQuestionChoices,
	screeningQuestionEffects,
	screeningQuestions,
} from "../schema/screening"

export async function migrateScreeningToChoices() {
	const questions = await db.select().from(screeningQuestions)

	const results = {
		questionsProcessed: 0,
		choicesCreated: 0,
		effectsMigrated: 0,
		answersMigrated: 0,
		skipped: 0,
	}

	for (const question of questions) {
		// Check if choices already exist for this question
		const existingChoices = await db
			.select()
			.from(screeningQuestionChoices)
			.where(eq(screeningQuestionChoices.questionId, question.id))

		if (existingChoices.length > 0) {
			results.skipped++
			continue
		}

		// Create default Ja/Nei choices for boolean questions
		const [jaChoice] = await db
			.insert(screeningQuestionChoices)
			.values({ questionId: question.id, value: "ja", label: "Ja", displayOrder: 0 })
			.returning()

		const [neiChoice] = await db
			.insert(screeningQuestionChoices)
			.values({ questionId: question.id, value: "nei", label: "Nei", displayOrder: 1 })
			.returning()

		results.choicesCreated += 2

		// Migrate legacy effects to choice-based effects
		const legacyEffects = await db
			.select()
			.from(screeningQuestionEffects)
			.where(eq(screeningQuestionEffects.questionId, question.id))

		for (const effect of legacyEffects) {
			if (effect.yesEffect) {
				await db.insert(screeningChoiceEffects).values({
					choiceId: jaChoice.id,
					controlId: effect.controlId,
					effect: effect.yesEffect,
					comment: effect.yesComment,
				})
				results.effectsMigrated++
			}
			if (effect.noEffect) {
				await db.insert(screeningChoiceEffects).values({
					choiceId: neiChoice.id,
					controlId: effect.controlId,
					effect: effect.noEffect,
					comment: effect.noComment,
				})
				results.effectsMigrated++
			}
		}

		// Set answer_type to 'boolean' (should already be default)
		await db.update(screeningQuestions).set({ answerType: "boolean" }).where(eq(screeningQuestions.id, question.id))

		results.questionsProcessed++
	}

	// Migrate boolean answers to text
	// Use raw SQL since we're converting types
	const booleanAnswers = await db.execute(
		sql`SELECT id, answer FROM screening_answers WHERE answer IS NOT NULL AND answer::text IN ('true', 'false')`,
	)

	if (Array.isArray(booleanAnswers) && booleanAnswers.length > 0) {
		for (const row of booleanAnswers as Array<{ id: string; answer: string }>) {
			const textValue = String(row.answer) === "true" ? "ja" : "nei"
			await db.update(screeningAnswers).set({ answer: textValue }).where(eq(screeningAnswers.id, row.id))
			results.answersMigrated++
		}
	}

	return results
}
