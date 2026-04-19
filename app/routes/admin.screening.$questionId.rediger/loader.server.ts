import type { LoaderFunctionArgs } from "react-router"
import { data } from "react-router"
import { getAllControls } from "~/db/queries/framework.server"
import {
	getChoiceEffects,
	getChoicesForQuestion,
	getQuestionTechnologyElements,
	getScreeningQuestion,
} from "~/db/queries/screening.server"
import { getSectionBySlug } from "~/db/queries/sections.server"
import { getAllTechnologyElements } from "~/db/queries/technology-elements.server"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { requireAdmin } from "~/lib/authorization.server"
import { renderMarkdown } from "~/lib/markdown.server"

export async function loader({ request, params }: LoaderFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	requireAdmin(authedUser)

	const url = new URL(request.url)
	const seksjonSlug = url.searchParams.get("seksjon")

	let sectionId: string | null = null
	let sectionName: string | null = null

	if (seksjonSlug) {
		const section = await getSectionBySlug(seksjonSlug)
		if (!section) throw new Response("Seksjon ikke funnet", { status: 404 })
		sectionId = section.id
		sectionName = section.name
	}

	const questionId = params.questionId as string
	const isNew = questionId === "ny"

	const returnPath = seksjonSlug ? `/admin/screening?seksjon=${seksjonSlug}` : "/admin/screening"

	if (isNew) {
		const [controls, technologyElementsList] = await Promise.all([getAllControls(), getAllTechnologyElements()])
		return data({
			isNew: true,
			question: {
				id: "ny",
				questionText: "",
				description: null,
				descriptionHtml: "",
				displayOrder: 0,
				answerType: "",
				rulesetId: null as string | null,
				technologyElementIds: [] as string[],
			},
			choices: [],
			controls,
			technologyElements: technologyElementsList,
			rulesets: [] as { id: string; name: string }[],
			seksjon: seksjonSlug,
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

	const [controls, technologyElementsList, questionTechElements] = await Promise.all([
		getAllControls(),
		getAllTechnologyElements(),
		getQuestionTechnologyElements(questionId),
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
		rulesets: [] as { id: string; name: string }[],
		seksjon: seksjonSlug,
		sectionId,
		sectionName,
		returnPath,
	})
}
