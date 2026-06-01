import { and, eq, inArray, isNotNull, isNull, notExists, sql } from "drizzle-orm"
import { ScreeningValidationError } from "../../lib/screening-types"
import { isValidUuid } from "../../lib/utils"
import { db } from "../connection.server"
import { applicationEnvironments, monitoredApplications, naisTeams } from "../schema/applications"
import { complianceAssessmentHistory, complianceAssessments } from "../schema/compliance"
import { frameworkControls, technologyElements } from "../schema/framework"
import { sectionEnvironments } from "../schema/organization"
import { routineControls, routines, routineTechnologyElements } from "../schema/routines"
import { rulesetControls } from "../schema/rulesets"
import {
	type ScreeningEffect,
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
	createdBy: string,
	sectionId?: string | null,
	answerType = "boolean",
	rulesetId?: string | null,
) {
	// Auto-assign displayOrder as max + 1 within the same scope (global or section)
	const scopeFilter = sectionId ? eq(screeningQuestions.sectionId, sectionId) : isNull(screeningQuestions.sectionId)
	const [{ max: maxOrder }] = await db
		.select({ max: sql<number>`coalesce(max(${screeningQuestions.displayOrder}), -1)` })
		.from(screeningQuestions)
		.where(scopeFilter)
	const displayOrder = maxOrder + 1

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
	updatedBy: string,
	rulesetId?: string | null,
) {
	const [q] = await db
		.update(screeningQuestions)
		.set({ questionText, description, updatedAt: new Date(), updatedBy, rulesetId: rulesetId ?? null })
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
			presetRoutineId: screeningChoiceEffects.presetRoutineId,
			presetRoutineName: routines.name,
			archivedAt: screeningChoiceEffects.archivedAt,
			archivedBy: screeningChoiceEffects.archivedBy,
		})
		.from(screeningChoiceEffects)
		.innerJoin(frameworkControls, eq(screeningChoiceEffects.controlId, frameworkControls.id))
		.leftJoin(routines, eq(screeningChoiceEffects.presetRoutineId, routines.id))
		.where(and(...conds))
		.orderBy(frameworkControls.controlId)
}

export async function addChoiceEffect(params: {
	choiceId: string
	controlTextId: string
	effect: ScreeningEffect | null
	comment: string | null
	presetRoutineId?: string | null
}) {
	// Two-way invariant: preset_routine ↔ presetRoutineId
	if (params.effect === "preset_routine" && !params.presetRoutineId) {
		throw new ScreeningValidationError("Effekt 'preset_routine' krever presetRoutineId")
	}
	if (params.presetRoutineId && params.effect !== "preset_routine") {
		throw new ScreeningValidationError("presetRoutineId kan kun brukes med effect 'preset_routine'")
	}
	const [ctrl] = await db
		.select({ id: frameworkControls.id })
		.from(frameworkControls)
		.where(eq(frameworkControls.controlId, params.controlTextId))
		.limit(1)

	if (!ctrl) throw new ScreeningValidationError(`Kontroll ${params.controlTextId} ikke funnet`)

	if (params.presetRoutineId) {
		if (!isValidUuid(params.presetRoutineId)) {
			throw new ScreeningValidationError("presetRoutineId må være en gyldig UUID")
		}
		const [routine] = await db
			.select({
				status: routines.status,
				archivedAt: routines.archivedAt,
				replacedByRoutineId: routines.replacedByRoutineId,
			})
			.from(routines)
			.where(eq(routines.id, params.presetRoutineId))
			.limit(1)
		if (!routine) throw new ScreeningValidationError(`Rutine ${params.presetRoutineId} ikke funnet`)
		if (routine.replacedByRoutineId)
			throw new ScreeningValidationError(
				`Rutine ${params.presetRoutineId} er erstattet av en nyere versjon og kan ikke velges som forvalgt rutine`,
			)
		if (routine.archivedAt)
			throw new ScreeningValidationError(
				`Rutine ${params.presetRoutineId} er arkivert og kan ikke velges som forvalgt rutine`,
			)
		if (routine.status !== "approved")
			throw new ScreeningValidationError(`Rutine ${params.presetRoutineId} er ikke godkjent`)

		// Verify the routine is actively linked to the selected control
		const [link] = await db
			.select({ id: routineControls.id })
			.from(routineControls)
			.where(
				and(
					eq(routineControls.routineId, params.presetRoutineId),
					eq(routineControls.controlId, ctrl.id),
					isNull(routineControls.archivedAt),
				),
			)
			.limit(1)
		if (!link)
			throw new ScreeningValidationError(
				`Rutine ${params.presetRoutineId} er ikke koblet til kontroll ${params.controlTextId}`,
			)
	}

	const [eff] = await db
		.insert(screeningChoiceEffects)
		.values({
			choiceId: params.choiceId,
			controlId: ctrl.id,
			effect: params.effect,
			comment: params.comment || null,
			presetRoutineId: params.presetRoutineId ?? null,
		})
		.returning()

	return eff
}

