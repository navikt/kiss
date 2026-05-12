import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, redirect } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getAllControls } from "~/db/queries/framework.server"
import { getRulesetsForSection } from "~/db/queries/rulesets.server"
import {
	addChoiceEffect,
	archiveChoice,
	archiveChoiceEffect,
	changeScreeningQuestionStatus,
	createChoice,
	createScreeningQuestion,
	getChoiceEffects,
	getChoicesForQuestion,
	getQuestionTechnologyElements,
	getScreeningQuestion,
	isEffectOwnedByQuestion,
	setQuestionTechnologyElements,
	updateChoice,
	updateScreeningQuestion,
} from "~/db/queries/screening.server"
import { getSectionBySlug } from "~/db/queries/sections.server"
import { getAllTechnologyElements } from "~/db/queries/technology-elements.server"
import { screeningEffectEnum, validScreeningQuestionStatuses } from "~/db/schema/screening"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { requireAnySectionRole } from "~/lib/authorization.server"
import { renderMarkdown } from "~/lib/markdown.server"
import { requireUuid } from "~/lib/utils"

export async function loader({ request, params }: LoaderFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)

	const seksjon = params.seksjon
	if (!seksjon) throw new Response("Mangler seksjon", { status: 400 })

	const section = await getSectionBySlug(seksjon)
	if (!section) throw new Response("Seksjon ikke funnet", { status: 404 })

	requireAnySectionRole(authedUser, section.id)

	const sectionId = section.id
	const sectionName = section.name
	const returnPath = `/seksjoner/${seksjon}/screening`

	const questionId = params.questionId as string
	const isNew = questionId === "ny"

	if (!isNew) requireUuid(questionId, "questionId")

	if (isNew) {
		const [controls, technologyElementsList, sectionRulesets] = await Promise.all([
			getAllControls(),
			getAllTechnologyElements(),
			getRulesetsForSection(sectionId),
		])
		return data({
			isNew: true,
			question: {
				id: "ny",
				questionText: "",
				description: null,
				descriptionHtml: "",
				displayOrder: 0,
				answerType: "",
				status: "draft" as const,
				rulesetId: null as string | null,
				technologyElementIds: [] as string[],
			},
			choices: [],
			controls,
			technologyElements: technologyElementsList,
			rulesets: sectionRulesets.map((rs) => ({ id: rs.id, name: rs.name })),
			seksjon,
			sectionId,
			sectionName,
			returnPath,
		})
	}

	const question = await getScreeningQuestion(questionId)
	if (!question) throw new Response("Spørsmål ikke funnet", { status: 404 })
	if (question.sectionId !== sectionId) throw new Response("Spørsmålet tilhører ikke denne seksjonen", { status: 403 })

	const choices = await getChoicesForQuestion(questionId)
	const choicesWithEffects = await Promise.all(
		choices.map(async (c) => {
			const effects = await getChoiceEffects(c.id)
			return { ...c, effects }
		}),
	)

	const [controls, technologyElementsList, questionTechElements, sectionRulesets] = await Promise.all([
		getAllControls(),
		getAllTechnologyElements(),
		getQuestionTechnologyElements(questionId),
		getRulesetsForSection(sectionId),
	])

	return data({
		isNew: false,
		question: {
			...question,
			descriptionHtml: renderMarkdown(question.description),
			technologyElementIds: questionTechElements.map((e) => e.elementId),
		},
		choices: choicesWithEffects,
		controls,
		technologyElements: technologyElementsList,
		rulesets: sectionRulesets.map((rs) => ({ id: rs.id, name: rs.name })),
		seksjon,
		sectionId,
		sectionName,
		returnPath,
	})
}

interface PendingEffectItem {
	clientId: string
	controlTextId: string
	controlName: string
	effect: string | null
	comment: string | null
}

interface PendingChoice {
	clientId: string
	label: string
	requiresComment: boolean
	requiresLink: boolean
	displayOrder: number
	effects: PendingEffectItem[]
}

