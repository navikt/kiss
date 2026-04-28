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
	setQuestionTechnologyElements,
	updateChoice,
	updateScreeningQuestion,
} from "~/db/queries/screening.server"
import { getSectionBySlug } from "~/db/queries/sections.server"
import { getAllTechnologyElements } from "~/db/queries/technology-elements.server"
import { validScreeningQuestionStatuses } from "~/db/schema/screening"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { requireAdmin } from "~/lib/authorization.server"
import { renderMarkdown } from "~/lib/markdown.server"

export async function loader({ request, params }: LoaderFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	requireAdmin(authedUser)

	const seksjon = params.seksjon
	if (!seksjon) throw new Response("Mangler seksjon", { status: 400 })

	const section = await getSectionBySlug(seksjon)
	if (!section) throw new Response("Seksjon ikke funnet", { status: 404 })

	const sectionId = section.id
	const sectionName = section.name
	const returnPath = `/seksjoner/${seksjon}/screening`

	const questionId = params.questionId as string
	const isNew = questionId === "ny"

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
	requireAdmin(authedUser)

	const seksjon = params.seksjon
	const questionId = params.questionId as string
	const formData = await request.formData()
	const intent = formData.get("intent") as string
	const sectionId = formData.get("sectionId") as string | null
	const returnPath = `/seksjoner/${seksjon}/screening`

	if (intent === "updateQuestion") {
		const questionText = formData.get("questionText") as string
		const description = (formData.get("description") as string)?.trim() || null
		const displayOrder = Number(formData.get("displayOrder") ?? 0)
		const answerType = (formData.get("answerType") as string) || "boolean"
		const technologyElementIds = formData.getAll("technologyElementIds") as string[]
		const rulesetId = (formData.get("rulesetId") as string) || null
		if (!questionText?.trim()) throw new Response("Ugyldig data", { status: 400 })

		if (questionId === "ny") {
			const q = await createScreeningQuestion(
				questionText.trim(),
				description,
				displayOrder,
				authedUser.navIdent,
				sectionId,
				answerType,
				rulesetId,
			)

			await setQuestionTechnologyElements(q.id, technologyElementIds.filter(Boolean), authedUser.navIdent)

			const pendingChoicesJson = formData.get("pendingChoices") as string | null
			if (pendingChoicesJson) {
				const pending = JSON.parse(pendingChoicesJson) as PendingChoice[]
				for (const pc of pending) {
					const existingChoices = await getChoicesForQuestion(q.id)
					const existing = existingChoices.find((c) => c.label === pc.label)
					const choiceId = existing
						? existing.id
						: (
								await createChoice({
									questionId: q.id,
									label: pc.label,
									requiresComment: pc.requiresComment,
									requiresLink: pc.requiresLink,
									displayOrder: pc.displayOrder,
								})
							).id

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

		await updateScreeningQuestion(
			questionId,
			questionText.trim(),
			description,
			displayOrder,
			authedUser.navIdent,
			rulesetId,
		)
		await setQuestionTechnologyElements(questionId, technologyElementIds.filter(Boolean), authedUser.navIdent)
		return redirect(returnPath)
	}

	if (intent === "addChoice") {
		const label = (formData.get("label") as string)?.trim()
		const requiresComment = formData.get("requiresComment") === "on"
		const requiresLink = formData.get("requiresLink") === "on"
		if (!label) throw new Response("Mangler data", { status: 400 })
		await createChoice({ questionId, label, requiresComment, requiresLink })
	}

	if (intent === "updateChoice") {
		const choiceId = formData.get("choiceId") as string
		const requiresComment = formData.get("requiresComment") === "on"
		const requiresLink = formData.get("requiresLink") === "on"
		if (!choiceId) throw new Response("Mangler ID", { status: 400 })
		await updateChoice(choiceId, { requiresComment, requiresLink })
	}

	if (intent === "deleteChoice") {
		const choiceId = formData.get("choiceId") as string
		if (!choiceId) throw new Response("Mangler ID", { status: 400 })
		await archiveChoice(choiceId, authedUser.navIdent)
	}

	if (intent === "addEffect") {
		const choiceId = formData.get("choiceId") as string
		const controlTextId = formData.get("controlTextId") as string
		const effect = formData.get("effect") as string
		const comment = formData.get("comment") as string
		if (!choiceId || !controlTextId) throw new Response("Mangler data", { status: 400 })
		await addChoiceEffect({
			choiceId,
			controlTextId,
			effect: effect || null,
			comment: comment || null,
		})
	}

	if (intent === "deleteEffect") {
		const effectId = formData.get("effectId") as string
		if (!effectId) throw new Response("Mangler effect-ID", { status: 400 })
		await archiveChoiceEffect(effectId, authedUser.navIdent)
	}

	if (intent === "changeStatus") {
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
	}

	return data({ success: true })
}

// Re-export the component from the admin route (same UI, different context)
export { default } from "~/routes/admin.screening.$questionId.rediger"

export { RouteErrorBoundary as ErrorBoundary }
