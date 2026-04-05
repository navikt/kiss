import { TrashIcon } from "@navikt/aksel-icons"
import {
	BodyLong,
	Button,
	Checkbox,
	CheckboxGroup,
	Heading,
	HStack,
	Label,
	Modal,
	Select,
	Textarea,
	TextField,
	VStack,
} from "@navikt/ds-react"
import { useRef, useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, Link, redirect, useLoaderData } from "react-router"
import { MarkdownHint } from "~/components/MarkdownHint"
import { MarkdownPreview } from "~/components/MarkdownPreview"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { deleteRoutine, getRoutine, updateRoutine } from "~/db/queries/routines.server"
import { getChoicesForQuestion, getScreeningQuestions } from "~/db/queries/screening.server"
import { getSectionBySlug } from "~/db/queries/sections.server"
import { getAllTechnologyElements } from "~/db/queries/technology-elements.server"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { requireAdmin } from "~/lib/authorization.server"
import { frequencyLabels, isRoutineFrequency, ROUTINE_FREQUENCIES } from "~/lib/routine-frequencies"

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

	const [questions, technologyElements] = await Promise.all([getScreeningQuestions(), getAllTechnologyElements()])

	const questionsWithChoices = await Promise.all(
		questions.map(async (q) => ({
			...q,
			choices: await getChoicesForQuestion(q.id),
		})),
	)

	return data({
		seksjon,
		section,
		routine,
		questionsWithChoices,
		technologyElements,
	})
}

export async function action({ request, params }: ActionFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	requireAdmin(authedUser)

	const { seksjon, rutineId } = params
	if (!seksjon || !rutineId) throw new Response("Mangler parametere", { status: 400 })

	const formData = await request.formData()
	const intent = formData.get("intent") as string

	if (intent === "update") {
		const name = (formData.get("name") as string)?.trim()
		const description = (formData.get("description") as string)?.trim() || null
		const frequency = formData.get("frequency") as string
		const screeningQuestionId = (formData.get("screeningQuestionId") as string) || null
		const screeningChoiceValue = (formData.get("screeningChoiceValue") as string) || null
		const technologyElementIds = formData.getAll("technologyElementIds") as string[]

		if (!name) throw new Response("Navn er påkrevd", { status: 400 })
		if (!isRoutineFrequency(frequency)) throw new Response("Ugyldig frekvens", { status: 400 })

		await updateRoutine({
			id: rutineId,
			name,
			description,
			frequency,
			screeningQuestionId,
			screeningChoiceValue,
			technologyElementIds,
			updatedBy: authedUser.navIdent,
		})

		return redirect(`/seksjoner/${seksjon}/rutiner/${rutineId}`)
	}

	if (intent === "delete") {
		await deleteRoutine(rutineId, authedUser.navIdent)
		return redirect(`/seksjoner/${seksjon}/rutiner`)
	}

	throw new Response("Ugyldig handling", { status: 400 })
}

export default function RedigerRutine() {
	const { seksjon, routine, questionsWithChoices, technologyElements } = useLoaderData<typeof loader>()

	const deleteModalRef = useRef<HTMLDialogElement>(null)

	const [selectedQuestionId, setSelectedQuestionId] = useState<string>(routine.screeningQuestionId ?? "")
	const [descriptionPreview, setDescriptionPreview] = useState(routine.description ?? "")

	const selectedQuestion = questionsWithChoices.find((q) => q.id === selectedQuestionId)

	return (
		<VStack gap="space-8">
			<div>
				<Link to={`/seksjoner/${seksjon}/rutiner/${routine.id}`}>← Tilbake til {routine.name}</Link>
				<Heading size="xlarge" level="2" spacing>
					Rediger rutine: {routine.name}
				</Heading>
			</div>

			<Form method="post">
				<input type="hidden" name="intent" value="update" />
				<VStack gap="space-4">
					<TextField label="Navn" name="name" defaultValue={routine.name} size="small" autoComplete="off" />
					<HStack gap="space-8" align="stretch" style={{ flexWrap: "wrap" }}>
						<VStack style={{ flex: 1, minWidth: "20rem" }}>
							<Textarea
								label="Beskrivelse"
								name="description"
								defaultValue={routine.description ?? ""}
								size="small"
								minRows={6}
								onChange={(e) => setDescriptionPreview(e.target.value)}
							/>
							<MarkdownHint />
						</VStack>
						<VStack style={{ flex: 1, minWidth: "20rem" }}>
							<Label size="small" spacing>
								Forhåndsvisning
							</Label>
							<MarkdownPreview content={descriptionPreview} />
						</VStack>
					</HStack>
					<Select label="Frekvens" name="frequency" defaultValue={routine.frequency} size="small">
						{ROUTINE_FREQUENCIES.map((freq) => (
							<option key={freq} value={freq}>
								{frequencyLabels[freq]}
							</option>
						))}
					</Select>

					<Select
						label="Innledende spørsmål"
						name="screeningQuestionId"
						size="small"
						value={selectedQuestionId}
						onChange={(e) => setSelectedQuestionId(e.target.value)}
					>
						<option value="">Ingen</option>
						{questionsWithChoices.map((q) => (
							<option key={q.id} value={q.id}>
								{q.questionText}
							</option>
						))}
					</Select>

					{selectedQuestion && selectedQuestion.choices.length > 0 && (
						<Select
							label="Svarverdi"
							name="screeningChoiceValue"
							defaultValue={routine.screeningChoiceValue ?? ""}
							size="small"
						>
							<option value="">Velg …</option>
							{selectedQuestion.choices.map((c) => (
								<option key={c.id} value={c.value}>
									{c.label}
								</option>
							))}
						</Select>
					)}

					{technologyElements.length > 0 && (
						<CheckboxGroup
							legend="Teknologielementer"
							size="small"
							defaultValue={routine.technologyElements.map((te) => te.id)}
						>
							{technologyElements.map((te) => (
								<Checkbox key={te.id} name="technologyElementIds" value={te.id}>
									{te.name}
								</Checkbox>
							))}
						</CheckboxGroup>
					)}

					<HStack gap="space-4">
						<Button type="submit" variant="primary" size="small">
							Lagre
						</Button>
						<Button
							type="button"
							variant="danger"
							size="small"
							icon={<TrashIcon aria-hidden />}
							onClick={() => deleteModalRef.current?.showModal()}
						>
							Slett rutine
						</Button>
					</HStack>
				</VStack>
			</Form>

			<Modal ref={deleteModalRef} header={{ heading: `Slett rutine: ${routine.name}` }}>
				<Modal.Body>
					<BodyLong>Er du sikker på at du vil slette rutinen «{routine.name}»?</BodyLong>
				</Modal.Body>
				<Modal.Footer>
					<Form method="post" onSubmit={() => deleteModalRef.current?.close()}>
						<input type="hidden" name="intent" value="delete" />
						<HStack gap="space-4">
							<Button type="submit" variant="danger" size="small">
								Slett
							</Button>
							<Button type="button" variant="secondary" size="small" onClick={() => deleteModalRef.current?.close()}>
								Avbryt
							</Button>
						</HStack>
					</Form>
				</Modal.Footer>
			</Modal>
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
