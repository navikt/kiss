import type { LoaderFunctionArgs } from "react-router"
import { data } from "react-router"
import { getAllControlsForSelection } from "~/db/queries/framework.server"
import { getRoutine } from "~/db/queries/routines.server"
import {
	getChoicesForQuestion,
	getScreeningQuestions,
	getSectionScreeningQuestions,
} from "~/db/queries/screening.server"
import { getSectionBySlug } from "~/db/queries/sections.server"
import { getAllTechnologyElements } from "~/db/queries/technology-elements.server"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { canApproveRoutine, requireAdmin } from "~/lib/authorization.server"

export async function loader({ request, params }: LoaderFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	requireAdmin(authedUser)

	const { seksjon, rutineId } = params
	if (!seksjon || !rutineId) throw new Response("Mangler parametere", { status: 400 })

	const section = await getSectionBySlug(seksjon)
	if (!section) throw new Response("Seksjon ikke funnet", { status: 404 })

	const routine = await getRoutine(rutineId)
	if (!routine) throw new Response("Rutine ikke funnet", { status: 404 })

	const [globalQuestions, sectionQuestions, technologyElements, controls] = await Promise.all([
		getScreeningQuestions(),
		getSectionScreeningQuestions(section.id),
		getAllTechnologyElements(),
		getAllControlsForSelection(),
	])

	const allQuestions = [...globalQuestions, ...sectionQuestions]
	const questionsWithChoices = await Promise.all(
		allQuestions.map(async (q) => ({
			...q,
			isSection: q.sectionId !== null,
			choices: await getChoicesForQuestion(q.id),
		})),
	)

	const effectiveRole = routine.responsibleRole || routine.controls.find((c) => c.responsible)?.responsible || null
	const userCanApprove = canApproveRoutine(authedUser, effectiveRole, section.id)

	return data({
		seksjon,
		section,
		routine,
		questionsWithChoices,
		technologyElements,
		controls,
		userCanApprove,
	})
}
