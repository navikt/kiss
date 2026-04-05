import { Button, Checkbox, CheckboxGroup, Heading, HStack, Select, Textarea, TextField, VStack } from "@navikt/ds-react"
import { useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, Link, redirect, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { createRoutine } from "~/db/queries/routines.server"
import { getChoicesForQuestion, getScreeningQuestions } from "~/db/queries/screening.server"
import { getSectionBySlug } from "~/db/queries/sections.server"
import { getAllTechnologyElements } from "~/db/queries/technology-elements.server"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { frequencyLabels, isRoutineFrequency, ROUTINE_FREQUENCIES } from "~/lib/routine-frequencies"

export async function loader({ params }: LoaderFunctionArgs) {
	const { seksjon } = params
	if (!seksjon) {
		throw data({ message: "Mangler seksjonsparameter" }, { status: 400 })
	}

	const section = await getSectionBySlug(seksjon)
	if (!section) {
		throw data({ message: `Fant ikke seksjon: ${seksjon}` }, { status: 404 })
	}

	const [questions, technologyElements] = await Promise.all([getScreeningQuestions(), getAllTechnologyElements()])

	const questionsWithChoices = await Promise.all(
		questions.map(async (q) => ({
			...q,
			choices: await getChoicesForQuestion(q.id),
		})),
	)

	return data({
		section,
		screeningQuestions: questionsWithChoices,
		technologyElements,
	})
}

export async function action({ request, params }: ActionFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)

	const { seksjon } = params
	if (!seksjon) {
		throw data({ message: "Mangler seksjonsparameter" }, { status: 400 })
	}

	const section = await getSectionBySlug(seksjon)
	if (!section) {
		throw data({ message: `Fant ikke seksjon: ${seksjon}` }, { status: 404 })
	}

	const formData = await request.formData()
	const name = formData.get("name")
	const description = formData.get("description")
	const frequency = formData.get("frequency")
	const screeningQuestionId = formData.get("screeningQuestionId")
	const screeningChoiceValue = formData.get("screeningChoiceValue")
	const technologyElementIds = formData.getAll("technologyElementIds")

	if (!name || typeof name !== "string" || !name.trim()) {
		throw data({ message: "Navn er påkrevd" }, { status: 400 })
	}

	if (!frequency || !isRoutineFrequency(frequency)) {
		throw data({ message: "Ugyldig frekvens" }, { status: 400 })
	}

	const routine = await createRoutine({
		sectionId: section.id,
		name: name.trim(),
		description: typeof description === "string" && description.trim() ? description.trim() : null,
		frequency,
		screeningQuestionId: typeof screeningQuestionId === "string" && screeningQuestionId ? screeningQuestionId : null,
		screeningChoiceValue:
			typeof screeningChoiceValue === "string" && screeningChoiceValue ? screeningChoiceValue : null,
		technologyElementIds: technologyElementIds.filter((id): id is string => typeof id === "string"),
		createdBy: authedUser.navIdent,
	})

	return redirect(`../rutiner/${routine.id}`)
}

export default function NyRutine() {
	const { section, screeningQuestions, technologyElements } = useLoaderData<typeof loader>()
	const [selectedQuestionId, setSelectedQuestionId] = useState("")

	const selectedQuestion = screeningQuestions.find((q) => q.id === selectedQuestionId)

	return (
		<VStack gap="space-12">
			<Heading size="xlarge" level="2">
				Ny rutine for {section.name}
			</Heading>

			<Form method="post">
				<VStack gap="space-6">
					<TextField label="Navn" name="name" required />

					<Textarea label="Beskrivelse" name="description" />

					<Select label="Frekvens" name="frequency" required>
						<option value="">Velg frekvens</option>
						{ROUTINE_FREQUENCIES.map((freq) => (
							<option key={freq} value={freq}>
								{frequencyLabels[freq]}
							</option>
						))}
					</Select>

					<Select
						label="Innledende spørsmål"
						name="screeningQuestionId"
						value={selectedQuestionId}
						onChange={(e) => setSelectedQuestionId(e.target.value)}
					>
						<option value="">Ingen</option>
						{screeningQuestions.map((q) => (
							<option key={q.id} value={q.id}>
								{q.questionText}
							</option>
						))}
					</Select>

					{selectedQuestion && selectedQuestion.choices.length > 0 && (
						<Select label="Påkrevd svarverdi" name="screeningChoiceValue">
							<option value="">Velg svarverdi</option>
							{selectedQuestion.choices.map((choice) => (
								<option key={choice.id} value={choice.value}>
									{choice.label}
								</option>
							))}
						</Select>
					)}

					{technologyElements.length > 0 && (
						<CheckboxGroup legend="Teknologielementer">
							{technologyElements.map((el) => (
								<Checkbox key={el.id} name="technologyElementIds" value={el.id}>
									{el.name}
								</Checkbox>
							))}
						</CheckboxGroup>
					)}

					<HStack gap="space-4">
						<Button type="submit" variant="primary">
							Opprett
						</Button>
						<Button as={Link} to=".." variant="secondary">
							Avbryt
						</Button>
					</HStack>
				</VStack>
			</Form>
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
