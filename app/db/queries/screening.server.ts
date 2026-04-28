import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm"
import { db } from "../connection.server"
import { applicationEnvironments, monitoredApplications, naisTeams } from "../schema/applications"
import { type ComplianceStatus, complianceAssessmentHistory, complianceAssessments } from "../schema/compliance"
import { applicationTechnologyElements, frameworkControls, technologyElements } from "../schema/framework"
import { routineControls, routines } from "../schema/routines"
import { rulesetControls } from "../schema/rulesets"
import {
	type ScreeningQuestionStatus,
	screeningAnswers,
	screeningChoiceEffects,
	screeningQuestionChoices,
	screeningQuestions,
	screeningQuestionTechnologyElements,
	screeningRoutineSelections,
	type ValidScreeningQuestionStatus,
} from "../schema/screening"
import { writeAuditLog } from "./audit.server"

// ─── Questions CRUD ──────────────────────────────────────────────────────

export async function getScreeningQuestions(
	opts: { includeArchived?: boolean; status?: ScreeningQuestionStatus } = {},
) {
	const conds = [isNull(screeningQuestions.sectionId)]
	if (!opts.includeArchived && opts.status !== "archived") conds.push(isNull(screeningQuestions.archivedAt))
	if (opts.status) conds.push(eq(screeningQuestions.status, opts.status))
	return db
		.select()
		.from(screeningQuestions)
		.where(and(...conds))
		.orderBy(screeningQuestions.displayOrder)
}

/** Get screening questions scoped to a section. */
export async function getSectionScreeningQuestions(
	sectionId: string,
	opts: { includeArchived?: boolean; status?: ScreeningQuestionStatus } = {},
) {
	const conds = [eq(screeningQuestions.sectionId, sectionId)]
	if (!opts.includeArchived && opts.status !== "archived") conds.push(isNull(screeningQuestions.archivedAt))
	if (opts.status) conds.push(eq(screeningQuestions.status, opts.status))
	return db
		.select()
		.from(screeningQuestions)
		.where(and(...conds))
		.orderBy(screeningQuestions.displayOrder)
}

export async function getScreeningQuestion(id: string) {
	const [q] = await db.select().from(screeningQuestions).where(eq(screeningQuestions.id, id)).limit(1)
	return q ?? null
}

/** Fetch multiple screening questions by IDs in a single query. */
export async function getScreeningQuestionsByIds(ids: string[]) {
	if (ids.length === 0) return []
	return db.select().from(screeningQuestions).where(inArray(screeningQuestions.id, ids))
}

/**
 * Oppretter et nytt screening-spørsmål, evt. avgrenset til en seksjon eller koblet
 * til et regelsett. Skriver audit-logg.
 */
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

/**
 * Logisk arkivering av et screening-spørsmål. Setter archived_at/archived_by
 * atomisk via guarded UPDATE WHERE archived_at IS NULL, og skriver audit-logg
 * i samme transaksjon (AGENTS.md regel 5 + 6).
 *
 * Returnerer det arkiverte spørsmålet, eller den eksisterende raden hvis den
 * allerede var arkivert (idempotent), eller null hvis spørsmålet ikke finnes.
 */
export async function archiveScreeningQuestion(id: string, performedBy: string) {
	return db.transaction(async (tx) => {
		const [archived] = await tx
			.update(screeningQuestions)
			.set({
				status: "archived",
				archivedAt: new Date(),
				archivedBy: performedBy,
				updatedAt: new Date(),
				updatedBy: performedBy,
			})
			.where(and(eq(screeningQuestions.id, id), isNull(screeningQuestions.archivedAt)))
			.returning()
		if (!archived) {
			const [existing] = await tx.select().from(screeningQuestions).where(eq(screeningQuestions.id, id)).limit(1)
			return existing ?? null
		}
		await writeAuditLog(
			{
				action: "screening_question_archived",
				entityType: "screening_question",
				entityId: id,
				previousValue: JSON.stringify({ questionText: archived.questionText }),
				newValue: JSON.stringify({ questionText: archived.questionText, archivedAt: archived.archivedAt }),
				performedBy,
			},
			tx,
		)
		return archived
	})
}

