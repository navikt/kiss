import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, redirect } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getAllControls } from "~/db/queries/framework.server"
import { getRulesetsForSection } from "~/db/queries/rulesets.server"
import {
	archiveChoice,
	archiveChoiceEffect,
	changeScreeningQuestionStatus,
	createChoice,
	createScreeningQuestion,
	getChoiceEffects,
	getChoicesForQuestion,
	getQuestionTechnologyElements,
	getRoutinesForAllControlsAndTechElements,
	getScreeningQuestion,
	getSectionScreeningQuestions,
	isEffectOwnedByQuestion,
	setQuestionTechnologyElements,
	updateChoice,
	updateScreeningQuestion,
} from "~/db/queries/screening.server"
import { getSectionBySlug } from "~/db/queries/sections.server"
import { getAllTechnologyElements } from "~/db/queries/technology-elements.server"
import { validScreeningQuestionStatuses } from "~/db/schema/screening"
import { requireAuthenticatedUser } from "~/lib/auth.server"
import { requireAnySectionRole } from "~/lib/authorization.server"
import { renderMarkdown } from "~/lib/markdown.server"
import { applyPendingChoices, parsePendingChoices, validateAndAddChoiceEffect } from "~/lib/screening-actions.server"
import { requireUuid } from "~/lib/utils"

export async function loader({ request, params }: LoaderFunctionArgs) {
	const authedUser = await requireAuthenticatedUser(request)

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
		const [controls, technologyElementsList, sectionRulesets, sectionQuestions, allRoutinesForControls] =
			await Promise.all([
				getAllControls(),
				getAllTechnologyElements(),
				getRulesetsForSection(sectionId),
				getSectionScreeningQuestions(sectionId, { includeArchived: false }),
				getRoutinesForAllControlsAndTechElements([]),
			])
		const hasExistingEconomyQuestion = sectionQuestions.some((q) => q.answerType === "economy_system")
		return data({
			isNew: true,
			hasExistingEconomyQuestion,
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
			allRoutinesForControls,
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

	const techElementIds = questionTechElements.map((e) => e.elementId)

	// Load all routines for all controls (for the add-effect form preset_routine dropdown)
	const allRoutinesForControls = await getRoutinesForAllControlsAndTechElements(techElementIds)

	return data({
		isNew: false,
		hasExistingEconomyQuestion: false,
		question: {
			...question,
			descriptionHtml: renderMarkdown(question.description),
			technologyElementIds: techElementIds,
		},
		choices: choicesWithEffects,
		controls,
		technologyElements: technologyElementsList,
		rulesets: sectionRulesets.map((rs) => ({ id: rs.id, name: rs.name })),
		allRoutinesForControls,
		seksjon,
		sectionId,
		sectionName,
		returnPath,
	})
}

export async function action({ request, params }: ActionFunctionArgs) {
	const authedUser = await requireAuthenticatedUser(request)

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

				const pending = parsePendingChoices(formData.get("pendingChoices") as string | null)
				await applyPendingChoices(q.id, pending)

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
			const choiceIdRaw = formData.get("choiceId")
			const controlTextIdRaw = formData.get("controlTextId")
			const effectRaw = formData.get("effect")
			const commentRaw = formData.get("comment")
			const presetRoutineIdRaw = formData.get("presetRoutineId")
			if (typeof choiceIdRaw !== "string" || !choiceIdRaw) throw new Response("Mangler choiceId", { status: 400 })
			if (typeof controlTextIdRaw !== "string" || !controlTextIdRaw)
				throw new Response("Mangler controlTextId", { status: 400 })
			if (effectRaw != null && typeof effectRaw !== "string")
				throw new Response("effect må være en streng", { status: 400 })
			if (commentRaw != null && typeof commentRaw !== "string")
				throw new Response("comment må være en streng", { status: 400 })
			const effectValue = effectRaw || null
			const presetRoutineIdValue = (typeof presetRoutineIdRaw === "string" && presetRoutineIdRaw) || null
			await validateChoiceOwnership(choiceIdRaw)
			await validateAndAddChoiceEffect({
				choiceId: choiceIdRaw,
				controlTextId: controlTextIdRaw,
				effect: effectValue,
				comment: commentRaw || null,
				presetRoutineId: presetRoutineIdValue,
			})
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
