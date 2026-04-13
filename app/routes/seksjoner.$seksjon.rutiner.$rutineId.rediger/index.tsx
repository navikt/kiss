import { PlusIcon, TrashIcon } from "@navikt/aksel-icons"
import {
	BodyLong,
	BodyShort,
	Button,
	Checkbox,
	CheckboxGroup,
	Heading,
	HStack,
	Label,
	Modal,
	Select,
	TextField,
	VStack,
} from "@navikt/ds-react"
import { useRef, useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, redirect, useLoaderData } from "react-router"
import { MarkdownEditor } from "~/components/MarkdownEditor"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getAllControlsForSelection } from "~/db/queries/framework.server"
import { deleteRoutine, getRoutine, updateRoutine } from "~/db/queries/routines.server"
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

	return data({
		seksjon,
		section,
		routine,
		questionsWithChoices,
		technologyElements,
		controls,
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
		const responsibleRole = (formData.get("responsibleRole") as string)?.trim() || null
		const technologyElementIds = formData.getAll("technologyElementIds") as string[]
		const controlIds = formData.getAll("controlIds") as string[]

		if (!name) throw new Response("Navn er påkrevd", { status: 400 })
		if (!isRoutineFrequency(frequency)) throw new Response("Ugyldig frekvens", { status: 400 })

		// Parse multiple question links from form
		const questionIds = formData.getAll("questionId") as string[]
		const choiceValues = formData.getAll("choiceValue") as string[]
		const screeningQuestionLinks = questionIds
			.map((qId, i) => ({ questionId: qId, choiceValue: choiceValues[i] ?? "" }))
			.filter((l) => l.questionId)

		// Keep first link as legacy single field for backward compat
		const firstLink = screeningQuestionLinks[0]

		await updateRoutine({
			id: rutineId,
			name,
			description,
			frequency,
			responsibleRole,
			screeningQuestionId: firstLink?.questionId ?? null,
			screeningChoiceValue: firstLink?.choiceValue ?? null,
			screeningQuestionLinks,
			technologyElementIds,
			controlIds,
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
	const { seksjon, routine, questionsWithChoices, technologyElements, controls } = useLoaderData<typeof loader>()

	const deleteModalRef = useRef<HTMLDialogElement>(null)

	// Initialize question links from join table or legacy field
	const initialLinks: QuestionLink[] =
		routine.screeningQuestions.length > 0
			? routine.screeningQuestions.map((sq) => ({
					key: sq.id,
					questionId: sq.questionId,
					choiceValue: sq.choiceValue ?? "",
				}))
			: routine.screeningQuestionId
				? [
						{
							key: "legacy",
							questionId: routine.screeningQuestionId,
							choiceValue: routine.screeningChoiceValue ?? "",
						},
					]
				: []

	const [questionLinks, setQuestionLinks] = useState<QuestionLink[]>(initialLinks)

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
		<VStack gap="space-8">
			<Heading size="xlarge" level="2" spacing>
				Rediger rutine: {routine.name}
			</Heading>

			<Form method="post">
				<input type="hidden" name="intent" value="update" />
				<VStack gap="space-4">
					<TextField label="Navn" name="name" defaultValue={routine.name} size="small" autoComplete="off" />
					<MarkdownEditor label="Beskrivelse" name="description" defaultValue={routine.description ?? ""} />
					<Select label="Frekvens" name="frequency" defaultValue={routine.frequency} size="small">
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
							const question = questionsWithChoices.find((q) => q.id === link.questionId)
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
											{questionsWithChoices.filter((q) => q.isSection).length > 0 && (
												<optgroup label="Seksjonens spørsmål">
													{questionsWithChoices
														.filter((q) => q.isSection)
														.map((q) => (
															<option key={q.id} value={q.id}>
																{q.questionText}
															</option>
														))}
												</optgroup>
											)}
											<optgroup label="Globale spørsmål">
												{questionsWithChoices
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
												<option key={c.id} value={c.label}>
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

					<Select
						label="Ansvarlig rolle"
						name="responsibleRole"
						size="small"
						defaultValue={routine.responsibleRole ?? ""}
					>
						<option value="">Velg rolle (valgfritt)</option>
						<option value="Seksjonsleder">Seksjonsleder</option>
						<option value="Teknologileder">Teknologileder</option>
						<option value="Teamleder">Teamleder</option>
						<option value="Utvikler">Utvikler</option>
						<option value="Arkitekt">Arkitekt</option>
						<option value="Sikkerhetsansvarlig">Sikkerhetsansvarlig</option>
						<option value="Testleder">Testleder</option>
					</Select>

					{controls.length > 0 && (
						<CheckboxGroup legend="Tilknyttede krav" size="small" defaultValue={routine.controls.map((c) => c.id)}>
							{controls.map((ctrl) => (
								<Checkbox key={ctrl.id} name="controlIds" value={ctrl.id}>
									{ctrl.controlId} – {ctrl.name}
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
