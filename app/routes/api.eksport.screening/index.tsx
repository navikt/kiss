import type { LoaderFunctionArgs } from "react-router"
import { getChoiceEffects, getChoicesForQuestion, getScreeningQuestions } from "~/db/queries/screening.server"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"

export async function loader({ request }: LoaderFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	requireUser(user)

	const questions = await getScreeningQuestions()

	const data = await Promise.all(
		questions.map(async (q) => {
			const choices = await getChoicesForQuestion(q.id)
			const choicesWithEffects = await Promise.all(
				choices.map(async (c) => {
					const effects = await getChoiceEffects(c.id)
					return {
						navn: c.label,
						kreverKommentar: c.requiresComment,
						kreverLenke: c.requiresLink,
						effekter: effects.map((e) => ({
							kontroll: e.controlTextId,
							effekt: e.effect,
							kommentar: e.comment,
						})),
					}
				}),
			)
			return {
				sporsmal: q.questionText,
				beskrivelse: q.description,
				svartype: q.answerType,
				rekkefølge: q.displayOrder,
				valgmuligheter: choicesWithEffects,
			}
		}),
	)

	return new Response(
		JSON.stringify(
			{
				eksportert: new Date().toISOString(),
				type: "Globale innledende spørsmål",
				innledendeSporsmal: data,
			},
			null,
			2,
		),
		{
			headers: {
				"Content-Type": "application/json",
				"Content-Disposition": 'attachment; filename="globale-screening-sporsmal.json"',
			},
		},
	)
}
