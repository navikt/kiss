import type { ActionFunctionArgs } from "react-router"
import { data, redirect } from "react-router"
import {
	addChoiceEffect,
	createChoice,
	createScreeningQuestion,
	deleteChoice,
	deleteChoiceEffect,
	getChoicesForQuestion,
	setQuestionTechnologyElements,
	updateChoice,
	updateScreeningQuestion,
} from "~/db/queries/screening.server"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { requireAdmin } from "~/lib/authorization.server"
import type { PendingChoice } from "./shared"

export async function action({ request, params }: ActionFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	requireAdmin(authedUser)

	const questionId = params.questionId as string
	const formData = await request.formData()
	const intent = formData.get("intent") as string
	const sectionId = formData.get("sectionId") as string | null
	const returnPath = (formData.get("returnPath") as string) || "/admin/screening"

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

			await setQuestionTechnologyElements(q.id, technologyElementIds.filter(Boolean))

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
		await setQuestionTechnologyElements(questionId, technologyElementIds.filter(Boolean))
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
		await deleteChoice(choiceId)
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
		await deleteChoiceEffect(effectId)
	}

	return data({ success: true })
}
