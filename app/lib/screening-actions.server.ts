import { addChoiceEffect, createChoice, getChoicesForQuestion } from "~/db/queries/screening.server"
import { type ScreeningEffect, screeningEffectEnum } from "~/db/schema/screening"
import { isValidUuid } from "~/lib/utils"
import { type PendingChoice, ScreeningValidationError } from "./screening-types"

/**
 * Validerer felt for en effekt-rad og kaller addChoiceEffect.
 * Konverterer kun ScreeningValidationError (kjente input-feil) til Response(400).
 * DB-/nettverksfeil propageres som 500.
 */
export async function validateAndAddChoiceEffect({
	choiceId,
	controlTextId,
	effect,
	comment,
	presetRoutineId,
}: {
	choiceId: string
	controlTextId: string
	effect: string | null
	comment: string | null
	presetRoutineId: string | null
}): Promise<void> {
	if (effect != null && !(screeningEffectEnum as readonly string[]).includes(effect))
		throw new Response(`Ugyldig effect-verdi: ${effect}`, { status: 400 })

	const typedEffect = effect as ScreeningEffect | null

	if (typedEffect === "preset_routine" && presetRoutineId === null)
		throw new Response("Effekt 'Valgt rutine' krever at en rutine er valgt", { status: 400 })
	if (presetRoutineId !== null && typedEffect !== "preset_routine")
		throw new Response("presetRoutineId kan kun brukes med 'Valgt rutine'-effekt", { status: 400 })
	if (presetRoutineId !== null && !isValidUuid(presetRoutineId))
		throw new Response("Ugyldig rutine-ID format", { status: 400 })

	try {
		await addChoiceEffect({ choiceId, controlTextId, effect: typedEffect, comment, presetRoutineId })
	} catch (err) {
		if (err instanceof ScreeningValidationError) throw new Response(err.message, { status: 400 })
		throw err
	}
}

/**
 * Parser og validerer pendingChoices-JSON fra formData.
 * Kaster Response(400) ved ugyldige data.
 */
export function parsePendingChoices(json: string | null): PendingChoice[] {
	if (!json) return []
	let parsed: unknown
	try {
		parsed = JSON.parse(json)
	} catch {
		throw new Response("Ugyldig JSON i pendingChoices", { status: 400 })
	}
	if (!Array.isArray(parsed)) throw new Response("pendingChoices må være en liste", { status: 400 })
	for (const pc of parsed) {
		if (typeof pc !== "object" || pc === null) throw new Response("Hvert valg må være et objekt", { status: 400 })
		const choice = pc as Record<string, unknown>
		if (!choice.label || typeof choice.label !== "string")
			throw new Response("Hvert valg må ha en label", { status: 400 })
		if (choice.requiresComment != null && typeof choice.requiresComment !== "boolean")
			throw new Response("requiresComment må være boolean", { status: 400 })
		if (choice.requiresLink != null && typeof choice.requiresLink !== "boolean")
			throw new Response("requiresLink må være boolean", { status: 400 })
		if (choice.displayOrder != null && typeof choice.displayOrder !== "number")
			throw new Response("displayOrder må være et tall", { status: 400 })
		if (!Array.isArray(choice.effects)) throw new Response("Hvert valg må ha en effects-liste", { status: 400 })
		for (const eff of choice.effects) {
			if (typeof eff !== "object" || eff === null) throw new Response("Hver effekt må være et objekt", { status: 400 })
			const effect = eff as Record<string, unknown>
			if (!effect.controlTextId || typeof effect.controlTextId !== "string")
				throw new Response("Hver effekt må ha controlTextId", { status: 400 })
			if (effect.effect != null && !(screeningEffectEnum as readonly string[]).includes(effect.effect as string))
				throw new Response(`Ugyldig effect-verdi: ${effect.effect}`, { status: 400 })
			if (effect.comment != null && typeof effect.comment !== "string")
				throw new Response("comment må være en streng eller null", { status: 400 })
		}
	}
	return parsed as PendingChoice[]
}

/**
 * Oppretter valg og effekter fra en validert pendingChoices-liste.
 * Eksisterende valg (matchet på label) gjenbrukes.
 */
export async function applyPendingChoices(questionId: string, pending: PendingChoice[]): Promise<void> {
	if (pending.length === 0) return
	const existingChoices = await getChoicesForQuestion(questionId)
	const choicesByLabel = new Map(existingChoices.map((c) => [c.label, c.id]))
	for (const pc of pending) {
		const existing = choicesByLabel.get(pc.label)
		const choiceId =
			existing ??
			(
				await createChoice({
					questionId,
					label: pc.label,
					requiresComment: pc.requiresComment,
					requiresLink: pc.requiresLink,
					displayOrder: pc.displayOrder,
				})
			).id
		choicesByLabel.set(pc.label, choiceId)
		for (const eff of pc.effects) {
			await validateAndAddChoiceEffect({
				choiceId,
				controlTextId: eff.controlTextId,
				effect: eff.effect,
				comment: eff.comment,
				presetRoutineId: eff.presetRoutineId ?? null,
			})
		}
	}
}