/**
 * Reaktiverer et arkivert screening-spørsmål. Idempotent: returnerer
 * eksisterende rad uten endringer hvis den ikke var arkivert.
 */
export async function unarchiveScreeningQuestion(id: string, performedBy: string) {
	return db.transaction(async (tx) => {
		const [existing] = await tx
			.select()
			.from(screeningQuestions)
			.where(eq(screeningQuestions.id, id))
			.for("update")
			.limit(1)
		if (!existing) return null
		if (!existing.archivedAt) return existing
		const previousArchivedAt = existing.archivedAt
		const [restored] = await tx
			.update(screeningQuestions)
			.set({
				archivedAt: null,
				archivedBy: null,
				status: "draft",
				updatedAt: new Date(),
				updatedBy: performedBy,
			})
			.where(eq(screeningQuestions.id, id))
			.returning()
		await writeAuditLog(
			{
				action: "screening_question_unarchived",
				entityType: "screening_question",
				entityId: id,
				previousValue: JSON.stringify({ questionText: restored.questionText, archivedAt: previousArchivedAt }),
				newValue: JSON.stringify({ questionText: restored.questionText }),
				performedBy,
			},
			tx,
		)
		return restored
	})
}

/**
 * Endre status på et screening-spørsmål. Tillatte overganger:
 * draft → ready, ready → approved, any → draft (tilbakestill).
 * Skriver audit-logg.
 */
const allowedTransitions: Record<Exclude<ScreeningQuestionStatus, "archived">, ScreeningQuestionStatus[]> = {
	draft: ["ready"],
	ready: ["approved", "draft"],
	approved: ["draft"],
}

export async function changeScreeningQuestionStatus(
	id: string,
	newStatus: ValidScreeningQuestionStatus,
	performedBy: string,
) {
	return db.transaction(async (tx) => {
		const [existing] = await tx
			.select()
			.from(screeningQuestions)
			.where(eq(screeningQuestions.id, id))
			.for("update")
			.limit(1)
		if (!existing) {
			throw new Response("Fant ikke screening-spørsmål.", { status: 404 })
		}

		if (existing.archivedAt) {
			throw new Response("Kan ikke endre status på et arkivert spørsmål. Reaktiver det først.", { status: 403 })
		}

		const previousStatus = existing.status
		if (previousStatus === newStatus) return existing

		const allowed = previousStatus !== "archived" ? allowedTransitions[previousStatus] : undefined
		if (!allowed?.includes(newStatus)) {
			throw new Response(`Ugyldig overgang: ${previousStatus} → ${newStatus}`, { status: 400 })
		}

		const [updated] = await tx
			.update(screeningQuestions)
			.set({
				status: newStatus,
				updatedAt: new Date(),
				updatedBy: performedBy,
			})
			.where(eq(screeningQuestions.id, id))
			.returning()

		await writeAuditLog(
			{
				action: "screening_question_status_changed",
				entityType: "screening_question",
				entityId: id,
				previousValue: JSON.stringify({ status: previousStatus }),
				newValue: JSON.stringify({ status: newStatus }),
				metadata: { questionText: updated.questionText },
				performedBy,
			},
			tx,
		)
		return updated
	})
}

// ─── Question Technology Elements ────────────────────────────────────────

export async function getQuestionTechnologyElements(questionId: string) {
	return db
		.select({ elementId: screeningQuestionTechnologyElements.elementId })
		.from(screeningQuestionTechnologyElements)
		.where(
			and(
				eq(screeningQuestionTechnologyElements.questionId, questionId),
				isNull(screeningQuestionTechnologyElements.archivedAt),
			),
		)
}