/**
 * Returns routines available for use as preset on a `preset_routine` effect for a given control.
 * Filters by:
 * 1. Linked to the control via routine_controls
 * 2. Approved and not archived
 * 3. No technology element restrictions, OR overlapping tech elements with the question's tech elements
 */
export async function getRoutinesForControlAndTechElements(
	controlTextId: string,
	questionTechElementIds: string[],
): Promise<Array<{ id: string; name: string }>> {
	const [ctrl] = await db
		.select({ id: frameworkControls.id })
		.from(frameworkControls)
		.where(eq(frameworkControls.controlId, controlTextId))
		.limit(1)

	if (!ctrl) return []

	// Load all approved, non-archived routines linked to this control
	const linked = await db
		.select({ id: routines.id, name: routines.name })
		.from(routineControls)
		.innerJoin(routines, eq(routineControls.routineId, routines.id))
		.where(
			and(
				eq(routineControls.controlId, ctrl.id),
				isNull(routineControls.archivedAt),
				eq(routines.status, "approved"),
				isNull(routines.archivedAt),
			),
		)

	if (linked.length === 0) return []

	// Load tech element restrictions for these routines
	const linkedIds = linked.map((r) => r.id)
	const techLinks = await db
		.select({ routineId: routineTechnologyElements.routineId, elementId: routineTechnologyElements.elementId })
		.from(routineTechnologyElements)
		.where(and(inArray(routineTechnologyElements.routineId, linkedIds), isNull(routineTechnologyElements.archivedAt)))

	const techByRoutine = new Map<string, string[]>()
	for (const link of techLinks) {
		const list = techByRoutine.get(link.routineId) ?? []
		list.push(link.elementId)
		techByRoutine.set(link.routineId, list)
	}

	const questionTechSet = new Set(questionTechElementIds)

	return linked.filter((r) => {
		const requiredElements = techByRoutine.get(r.id)
		if (!requiredElements || requiredElements.length === 0) return true
		return requiredElements.some((elId) => questionTechSet.has(elId))
	})
}