export async function action({ request, params }: ActionFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)

	const seksjon = params.seksjon
	if (!seksjon) throw new Response("Mangler seksjon", { status: 400 })

	const section = await getSectionBySlug(seksjon)
	if (!section) throw new Response("Seksjon ikke funnet", { status: 404 })

	requireAnySectionRole(authedUser, section.id)

	const questionId = params.questionId as string
	const formData = await request.formData()
	const intent = formData.get("intent") as string
	const returnPath = `/seksjoner/${seksjon}/screening`

	// For existing questions, verify UUID format and ownership before any mutation
	if (questionId !== "ny") {
		requireUuid(questionId, "questionId")
		const existingQuestion = await getScreeningQuestion(questionId)
		if (!existingQuestion) throw new Response("Spørsmål ikke funnet", { status: 404 })
		if (existingQuestion.sectionId !== section.id)
			throw new Response("Spørsmålet tilhører ikke denne seksjonen", { status: 403 })
	} else if (intent !== "updateQuestion") {
		throw new Response("Kan ikke utføre denne handlingen på et spørsmål som ikke er opprettet ennå", { status: 400 })
	}

	// Helper to validate that a choiceId belongs to this question
	async function validateChoiceOwnership(choiceId: string) {
		requireUuid(choiceId, "choiceId")
		const choices = await getChoicesForQuestion(questionId, { includeArchived: true })
		if (!choices.some((c) => c.id === choiceId))
			throw new Response("Valget tilhører ikke dette spørsmålet", { status: 403 })
	}

	// Helper to validate that an effectId belongs to a choice on this question
	async function validateEffectOwnership(effectId: string) {
		requireUuid(effectId, "effectId")
		const owned = await isEffectOwnedByQuestion(effectId, questionId)
		if (!owned) throw new Response("Effekten tilhører ikke dette spørsmålet", { status: 403 })
	}

	const validEffects: readonly string[] = screeningEffectEnum

	switch (intent) {
		case "updateQuestion": {
			const questionText = formData.get("questionText") as string
			const description = (formData.get("description") as string)?.trim() || null
			const answerType = (formData.get("answerType") as string) || "boolean"
			const technologyElementIds = formData.getAll("technologyElementIds") as string[]
			const rulesetId = (formData.get("rulesetId") as string) || null
			if (!questionText?.trim()) throw new Response("Ugyldig data", { status: 400 })

			if (questionId === "ny") {
				const q = await createScreeningQuestion(
					questionText.trim(),
					description,
					authedUser.navIdent,
					section.id,
					answerType,
					rulesetId,
				)

				await setQuestionTechnologyElements(q.id, technologyElementIds.filter(Boolean), authedUser.navIdent)

				const pendingChoicesJson = formData.get("pendingChoices") as string | null
				if (pendingChoicesJson) {
					let pending: PendingChoice[]
					try {
						pending = JSON.parse(pendingChoicesJson) as PendingChoice[]
					} catch {
						throw new Response("Ugyldig JSON i pendingChoices", { status: 400 })
					}
					if (!Array.isArray(pending)) throw new Response("pendingChoices må være en liste", { status: 400 })
					for (const pc of pending) {
						if (!pc.label || typeof pc.label !== "string")
							throw new Response("Hvert valg må ha en label", { status: 400 })
						if (pc.requiresComment != null && typeof pc.requiresComment !== "boolean")
							throw new Response("requiresComment må være boolean", { status: 400 })
						if (pc.requiresLink != null && typeof pc.requiresLink !== "boolean")
							throw new Response("requiresLink må være boolean", { status: 400 })
						if (pc.displayOrder != null && typeof pc.displayOrder !== "number")
							throw new Response("displayOrder må være et tall", { status: 400 })
						if (!Array.isArray(pc.effects)) throw new Response("Hvert valg må ha en effects-liste", { status: 400 })
						for (const eff of pc.effects) {
							if (!eff.controlTextId || typeof eff.controlTextId !== "string")
								throw new Response("Hver effekt må ha controlTextId", { status: 400 })
							if (eff.effect != null && !validEffects.includes(eff.effect))
								throw new Response(`Ugyldig effect-verdi: ${eff.effect}`, { status: 400 })
							if (eff.comment != null && typeof eff.comment !== "string")
								throw new Response("comment må være en streng eller null", { status: 400 })
						}
					}
					const existingChoices = await getChoicesForQuestion(q.id)
					const choicesByLabel = new Map(existingChoices.map((c) => [c.label, c.id]))
					for (const pc of pending) {
						const existing = choicesByLabel.get(pc.label)
						const choiceId =
							existing ??
							(
								await createChoice({
									questionId: q.id,
									label: pc.label,
									requiresComment: pc.requiresComment,
									requiresLink: pc.requiresLink,
									displayOrder: pc.displayOrder,
								})
							).id

						choicesByLabel.set(pc.label, choiceId)

						for (const eff of pc.effects) {
							await addChoiceEffect({
								choiceId,
								controlTextId: eff.controlTextId,
								effect: eff.effect,
								comment: eff.comment,
							})
						}
					}
				}

				return redirect(returnPath)
			}

			await updateScreeningQuestion(questionId, questionText.trim(), description, authedUser.navIdent, rulesetId)
			await setQuestionTechnologyElements(questionId, technologyElementIds.filter(Boolean), authedUser.navIdent)
			return redirect(returnPath)
		}
		case "addChoice": {
			const label = (formData.get("label") as string)?.trim()
			const requiresComment = formData.get("requiresComment") === "on"
			const requiresLink = formData.get("requiresLink") === "on"
			if (!label) throw new Response("Mangler data", { status: 400 })
			await createChoice({ questionId, label, requiresComment, requiresLink })
			break
		}
		case "updateChoice": {
			const choiceId = formData.get("choiceId") as string
			const requiresComment = formData.get("requiresComment") === "on"
			const requiresLink = formData.get("requiresLink") === "on"
			if (!choiceId) throw new Response("Mangler ID", { status: 400 })
			await validateChoiceOwnership(choiceId)
			await updateChoice(choiceId, { requiresComment, requiresLink })
			break
		}
		case "deleteChoice": {
			const choiceId = formData.get("choiceId") as string
			if (!choiceId) throw new Response("Mangler ID", { status: 400 })
			await validateChoiceOwnership(choiceId)
			await archiveChoice(choiceId, authedUser.navIdent)
			break
		}
		case "addEffect": {
			const choiceId = formData.get("choiceId") as string
			const controlTextId = formData.get("controlTextId") as string
			const effect = formData.get("effect") as string
			const comment = formData.get("comment") as string
			if (!choiceId || !controlTextId) throw new Response("Mangler data", { status: 400 })
			const effectValue = effect || null
			if (effectValue != null && !validEffects.includes(effectValue))
				throw new Response(`Ugyldig effect-verdi: ${effectValue}`, { status: 400 })
			await validateChoiceOwnership(choiceId)
			try {
				await addChoiceEffect({
					choiceId,
					controlTextId,
					effect: effectValue,
					comment: comment || null,
				})
			} catch (err) {
				if (err instanceof Error && err.message.includes("ikke funnet"))
					throw new Response(err.message, { status: 400 })
				throw err
			}
			break
		}
		case "deleteEffect": {
			const effectId = formData.get("effectId") as string
			if (!effectId) throw new Response("Mangler effect-ID", { status: 400 })
			await validateEffectOwnership(effectId)
			await archiveChoiceEffect(effectId, authedUser.navIdent)
			break
		}
		case "changeStatus": {
			if (questionId === "ny") {
				throw new Response("Kan ikke endre status på et spørsmål som ikke er opprettet ennå", { status: 400 })
			}
			const newStatus = formData.get("newStatus")
			if (typeof newStatus !== "string" || !(validScreeningQuestionStatuses as readonly string[]).includes(newStatus)) {
				throw new Response("Ugyldig status", { status: 400 })
			}
			await changeScreeningQuestionStatus(
				questionId,
				newStatus as (typeof validScreeningQuestionStatuses)[number],
				authedUser.navIdent,
			)
			break
		}
		default:
			throw new Response(`Ukjent intent: ${intent}`, { status: 400 })
	}

	return data({ success: true })
}

// Re-export the component from the admin route (same UI, different context)
export { default } from "~/routes/admin.screening.$questionId.rediger"

export { RouteErrorBoundary as ErrorBoundary }