export async function setQuestionTechnologyElements(questionId: string, elementIds: string[], performedBy: string) {
	await db.transaction(async (tx) => {
		// Serialiser samtidige sets på samme spørsmål: lås parent-raden FOR UPDATE
		// slik at to parallelle saves ikke kan arkivere hverandres nye rader (lost-
		// update). Kort kritisk seksjon — alle reads/writes nedenfor er på samme
		// questionId.
		await tx
			.select({ id: screeningQuestions.id })
			.from(screeningQuestions)
			.where(eq(screeningQuestions.id, questionId))
			.for("update")

		// Bevar koblinger til arkiverte elementer: edit-skjemaet rendrer bare aktive
		// elementer, så hvis vi gjør full replacement vil arkiverte koblinger forsvinne
		// stille. Vi finner derfor først eksisterende koblinger til arkiverte elementer
		// og legger dem til i settet før replacement.
		const existing = await tx
			.select({
				elementId: screeningQuestionTechnologyElements.elementId,
				archivedAt: technologyElements.archivedAt,
			})
			.from(screeningQuestionTechnologyElements)
			.innerJoin(technologyElements, eq(technologyElements.id, screeningQuestionTechnologyElements.elementId))
			.where(
				and(
					eq(screeningQuestionTechnologyElements.questionId, questionId),
					isNull(screeningQuestionTechnologyElements.archivedAt),
				),
			)
			.for("share", { of: technologyElements })

		const archivedToPreserve = existing.filter((e) => e.archivedAt).map((e) => e.elementId)
		const finalIds = Array.from(new Set([...elementIds, ...archivedToPreserve]))

		// Diff mot endelig sett (etter preserve-logikken) for å unngå falske
		// added/removed-audit-rader for arkiverte koblinger som bevares.
		const previousIds = new Set(existing.map((e) => e.elementId))
		const finalSet = new Set(finalIds)
		const added = finalIds.filter((id) => !previousIds.has(id))
		const removed = [...previousIds].filter((id) => !finalSet.has(id))

		// No-op short-circuit: hvis settet er uendret, hopp over soft-delete+INSERT-
		// replacement. Sparer write-load og bevarer link-radenes `id` (ellers
		// ville hver lagring rotert id-ene, selv uten reell endring).
		if (added.length === 0 && removed.length === 0) return

		// Soft-delete alle aktive koblinger og INSERT målsettet på nytt. Partial
		// unique index `uq_screening_question_tech_element_active` sikrer at det
		// ikke kan ligge to aktive rader for samme (questionId, elementId).
		await tx
			.update(screeningQuestionTechnologyElements)
			.set({ archivedAt: new Date(), archivedBy: performedBy })
			.where(
				and(
					eq(screeningQuestionTechnologyElements.questionId, questionId),
					isNull(screeningQuestionTechnologyElements.archivedAt),
				),
			)

		if (finalIds.length > 0) {
			await tx
				.insert(screeningQuestionTechnologyElements)
				.values(finalIds.map((elementId) => ({ questionId, elementId })))
		}

		for (const elementId of added) {
			await writeAuditLog(
				{
					action: "screening_question_technology_element_added",
					entityType: "screening_question_technology_element",
					entityId: questionId,
					newValue: JSON.stringify({ questionId, elementId }),
					metadata: { elementId },
					performedBy,
				},
				tx,
			)
		}
		for (const elementId of removed) {
			await writeAuditLog(
				{
					action: "screening_question_technology_element_removed",
					entityType: "screening_question_technology_element",
					entityId: questionId,
					previousValue: JSON.stringify({ questionId, elementId }),
					metadata: { elementId },
					performedBy,
				},
				tx,
			)
		}
	})
}

// ─── Choices CRUD ────────────────────────────────────────────────────────