/** Verify that an effect belongs to a specific question (via choice → question join). */
export async function isEffectOwnedByQuestion(effectId: string, questionId: string): Promise<boolean> {
	const [result] = await db
		.select({ id: screeningChoiceEffects.id })
		.from(screeningChoiceEffects)
		.innerJoin(screeningQuestionChoices, eq(screeningChoiceEffects.choiceId, screeningQuestionChoices.id))
		.where(and(eq(screeningChoiceEffects.id, effectId), eq(screeningQuestionChoices.questionId, questionId)))
		.limit(1)
	return !!result
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

/** Lightweight batch query: get screening progress (answered/total) for multiple apps. */
export async function getScreeningProgressForApps(
	appIds: string[],
): Promise<Map<string, { answered: number; total: number }>> {
	if (appIds.length === 0) return new Map()

	// Get total approved, non-archived questions (global + section-scoped)
	const totalApprovedQuestions = await db
		.select({ count: sql<number>`count(*)` })
		.from(screeningQuestions)
		.where(and(isNull(screeningQuestions.archivedAt), eq(screeningQuestions.status, "approved")))

	const totalQuestions = Number(totalApprovedQuestions[0]?.count ?? 0)

	// Count answers per app, only for approved non-archived questions
	const answerCounts = await db
		.select({
			applicationId: screeningAnswers.applicationId,
			count: sql<number>`count(*)`,
		})
		.from(screeningAnswers)
		.innerJoin(screeningQuestions, eq(screeningAnswers.questionId, screeningQuestions.id))
		.where(
			and(
				inArray(screeningAnswers.applicationId, appIds),
				isNull(screeningQuestions.archivedAt),
				eq(screeningQuestions.status, "approved"),
			),
		)
		.groupBy(screeningAnswers.applicationId)

	const result = new Map<string, { answered: number; total: number }>()
	for (const appId of appIds) {
		result.set(appId, { answered: 0, total: totalQuestions })
	}
	for (const row of answerCounts) {
		const existing = result.get(row.applicationId)
		if (existing) {
			existing.answered = Number(row.count)
		}
	}

	// Check for economy_system questions — expired classifications count as unanswered
	const economyQuestionIds = await db
		.select({ id: screeningQuestions.id })
		.from(screeningQuestions)
		.where(
			and(
				eq(screeningQuestions.answerType, "economy_system"),
				isNull(screeningQuestions.archivedAt),
				eq(screeningQuestions.status, "approved"),
			),
		)

	if (economyQuestionIds.length > 0) {
		const { applicationEconomyClassifications } = await import("~/db/schema/applications")
		const now = new Date()
		const classifications = await db
			.select({
				applicationId: applicationEconomyClassifications.applicationId,
				validUntil: applicationEconomyClassifications.validUntil,
			})
			.from(applicationEconomyClassifications)
			.where(
				and(
					inArray(applicationEconomyClassifications.applicationId, appIds),
					isNull(applicationEconomyClassifications.archivedAt),
				),
			)

		// Apps with a valid (non-expired) active classification
		const validAppIds = new Set(classifications.filter((c) => c.validUntil >= now).map((c) => c.applicationId))

		// Subtract confirmed economy answers for apps without a valid classification
		// (either expired or no classification at all)
		const eqIds = economyQuestionIds.map((q) => q.id)
		const confirmedEconomyAnswers = await db
			.select({
				applicationId: screeningAnswers.applicationId,
				count: sql<number>`count(*)`,
			})
			.from(screeningAnswers)
			.where(
				and(
					inArray(screeningAnswers.applicationId, appIds),
					inArray(screeningAnswers.questionId, eqIds),
					sql`${screeningAnswers.answer} = 'confirmed'`,
				),
			)
			.groupBy(screeningAnswers.applicationId)

		for (const row of confirmedEconomyAnswers) {
			if (validAppIds.has(row.applicationId)) continue
			const existing = result.get(row.applicationId)
			if (existing && existing.answered > 0) {
				existing.answered -= Number(row.count)
			}
		}
	}

	return result
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
		if (!effect.effect || effect.effect === "select_routine" || effect.effect === "preset_routine") continue

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

	// Find section IDs for this app via its nais team environments (enabled only)
	const sectionRows = await db
		.selectDistinct({ sectionId: naisTeams.sectionId })
		.from(applicationEnvironments)
		.innerJoin(naisTeams, eq(applicationEnvironments.naisTeamId, naisTeams.id))
		.where(
			and(
				eq(applicationEnvironments.applicationId, applicationId),
				isNotNull(naisTeams.sectionId),
				// Exclude environments that are disabled for their section
				notExists(
					db
						.select({ cluster: sectionEnvironments.cluster })
						.from(sectionEnvironments)
						.where(
							and(
								eq(sectionEnvironments.cluster, applicationEnvironments.cluster),
								eq(sectionEnvironments.sectionId, naisTeams.sectionId),
								eq(sectionEnvironments.included, false),
							),
						),
				),
			),
		)

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

	// Alle godkjente spørsmål i appens scope (globale + relevante seksjonsspørsmål) vises.
	// Teknologielement-koblinger på spørsmålet brukes til å filtrere rutinevalg,
	// ikke til å skjule spørsmålet.
	const questions = allQuestions

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
			presetRoutineId: screeningChoiceEffects.presetRoutineId,
			presetRoutineName: routines.name,
		})
		.from(screeningChoiceEffects)
		.innerJoin(frameworkControls, eq(screeningChoiceEffects.controlId, frameworkControls.id))
		.leftJoin(
			routines,
			and(
				eq(screeningChoiceEffects.presetRoutineId, routines.id),
				eq(routines.status, "approved"),
				isNull(routines.archivedAt),
			),
		)
		.where(isNull(screeningChoiceEffects.archivedAt))

	const effectsByChoice = new Map<string, (typeof allChoiceEffects)[number][]>()
	for (const e of allChoiceEffects) {
		const list = effectsByChoice.get(e.choiceId) ?? []
		list.push(e)
		effectsByChoice.set(e.choiceId, list)
	}

	// Collect control UUIDs that have select_routine effects to load routine options
	// Also collect preset_routine effect IDs (presetRoutineId is already on the effect row)
	const selectRoutineControlIds = new Set<string>()
	const routineEffectIds = new Set<string>() // both select_routine and preset_routine
	for (const effects of effectsByChoice.values()) {
		for (const e of effects) {
			if (e.effect === "select_routine") {
				selectRoutineControlIds.add(e.controlId)
				routineEffectIds.add(e.id)
			}
			if (e.effect === "preset_routine") {
				routineEffectIds.add(e.id)
			}
		}
	}

	// Load routines linked to select_routine controls (user picks during screening)
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

	// Load existing routine selections for this app (select_routine user picks)
	const existingSelections = new Map<string, string | null>()
	if (routineEffectIds.size > 0) {
		const selections = await db
			.select()
			.from(screeningRoutineSelections)
			.where(
				and(
					eq(screeningRoutineSelections.applicationId, applicationId),
					inArray(screeningRoutineSelections.choiceEffectId, [...routineEffectIds]),
					isNull(screeningRoutineSelections.archivedAt),
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

			// Build routine selection items per choice (both select_routine and preset_routine)
			const choicesWithRoutines = choices.map((c) => {
				const effects = effectsByChoice.get(c.id) ?? []
				const routineSelections = effects
					.filter((e) => e.effect === "select_routine" || e.effect === "preset_routine")
					.map((e) => ({
						effectId: e.id,
						controlTextId: e.controlTextId,
						controlName: e.controlName,
						// preset_routine: presetRoutineId is always set (required at creation)
						// select_routine: presetRoutineId is null, user picks
						presetRoutineId: e.presetRoutineId ?? null,
						presetRoutineName: e.presetRoutineName ?? null,
						routines: e.effect === "select_routine" ? (routineOptionsByControl.get(e.controlId) ?? []) : [],
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

type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Fetches the full set of screening questions visible to an app at a given point in time,
 * without answer fields. Used to snapshot the question scope at session completion.
 *
 * Uses the provided executor so that uncommitted writes in the same transaction (e.g.
 * preset routine selections) are visible.
 */
export async function getScreeningQuestionsForSnapshot(applicationId: string, executor: DbExecutor = db) {
	// Section membership — same logic as getScreeningDataForApp
	const sectionRows = await executor
		.selectDistinct({ sectionId: naisTeams.sectionId })
		.from(applicationEnvironments)
		.innerJoin(naisTeams, eq(applicationEnvironments.naisTeamId, naisTeams.id))
		.where(
			and(
				eq(applicationEnvironments.applicationId, applicationId),
				isNotNull(naisTeams.sectionId),
				notExists(
					executor
						.select({ cluster: sectionEnvironments.cluster })
						.from(sectionEnvironments)
						.where(
							and(
								eq(sectionEnvironments.cluster, applicationEnvironments.cluster),
								eq(sectionEnvironments.sectionId, naisTeams.sectionId),
								eq(sectionEnvironments.included, false),
							),
						),
				),
			),
		)

	const sectionIds = sectionRows.map((r) => r.sectionId).filter((id): id is string => id !== null)

	const globalQuestions = await executor
		.select()
		.from(screeningQuestions)
		.where(
			and(
				isNull(screeningQuestions.sectionId),
				isNull(screeningQuestions.archivedAt),
				eq(screeningQuestions.status, "approved"),
			),
		)
		.orderBy(screeningQuestions.displayOrder)

	let sectionQuestions: typeof globalQuestions = []
	if (sectionIds.length > 0) {
		sectionQuestions = await executor
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
	if (allQuestions.length === 0) return { questions: [], sectionIds }

	const allChoices = await executor
		.select()
		.from(screeningQuestionChoices)
		.where(
			and(
				inArray(
					screeningQuestionChoices.questionId,
					allQuestions.map((q) => q.id),
				),
				isNull(screeningQuestionChoices.archivedAt),
			),
		)
		.orderBy(screeningQuestionChoices.displayOrder)

	const choicesByQuestion = new Map<string, (typeof allChoices)[number][]>()
	for (const c of allChoices) {
		const list = choicesByQuestion.get(c.questionId) ?? []
		list.push(c)
		choicesByQuestion.set(c.questionId, list)
	}

	const allChoiceEffects =
		allChoices.length > 0
			? await executor
					.select({
						id: screeningChoiceEffects.id,
						choiceId: screeningChoiceEffects.choiceId,
						controlId: screeningChoiceEffects.controlId,
						controlTextId: frameworkControls.controlId,
						controlName: frameworkControls.shortTitle,
						effect: screeningChoiceEffects.effect,
						presetRoutineId: screeningChoiceEffects.presetRoutineId,
						presetRoutineName: routines.name,
					})
					.from(screeningChoiceEffects)
					.innerJoin(frameworkControls, eq(screeningChoiceEffects.controlId, frameworkControls.id))
					.leftJoin(
						routines,
						and(
							eq(screeningChoiceEffects.presetRoutineId, routines.id),
							eq(routines.status, "approved"),
							isNull(routines.archivedAt),
						),
					)
					.where(
						and(
							inArray(
								screeningChoiceEffects.choiceId,
								allChoices.map((c) => c.id),
							),
							isNull(screeningChoiceEffects.archivedAt),
						),
					)
			: []

	const effectsByChoice = new Map<string, (typeof allChoiceEffects)[number][]>()
	for (const e of allChoiceEffects) {
		const list = effectsByChoice.get(e.choiceId) ?? []
		list.push(e)
		effectsByChoice.set(e.choiceId, list)
	}

	const selectRoutineControlIds = new Set<string>()
	const routineEffectIds = new Set<string>()
	for (const effects of effectsByChoice.values()) {
		for (const e of effects) {
			if (e.effect === "select_routine") {
				selectRoutineControlIds.add(e.controlId)
				routineEffectIds.add(e.id)
			}
			if (e.effect === "preset_routine") {
				routineEffectIds.add(e.id)
			}
		}
	}

	const routineOptionsByControl = new Map<string, Array<{ id: string; name: string; sectionId: string }>>()
	if (selectRoutineControlIds.size > 0) {
		const linkedRoutines = await executor
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

	const existingSelections = new Map<string, string | null>()
	if (routineEffectIds.size > 0) {
		const selections = await executor
			.select()
			.from(screeningRoutineSelections)
			.where(
				and(
					eq(screeningRoutineSelections.applicationId, applicationId),
					inArray(screeningRoutineSelections.choiceEffectId, [...routineEffectIds]),
					isNull(screeningRoutineSelections.archivedAt),
				),
			)
		for (const s of selections) {
			existingSelections.set(s.choiceEffectId, s.routineId)
		}
	}

	const questions = allQuestions.map((q) => {
		const choices = choicesByQuestion.get(q.id) ?? []
		const affectedControls = new Set<string>()
		for (const c of choices) {
			for (const e of effectsByChoice.get(c.id) ?? []) {
				affectedControls.add(e.controlTextId)
			}
		}

		const choicesWithRoutines = choices.map((c) => {
			const effects = effectsByChoice.get(c.id) ?? []
			const routineSelections = effects
				.filter((e) => e.effect === "select_routine" || e.effect === "preset_routine")
				.map((e) => ({
					effectId: e.id,
					controlTextId: e.controlTextId,
					controlName: e.controlName,
					presetRoutineId: e.presetRoutineId ?? null,
					presetRoutineName: e.presetRoutineName ?? null,
					routines: e.effect === "select_routine" ? (routineOptionsByControl.get(e.controlId) ?? []) : [],
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
			choices: choicesWithRoutines,
			affectedControls: [...affectedControls],
		}
	})

	return { questions, sectionIds }
}

/**
 * Lagrer brukerens valgte rutine for en gitt screening-effekt
 * (choice → routine-mapping per applikasjon). Erstatter eksisterende valg.
 * Accepts an optional Drizzle transaction executor to participate in a larger transaction.
 */
export async function saveRoutineSelection(
	applicationId: string,
	choiceEffectId: string,
	routineId: string | null,
	selectedBy: string,
	executor?: DbExecutor,
) {
	const run = async (exec: DbExecutor) => {
		// Soft-delete any existing active selection for this (applicationId, choiceEffectId)
		await exec
			.update(screeningRoutineSelections)
			.set({ archivedAt: new Date(), archivedBy: selectedBy })
			.where(
				and(
					eq(screeningRoutineSelections.applicationId, applicationId),
					eq(screeningRoutineSelections.choiceEffectId, choiceEffectId),
					isNull(screeningRoutineSelections.archivedAt),
				),
			)

		// Insert the new active selection
		await exec.insert(screeningRoutineSelections).values({
			applicationId,
			choiceEffectId,
			routineId,
			selectedBy,
			selectedAt: new Date(),
		})

		await writeAuditLog(
			{
				action: "screening_routine_selected",
				entityType: "screening_routine_selection",
				entityId: `${applicationId}/${choiceEffectId}`,
				newValue: routineId ?? "null",
				performedBy: selectedBy,
			},
			exec,
		)
	}

	if (executor) {
		await run(executor)
	} else {
		await db.transaction(run)
	}
}

/**
 * For a list of session answers (questionId + answer label), returns all
 * `preset_routine` effects that have a preset routine set. Used by
 * `completeScreeningSession` to auto-apply preset routines atomically.
 */
export async function getPresetRoutinesForAnswers(
	answers: Array<{ questionId: string; answer: string }>,
	executor?: DbExecutor,
): Promise<Array<{ effectId: string; presetRoutineId: string }>> {
	if (answers.length === 0) return []
	const exec = executor ?? db

	const questionIds = answers.map((a) => a.questionId)

	const matchingChoices = await exec
		.select({
			id: screeningQuestionChoices.id,
			questionId: screeningQuestionChoices.questionId,
			label: screeningQuestionChoices.label,
		})
		.from(screeningQuestionChoices)
		.where(and(inArray(screeningQuestionChoices.questionId, questionIds), isNull(screeningQuestionChoices.archivedAt)))

	const answerToChoice = new Map<string, string>()
	for (const c of matchingChoices) {
		answerToChoice.set(`${c.questionId}|${c.label}`, c.id)
	}

	const matchedChoiceIds = answers
		.map((a) => answerToChoice.get(`${a.questionId}|${a.answer}`))
		.filter((id): id is string => id !== undefined)

	if (matchedChoiceIds.length === 0) return []

	const effects = await exec
		.select({ id: screeningChoiceEffects.id, presetRoutineId: screeningChoiceEffects.presetRoutineId })
		.from(screeningChoiceEffects)
		.innerJoin(
			routines,
			and(
				eq(routines.id, screeningChoiceEffects.presetRoutineId),
				isNull(routines.archivedAt),
				eq(routines.status, "approved"),
			),
		)
		.innerJoin(
			routineControls,
			and(
				eq(routineControls.routineId, screeningChoiceEffects.presetRoutineId),
				eq(routineControls.controlId, screeningChoiceEffects.controlId),
				isNull(routineControls.archivedAt),
			),
		)
		.where(
			and(
				inArray(screeningChoiceEffects.choiceId, matchedChoiceIds),
				eq(screeningChoiceEffects.effect, "preset_routine"),
				isNotNull(screeningChoiceEffects.presetRoutineId),
				isNull(screeningChoiceEffects.archivedAt),
			),
		)

	return effects
		.filter((e): e is { id: string; presetRoutineId: string } => e.presetRoutineId !== null)
		.map((e) => ({ effectId: e.id, presetRoutineId: e.presetRoutineId }))
}

/**
 * Returns routines for ALL controls, filtered by tech element overlap.
 * Used in admin loader so the add-effect form can show a routine dropdown
 * immediately when "Valgt rutine" (preset_routine) is selected, without
 * an extra round-trip per control.
 */
export async function getRoutinesForAllControlsAndTechElements(
	questionTechElementIds: string[],
): Promise<Record<string, Array<{ id: string; name: string }>>> {
	// Load all approved, non-archived routines with their control links
	const linkedRoutines = await db
		.select({
			controlId: routineControls.controlId,
			routineId: routines.id,
			routineName: routines.name,
		})
		.from(routineControls)
		.innerJoin(routines, eq(routineControls.routineId, routines.id))
		.where(
			and(
				isNull(routineControls.archivedAt),
				eq(routines.status, "approved"),
				isNull(routines.archivedAt),
				isNull(routines.replacedByRoutineId),
			),
		)

	if (linkedRoutines.length === 0) return {}

	const routineIds = [...new Set(linkedRoutines.map((r) => r.routineId))]

	// Load tech element restrictions for these routines
	const techLinks = await db
		.select({ routineId: routineTechnologyElements.routineId, elementId: routineTechnologyElements.elementId })
		.from(routineTechnologyElements)
		.where(and(inArray(routineTechnologyElements.routineId, routineIds), isNull(routineTechnologyElements.archivedAt)))

	const techByRoutine = new Map<string, string[]>()
	for (const link of techLinks) {
		const list = techByRoutine.get(link.routineId) ?? []
		list.push(link.elementId)
		techByRoutine.set(link.routineId, list)
	}

	const questionTechSet = new Set(questionTechElementIds)

	// Load framework controls to get their controlTextId (string ID like "K-TS.01")
	const controlIds = [...new Set(linkedRoutines.map((r) => r.controlId))]
	const ctrlRows = await db
		.select({ id: frameworkControls.id, controlTextId: frameworkControls.controlId })
		.from(frameworkControls)
		.where(inArray(frameworkControls.id, controlIds))
	const controlTextIdMap = new Map(ctrlRows.map((c) => [c.id, c.controlTextId]))

	const result: Record<string, Array<{ id: string; name: string }>> = {}
	for (const lr of linkedRoutines) {
		const controlTextId = controlTextIdMap.get(lr.controlId)
		if (!controlTextId) continue

		const requiredElements = techByRoutine.get(lr.routineId)
		const techMatch =
			questionTechElementIds.length === 0 || // isNew: vis alle rutiner uavhengig av tech-restriksjoner
			!requiredElements ||
			requiredElements.length === 0 ||
			requiredElements.some((el) => questionTechSet.has(el))
		if (!techMatch) continue

		const list = result[controlTextId] ?? []
		if (!list.some((r) => r.id === lr.routineId)) {
			list.push({ id: lr.routineId, name: lr.routineName })
		}
		result[controlTextId] = list
	}
	for (const list of Object.values(result)) {
		list.sort((a, b) => a.name.localeCompare(b.name, "nb"))
	}
	return result
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
				isNull(screeningRoutineSelections.archivedAt),
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
				isNull(screeningRoutineSelections.archivedAt),
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
