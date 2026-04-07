import { PlusIcon, TrashIcon } from "@navikt/aksel-icons"
import {
	BodyShort,
	Button,
	Checkbox,
	CheckboxGroup,
	Heading,
	HStack,
	Label,
	Select,
	Textarea,
	TextField,
	VStack,
} from "@navikt/ds-react"
import { useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, Link, redirect, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { createRoutine } from "~/db/queries/routines.server"
import {
	getChoicesForQuestion,
	getScreeningQuestions,
	getSectionScreeningQuestions,
} from "~/db/queries/screening.server"
import { getSectionBySlug } from "~/db/queries/sections.server"
import { getAllTechnologyElements } from "~/db/queries/technology-elements.server"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { requireAdmin } from "~/lib/authorization.server"
import { frequencyLabels, isRoutineFrequency, ROUTINE_FREQUENCIES } from "~/lib/routine-frequencies"

interface QuestionLink {
	key: string
	questionId: string
	choiceValue: string
}

export async function loader({ request, params }: LoaderFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	requireAdmin(authedUser)

	const { seksjon } = params
	if (!seksjon) {
		throw data({ message: "Mangler seksjonsparameter" }, { status: 400 })
	}

	const section = await getSectionBySlug(seksjon)
	if (!section) {
		throw data({ message: `Fant ikke seksjon: ${seksjon}` }, { status: 404 })
	}

	const [globalQuestions, sectionQuestions, technologyElements] = await Promise.all([
		getScreeningQuestions(),
		getSectionScreeningQuestions(section.id),
		getAllTechnologyElements(),
	])

	const allQuestions = [...globalQuestions, ...sectionQuestions]
	const questionsWithChoices = await Promise.all(
		allQuestions.map(async (q) => ({
			...q,
			isSection: q.sectionId !== null,
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
	requireAdmin(authedUser)

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
	const technologyElementIds = formData.getAll("technologyElementIds")

	if (!name || typeof name !== "string" || !name.trim()) {
		throw data({ message: "Navn er påkrevd" }, { status: 400 })
	}

	if (!frequency || !isRoutineFrequency(frequency)) {
		throw data({ message: "Ugyldig frekvens" }, { status: 400 })
	}

	// Parse multiple question links
	const questionIds = formData.getAll("questionId") as string[]
	const choiceValues = formData.getAll("choiceValue") as string[]
	const screeningQuestionLinks = questionIds
		.map((qId, i) => ({ questionId: qId, choiceValue: choiceValues[i] ?? "" }))
		.filter((l) => l.questionId)

	const firstLink = screeningQuestionLinks[0]

	const routine = await createRoutine({
		sectionId: section.id,
		name: name.trim(),
		description: typeof description === "string" && description.trim() ? description.trim() : null,
		frequency,
		screeningQuestionId: firstLink?.questionId ?? null,
		screeningChoiceValue: firstLink?.choiceValue ?? null,
		screeningQuestionLinks,
		technologyElementIds: technologyElementIds.filter((id): id is string => typeof id === "string"),
		createdBy: authedUser.navIdent,
	})

	return redirect(`/seksjoner/${seksjon}/rutiner/${routine.id}`)
}

export default function NyRutine() {
	const { section, screeningQuestions, technologyElements } = useLoaderData<typeof loader>()
	const [questionLinks, setQuestionLinks] = useState<QuestionLink[]>([])

	const addQuestionLink = () => {
		setQuestionLinks((prev) => [...prev, { key: crypto.randomUUID(), questionId: "", choiceValue: "" }])
	}

	const removeQuestionLink = (index: number) => {
		setQuestionLinks((prev) => prev.filter((_, i) => i !== index))
	}

	const updateQuestionLink = (index: number, field: "questionId" | "choiceValue", value: string) => {
		setQuestionLinks((prev) =>
			prev.map((link, i) => {
				if (i !== index) return link
				if (field === "questionId") return { ...link, questionId: value, choiceValue: "" }
				return { ...link, [field]: value }
			}),
		)
	}

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

					<VStack gap="space-2">
						<Label size="small">Innledende spørsmål</Label>
						<BodyShort size="small" textColor="subtle">
							Knytt rutinen til ett eller flere spørsmål. Apper som svarer med valgt svarverdi vil måtte gjennomføre
							rutinen.
						</BodyShort>
						{questionLinks.map((link, index) => {
							const question = screeningQuestions.find((q) => q.id === link.questionId)
							return (
								<HStack key={link.key} gap="space-2" align="end" style={{ flexWrap: "wrap" }}>
									<div style={{ flex: 2, minWidth: "15rem" }}>
										<Select
											label={index === 0 ? "Spørsmål" : undefined}
											hideLabel={index > 0}
											aria-label="Spørsmål"
											size="small"
											value={link.questionId}
											onChange={(e) => updateQuestionLink(index, "questionId", e.target.value)}
										>
											<option value="">Velg spørsmål …</option>
											{screeningQuestions.filter((q) => q.isSection).length > 0 && (
												<optgroup label="Seksjonens spørsmål">
													{screeningQuestions
														.filter((q) => q.isSection)
														.map((q) => (
															<option key={q.id} value={q.id}>
																{q.questionText}
															</option>
														))}
												</optgroup>
											)}
											<optgroup label="Globale spørsmål">
												{screeningQuestions
													.filter((q) => !q.isSection)
													.map((q) => (
														<option key={q.id} value={q.id}>
															{q.questionText}
														</option>
													))}
											</optgroup>
										</Select>
									</div>
									<div style={{ flex: 1, minWidth: "10rem" }}>
										<Select
											label={index === 0 ? "Svarverdi" : undefined}
											hideLabel={index > 0}
											aria-label="Svarverdi"
											size="small"
											value={link.choiceValue}
											onChange={(e) => updateQuestionLink(index, "choiceValue", e.target.value)}
											disabled={!question || question.choices.length === 0}
										>
											<option value="">Velg …</option>
											{question?.choices.map((c) => (
												<option key={c.id} value={c.value}>
													{c.label}
												</option>
											))}
										</Select>
									</div>
									<input type="hidden" name="questionId" value={link.questionId} />
									<input type="hidden" name="choiceValue" value={link.choiceValue} />
									<Button
										type="button"
										variant="tertiary-neutral"
										size="small"
										icon={<TrashIcon aria-hidden />}
										onClick={() => removeQuestionLink(index)}
										aria-label="Fjern spørsmål"
									/>
								</HStack>
							)
						})}
						<div>
							<Button
								type="button"
								variant="secondary"
								size="xsmall"
								icon={<PlusIcon aria-hidden />}
								onClick={addQuestionLink}
							>
								Legg til spørsmål
							</Button>
						</div>
					</VStack>

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