export async function getChoicesForQuestion(questionId: string, opts: { includeArchived?: boolean } = {}) {
	const conds = [eq(screeningQuestionChoices.questionId, questionId)]
	if (!opts.includeArchived) conds.push(isNull(screeningQuestionChoices.archivedAt))
	return db
		.select()
		.from(screeningQuestionChoices)
		.where(and(...conds))
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

/**
 * Logisk arkivering av et svaralternativ. Tilhørende choice-effekter blir også
 * arkivert i samme transaksjon (kaskade), siden valget ikke lenger eksisterer
 * i UI etter arkivering. Audit-logg skrives for både choice og hver effekt.
 * Idempotent: returnerer eksisterende rad uten endringer hvis den allerede var
 * arkivert, og null hvis raden ikke finnes.
 */
export async function archiveChoice(choiceId: string, performedBy: string) {
	return db.transaction(async (tx) => {
		const [archived] = await tx
			.update(screeningQuestionChoices)
			.set({ archivedAt: new Date(), archivedBy: performedBy })
			.where(and(eq(screeningQuestionChoices.id, choiceId), isNull(screeningQuestionChoices.archivedAt)))
			.returning()
		if (!archived) {
			const [existing] = await tx
				.select()
				.from(screeningQuestionChoices)
				.where(eq(screeningQuestionChoices.id, choiceId))
				.limit(1)
			return existing ?? null
		}
		await writeAuditLog(
			{
				action: "screening_choice_archived",
				entityType: "screening_question_choice",
				entityId: choiceId,
				previousValue: JSON.stringify({ label: archived.label, questionId: archived.questionId }),
				newValue: JSON.stringify({ label: archived.label, archivedAt: archived.archivedAt }),
				performedBy,
			},
			tx,
		)

		// Cascade-archive child effects (still in same tx)
		const cascadedEffects = await tx
			.update(screeningChoiceEffects)
			.set({ archivedAt: new Date(), archivedBy: performedBy })
			.where(and(eq(screeningChoiceEffects.choiceId, choiceId), isNull(screeningChoiceEffects.archivedAt)))
			.returning()
		for (const eff of cascadedEffects) {
			await writeAuditLog(
				{
					action: "screening_choice_effect_archived",
					entityType: "screening_choice_effect",
					entityId: eff.id,
					previousValue: JSON.stringify({ choiceId: eff.choiceId, controlId: eff.controlId, effect: eff.effect }),
					newValue: JSON.stringify({ archivedAt: eff.archivedAt, cascadedFromChoice: choiceId }),
					performedBy,
					metadata: { cascade: "choice_archived" },
				},
				tx,
			)
		}
		return archived
	})
}

/** Reaktiverer et arkivert svaralternativ. Idempotent. */
export async function unarchiveChoice(choiceId: string, performedBy: string) {
	return db.transaction(async (tx) => {
		const [existing] = await tx
			.select()
			.from(screeningQuestionChoices)
			.where(eq(screeningQuestionChoices.id, choiceId))
			.for("update")
			.limit(1)
		if (!existing) return null
		if (!existing.archivedAt) return existing
		const previousArchivedAt = existing.archivedAt
		const [restored] = await tx
			.update(screeningQuestionChoices)
			.set({ archivedAt: null, archivedBy: null })
			.where(eq(screeningQuestionChoices.id, choiceId))
			.returning()
		await writeAuditLog(
			{
				action: "screening_choice_unarchived",
				entityType: "screening_question_choice",
				entityId: choiceId,
				previousValue: JSON.stringify({ label: restored.label, archivedAt: previousArchivedAt }),
				newValue: JSON.stringify({ label: restored.label }),
				performedBy,
			},
			tx,
		)
		return restored
	})
}

// ─── Choice Effects CRUD ─────────────────────────────────────────────────

export async function getChoiceEffects(choiceId: string, opts: { includeArchived?: boolean } = {}) {
	const conds = [eq(screeningChoiceEffects.choiceId, choiceId)]
	if (!opts.includeArchived) conds.push(isNull(screeningChoiceEffects.archivedAt))
	return db
		.select({
			id: screeningChoiceEffects.id,
			choiceId: screeningChoiceEffects.choiceId,
			controlId: screeningChoiceEffects.controlId,
			controlTextId: frameworkControls.controlId,
			controlName: frameworkControls.shortTitle,
			effect: screeningChoiceEffects.effect,
			comment: screeningChoiceEffects.comment,
			archivedAt: screeningChoiceEffects.archivedAt,
			archivedBy: screeningChoiceEffects.archivedBy,
		})
		.from(screeningChoiceEffects)
		.innerJoin(frameworkControls, eq(screeningChoiceEffects.controlId, frameworkControls.id))
		.where(and(...conds))
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

/**
 * Logisk arkivering av en choice-effect (kontroll-konsekvens av et valg).
 * Audit-logg skrives i samme transaksjon. Idempotent.
 */
export async function archiveChoiceEffect(effectId: string, performedBy: string) {
	return db.transaction(async (tx) => {
		const [archived] = await tx
			.update(screeningChoiceEffects)
			.set({ archivedAt: new Date(), archivedBy: performedBy })
			.where(and(eq(screeningChoiceEffects.id, effectId), isNull(screeningChoiceEffects.archivedAt)))
			.returning()
		if (!archived) {
			const [existing] = await tx
				.select()
				.from(screeningChoiceEffects)
				.where(eq(screeningChoiceEffects.id, effectId))
				.limit(1)
			return existing ?? null
		}
		await writeAuditLog(
			{
				action: "screening_choice_effect_archived",
				entityType: "screening_choice_effect",
				entityId: effectId,
				previousValue: JSON.stringify({
					choiceId: archived.choiceId,
					controlId: archived.controlId,
					effect: archived.effect,
				}),
				newValue: JSON.stringify({ archivedAt: archived.archivedAt }),
				performedBy,
			},
			tx,
		)
		return archived
	})
}

/** Reaktiverer en arkivert choice-effect. Idempotent. */
export async function unarchiveChoiceEffect(effectId: string, performedBy: string) {
	return db.transaction(async (tx) => {
		const [existing] = await tx
			.select()
			.from(screeningChoiceEffects)
			.where(eq(screeningChoiceEffects.id, effectId))
			.for("update")
			.limit(1)
		if (!existing) return null
		if (!existing.archivedAt) return existing
		const previousArchivedAt = existing.archivedAt
		const [restored] = await tx
			.update(screeningChoiceEffects)
			.set({ archivedAt: null, archivedBy: null })
			.where(eq(screeningChoiceEffects.id, effectId))
			.returning()
		await writeAuditLog(
			{
				action: "screening_choice_effect_unarchived",
				entityType: "screening_choice_effect",
				entityId: effectId,
				previousValue: JSON.stringify({ archivedAt: previousArchivedAt }),
				newValue: JSON.stringify({
					choiceId: restored.choiceId,
					controlId: restored.controlId,
					effect: restored.effect,
				}),
				performedBy,
			},
			tx,
		)
		return restored
	})
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

	// Effects are now derived on-the-fly by computeAutoCompliance via getScreeningEffectsByControlForApp.
	// No need to write to complianceAssessments anymore.
}

/**
 * @deprecated Legacy: wrote screening effects to complianceAssessments. No longer called.
 * Effects are now derived on-the-fly by computeAutoCompliance.
 */
async function _applyChoiceEffects(
	applicationId: string,
	questionId: string,
	answerValue: string,
	performedBy: string,
) {
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

/**
 * Henter alle screening-data (globale + seksjonsspesifikke spørsmål, valg,
 * effekter, eksisterende svar, valgte rutiner) for en applikasjon og samler
 * resultatet i ett retur-objekt for compliance-siden. Internt utføres
 * flere DB-spørringer.
 */
export async function getScreeningDataForApp(applicationId: string) {
	// Get global questions + section-scoped questions for the app's section(s)
	const globalQuestions = await getScreeningQuestions({ status: "approved" })

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
			.where(
				and(
					inArray(screeningQuestions.sectionId, sectionIds),
					isNull(screeningQuestions.archivedAt),
					eq(screeningQuestions.status, "approved"),
				),
			)
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
						and(
							inArray(
								screeningQuestionTechnologyElements.questionId,
								allQuestions.map((q) => q.id),
							),
							isNull(screeningQuestionTechnologyElements.archivedAt),
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
		.where(
			and(
				eq(applicationTechnologyElements.applicationId, applicationId),
				isNull(applicationTechnologyElements.archivedAt),
			),
		)
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

	// Load choices for all questions (kun aktive)
	const allChoices = await db
		.select()
		.from(screeningQuestionChoices)
		.where(isNull(screeningQuestionChoices.archivedAt))
		.orderBy(screeningQuestionChoices.displayOrder)

	const choicesByQuestion = new Map<string, (typeof allChoices)[number][]>()
	for (const c of allChoices) {
		const list = choicesByQuestion.get(c.questionId) ?? []
		list.push(c)
		choicesByQuestion.set(c.questionId, list)
	}

	// Load choice effects for displaying affected controls (kun aktive)
	const allChoiceEffects = await db
		.select({
			id: screeningChoiceEffects.id,
			choiceId: screeningChoiceEffects.choiceId,
			controlId: screeningChoiceEffects.controlId,
			controlTextId: frameworkControls.controlId,
			controlName: frameworkControls.shortTitle,
			effect: screeningChoiceEffects.effect,
		})
		.from(screeningChoiceEffects)
		.innerJoin(frameworkControls, eq(screeningChoiceEffects.controlId, frameworkControls.id))
		.where(isNull(screeningChoiceEffects.archivedAt))

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
			.where(
				and(
					inArray(routineControls.controlId, [...selectRoutineControlIds]),
					isNull(routineControls.archivedAt),
					eq(routines.status, "approved"),
					isNull(routines.archivedAt),
				),
			)

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
						controlName: e.controlName,
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

/**
 * Lagrer brukerens valgte rutine for en gitt screening-effekt
 * (choice → routine-mapping per applikasjon). Erstatter eksisterende valg.
 */
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

// ─── Screening-derived control IDs ───────────────────────────────────────

/**
 * Returns the set of framework control UUIDs that are relevant to an app
 * based on its screening answers. Controls come from 3 paths:
 * 1. Direct choice effects (screening_choice_effects.controlId)
 * 2. Routines selected via screening (screening_routine_selections → routine_controls)
 * 3. Rulesets linked to answered questions (screening_questions.rulesetId → ruleset_controls)
 *
 * Returns empty set if no screening answers exist (caller should use fallback = all controls).
 * Handles primaryApplicationId inheritance.
 */
export async function getScreeningDerivedControlIds(appId: string): Promise<Set<string>> {
	// Handle primary application inheritance
	const [app] = await db
		.select({ primaryApplicationId: monitoredApplications.primaryApplicationId })
		.from(monitoredApplications)
		.where(eq(monitoredApplications.id, appId))
		.limit(1)
	const screeningAppId = app?.primaryApplicationId ?? appId

	// Check if any screening answers exist
	const [answerCount] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(screeningAnswers)
		.where(eq(screeningAnswers.applicationId, screeningAppId))
	if (!answerCount || answerCount.count === 0) return new Set()

	// Path 1: Direct control effects from answered choices (kun aktive valg/effekter)
	const directEffects = await db
		.selectDistinct({ controlId: screeningChoiceEffects.controlId })
		.from(screeningAnswers)
		.innerJoin(
			screeningQuestionChoices,
			and(
				eq(screeningQuestionChoices.questionId, screeningAnswers.questionId),
				eq(screeningQuestionChoices.label, screeningAnswers.answer),
				isNull(screeningQuestionChoices.archivedAt),
			),
		)
		.innerJoin(
			screeningChoiceEffects,
			and(eq(screeningChoiceEffects.choiceId, screeningQuestionChoices.id), isNull(screeningChoiceEffects.archivedAt)),
		)
		.innerJoin(
			screeningQuestions,
			and(
				eq(screeningQuestions.id, screeningAnswers.questionId),
				isNull(screeningQuestions.archivedAt),
				eq(screeningQuestions.status, "approved"),
			),
		)
		.where(and(eq(screeningAnswers.applicationId, screeningAppId), isNotNull(screeningChoiceEffects.controlId)))

	// Path 2: Controls via routines selected through screening (kun via aktive choice-effects)
	const routineEffects = await db
		.selectDistinct({ controlId: routineControls.controlId })
		.from(screeningRoutineSelections)
		.innerJoin(routineControls, eq(routineControls.routineId, screeningRoutineSelections.routineId))
		.innerJoin(
			screeningChoiceEffects,
			and(
				eq(screeningChoiceEffects.id, screeningRoutineSelections.choiceEffectId),
				isNull(screeningChoiceEffects.archivedAt),
			),
		)
		.innerJoin(
			screeningQuestionChoices,
			and(
				eq(screeningQuestionChoices.id, screeningChoiceEffects.choiceId),
				isNull(screeningQuestionChoices.archivedAt),
			),
		)
		.innerJoin(
			screeningQuestions,
			and(
				eq(screeningQuestions.id, screeningQuestionChoices.questionId),
				isNull(screeningQuestions.archivedAt),
				eq(screeningQuestions.status, "approved"),
			),
		)
		.where(
			and(
				eq(screeningRoutineSelections.applicationId, screeningAppId),
				isNotNull(screeningRoutineSelections.routineId),
			),
		)

	// Path 3: Controls via rulesets linked to answered questions (kun aktive spørsmål)
	const rulesetEffects = await db
		.selectDistinct({ controlId: rulesetControls.controlId })
		.from(screeningAnswers)
		.innerJoin(
			screeningQuestions,
			and(
				eq(screeningQuestions.id, screeningAnswers.questionId),
				isNull(screeningQuestions.archivedAt),
				eq(screeningQuestions.status, "approved"),
			),
		)
		.innerJoin(rulesetControls, eq(rulesetControls.rulesetId, screeningQuestions.rulesetId))
		.where(and(eq(screeningAnswers.applicationId, screeningAppId), isNotNull(screeningQuestions.rulesetId)))

	const controlIds = new Set<string>()
	for (const r of directEffects) if (r.controlId) controlIds.add(r.controlId)
	for (const r of routineEffects) controlIds.add(r.controlId)
	for (const r of rulesetEffects) controlIds.add(r.controlId)
	return controlIds
}

/**
 * Batch version of getScreeningDerivedControlIds for dashboard pages.
 * Returns Map<appId, Set<controlUuid>>. Empty set = no screening answers.
 * Handles primaryApplicationId inheritance.
 */
export async function getBatchScreeningDerivedControlIds(appIds: string[]): Promise<Map<string, Set<string>>> {
	const result = new Map<string, Set<string>>()
	if (appIds.length === 0) return result
	for (const id of appIds) result.set(id, new Set())

	// Resolve primary application IDs
	const apps = await db
		.select({ id: monitoredApplications.id, primaryApplicationId: monitoredApplications.primaryApplicationId })
		.from(monitoredApplications)
		.where(inArray(monitoredApplications.id, appIds))
	const screeningAppIdMap = new Map<string, string>()
	for (const a of apps) {
		screeningAppIdMap.set(a.id, a.primaryApplicationId ?? a.id)
	}
	const screeningAppIds = [...new Set(screeningAppIdMap.values())]

	// Check which apps have screening answers
	const answerCounts = await db
		.select({
			applicationId: screeningAnswers.applicationId,
			count: sql<number>`count(*)::int`,
		})
		.from(screeningAnswers)
		.where(inArray(screeningAnswers.applicationId, screeningAppIds))
		.groupBy(screeningAnswers.applicationId)
	const appsWithAnswers = new Set(answerCounts.filter((a) => a.count > 0).map((a) => a.applicationId))

	const answeredScreeningAppIds = screeningAppIds.filter((id) => appsWithAnswers.has(id))
	if (answeredScreeningAppIds.length === 0) return result

	// Path 1: Direct control effects (kun aktive valg/effekter/spørsmål)
	const directRows = await db
		.select({
			applicationId: screeningAnswers.applicationId,
			controlId: screeningChoiceEffects.controlId,
		})
		.from(screeningAnswers)
		.innerJoin(
			screeningQuestionChoices,
			and(
				eq(screeningQuestionChoices.questionId, screeningAnswers.questionId),
				eq(screeningQuestionChoices.label, screeningAnswers.answer),
				isNull(screeningQuestionChoices.archivedAt),
			),
		)
		.innerJoin(
			screeningChoiceEffects,
			and(eq(screeningChoiceEffects.choiceId, screeningQuestionChoices.id), isNull(screeningChoiceEffects.archivedAt)),
		)
		.innerJoin(
			screeningQuestions,
			and(
				eq(screeningQuestions.id, screeningAnswers.questionId),
				isNull(screeningQuestions.archivedAt),
				eq(screeningQuestions.status, "approved"),
			),
		)
		.where(
			and(
				inArray(screeningAnswers.applicationId, answeredScreeningAppIds),
				isNotNull(screeningChoiceEffects.controlId),
			),
		)

	// Path 2: Controls via selected routines (kun via aktive choice-effects)
	const routineRows = await db
		.select({
			applicationId: screeningRoutineSelections.applicationId,
			controlId: routineControls.controlId,
		})
		.from(screeningRoutineSelections)
		.innerJoin(routineControls, eq(routineControls.routineId, screeningRoutineSelections.routineId))
		.innerJoin(
			screeningChoiceEffects,
			and(
				eq(screeningChoiceEffects.id, screeningRoutineSelections.choiceEffectId),
				isNull(screeningChoiceEffects.archivedAt),
			),
		)
		.innerJoin(
			screeningQuestionChoices,
			and(
				eq(screeningQuestionChoices.id, screeningChoiceEffects.choiceId),
				isNull(screeningQuestionChoices.archivedAt),
			),
		)
		.innerJoin(
			screeningQuestions,
			and(
				eq(screeningQuestions.id, screeningQuestionChoices.questionId),
				isNull(screeningQuestions.archivedAt),
				eq(screeningQuestions.status, "approved"),
			),
		)
		.where(
			and(
				inArray(screeningRoutineSelections.applicationId, answeredScreeningAppIds),
				isNotNull(screeningRoutineSelections.routineId),
			),
		)

	// Path 3: Controls via rulesets (kun aktive spørsmål)
	const rulesetRows = await db
		.select({
			applicationId: screeningAnswers.applicationId,
			controlId: rulesetControls.controlId,
		})
		.from(screeningAnswers)
		.innerJoin(
			screeningQuestions,
			and(
				eq(screeningQuestions.id, screeningAnswers.questionId),
				isNull(screeningQuestions.archivedAt),
				eq(screeningQuestions.status, "approved"),
			),
		)
		.innerJoin(rulesetControls, eq(rulesetControls.rulesetId, screeningQuestions.rulesetId))
		.where(
			and(inArray(screeningAnswers.applicationId, answeredScreeningAppIds), isNotNull(screeningQuestions.rulesetId)),
		)

	// Build per-screeningApp control sets
	const controlsByScreeningApp = new Map<string, Set<string>>()
	for (const r of directRows) {
		if (!r.controlId) continue
		const s = controlsByScreeningApp.get(r.applicationId) ?? new Set()
		s.add(r.controlId)
		controlsByScreeningApp.set(r.applicationId, s)
	}
	for (const r of routineRows) {
		const s = controlsByScreeningApp.get(r.applicationId) ?? new Set()
		s.add(r.controlId)
		controlsByScreeningApp.set(r.applicationId, s)
	}
	for (const r of rulesetRows) {
		const s = controlsByScreeningApp.get(r.applicationId) ?? new Set()
		s.add(r.controlId)
		controlsByScreeningApp.set(r.applicationId, s)
	}

	// Map back to original appIds (handling primary inheritance)
	for (const appId of appIds) {
		const screeningAppId = screeningAppIdMap.get(appId) ?? appId
		const controls = controlsByScreeningApp.get(screeningAppId)
		if (controls && controls.size > 0) {
			result.set(appId, controls)
		}
	}

	return result
}
