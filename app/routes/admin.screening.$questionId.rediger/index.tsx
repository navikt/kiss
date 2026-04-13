import { PlusIcon, TrashIcon } from "@navikt/aksel-icons"
import {
	BodyShort,
	Box,
	Button,
	Checkbox,
	CheckboxGroup,
	Heading,
	HStack,
	Modal,
	Select,
	Table,
	Tag,
	TextField,
	VStack,
} from "@navikt/ds-react"
import { useRef, useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, redirect, useLoaderData } from "react-router"
import { MarkdownEditor } from "~/components/MarkdownEditor"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getAllControls } from "~/db/queries/framework.server"
import {
	addChoiceEffect,
	createChoice,
	createScreeningQuestion,
	deleteChoice,
	deleteChoiceEffect,
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
import { screeningEffectLabels } from "~/db/schema/screening"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { requireAdmin } from "~/lib/authorization.server"
import { getStatusLabel } from "~/lib/compliance-status"
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
				answerType: "boolean",
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

			// Handle pending choices with effects for new questions
			const pendingChoicesJson = formData.get("pendingChoices") as string | null
			if (pendingChoicesJson) {
				const pending = JSON.parse(pendingChoicesJson) as PendingChoice[]
				for (const pc of pending) {
					// Skip auto-created boolean choices if they match
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

export default function EditScreeningQuestion() {
	const { isNew, question, choices, controls, technologyElements, rulesets, sectionId, returnPath } =
		useLoaderData<typeof loader>()
	const [pendingChoices, setPendingChoices] = useState<PendingChoice[]>([])
	const [answerType, setAnswerType] = useState(question.answerType ?? "boolean")
	const [deleteTarget, setDeleteTarget] = useState<{
		type: "choice" | "effect"
		id: string
		label: string
		choiceId?: string
	} | null>(null)
	const deleteModalRef = useRef<HTMLDialogElement>(null)

	return (
		<VStack gap="space-8" style={{ maxWidth: "64rem" }}>
			<Heading size="xlarge" level="2">
				{isNew ? "Nytt spørsmål" : "Rediger spørsmål"}
			</Heading>

			{/* Edit form */}
			<Form method="post" style={{ padding: "6px" }}>
				<input type="hidden" name="intent" value="updateQuestion" />
				<input type="hidden" name="returnPath" value={returnPath} />
				{sectionId && <input type="hidden" name="sectionId" value={sectionId} />}
				{isNew && <input type="hidden" name="pendingChoices" value={JSON.stringify(pendingChoices)} />}
				<VStack gap="space-8">
					<TextField label="Spørsmålstekst" name="questionText" size="small" defaultValue={question.questionText} />
					<MarkdownEditor
						label="Beskrivelse"
						name="description"
						defaultValue={question.description ?? ""}
						minRows={5}
					/>
					<Select
						label="Svartype"
						name="answerType"
						size="small"
						value={answerType}
						onChange={(e) => setAnswerType(e.target.value)}
						style={{ maxWidth: "20rem" }}
					>
						<option value="boolean">Ja/Nei</option>
						<option value="single_choice">Egendefinerte valg</option>
						<option value="persistence">Persistens (databaser)</option>
					</Select>
					{answerType === "persistence" && (
						<BodyShort size="small" textColor="subtle">
							Spørsmål av typen «Persistens» lar brukeren oppgi hvilke databaser applikasjonen bruker, med type, navn og
							klassifisering. Ingen valgmuligheter eller effekter trengs.
						</BodyShort>
					)}
					{technologyElements.length > 0 && (
						<CheckboxGroup
							legend="Teknologielementer"
							description="Velg hvilke teknologielementer spørsmålet gjelder for. Ingen valg betyr at spørsmålet gjelder for alle applikasjoner."
							size="small"
							defaultValue={question.technologyElementIds}
						>
							{technologyElements.map((te) => (
								<Checkbox key={te.id} name="technologyElementIds" value={te.id}>
									{te.name}
								</Checkbox>
							))}
						</CheckboxGroup>
					)}
					{rulesets.length > 0 && (
						<Select
							label="Regelsett"
							name="rulesetId"
							size="small"
							defaultValue={question.rulesetId ?? ""}
							style={{ maxWidth: "20rem" }}
						>
							<option value="">— Ikke valgt —</option>
							{rulesets.map((rs) => (
								<option key={rs.id} value={rs.id}>
									{rs.name}
								</option>
							))}
						</Select>
					)}
					<div>
						<Button type="submit" size="small" variant="primary">
							{isNew ? "Opprett spørsmål" : "Lagre endringer"}
						</Button>
					</div>
				</VStack>
			</Form>

			{/* Choices management — hidden for persistence type */}
			{answerType !== "persistence" && (
				<Box padding="space-12" borderWidth="1" borderColor="neutral-subtle" borderRadius="8">
					<VStack gap="space-6">
						<Heading size="small" level="3">
							Valgmuligheter
						</Heading>

						{/* Existing / pending choices */}
						{(isNew ? pendingChoices : choices).map((choice) => (
							<ChoiceCard
								key={"clientId" in choice ? choice.clientId : choice.id}
								choice={choice}
								controls={controls}
								onDeleteChoice={(label) => {
									const id = "clientId" in choice ? choice.clientId : choice.id
									setDeleteTarget({ type: "choice", id, label })
									deleteModalRef.current?.showModal()
								}}
								onDeleteEffect={(effectId, label) => {
									setDeleteTarget({ type: "effect", id: effectId, label })
									deleteModalRef.current?.showModal()
								}}
								onAddPendingEffect={
									isNew
										? (choiceClientId, eff) => {
												setPendingChoices((prev) =>
													prev.map((c) => (c.clientId === choiceClientId ? { ...c, effects: [...c.effects, eff] } : c)),
												)
											}
										: undefined
								}
								onRemovePendingEffect={
									isNew
										? (choiceClientId, effClientId) => {
												setPendingChoices((prev) =>
													prev.map((c) =>
														c.clientId === choiceClientId
															? { ...c, effects: c.effects.filter((e) => e.clientId !== effClientId) }
															: c,
													),
												)
											}
										: undefined
								}
								onRemovePendingChoice={
									isNew
										? (clientId) => setPendingChoices((prev) => prev.filter((c) => c.clientId !== clientId))
										: undefined
								}
							/>
						))}

						{/* Add choice form */}
						{isNew ? (
							<AddPendingChoiceForm
								existingCount={(pendingChoices ?? []).length}
								onAdd={(choice) => setPendingChoices((prev) => [...prev, choice])}
							/>
						) : (
							<Form method="post">
								<input type="hidden" name="intent" value="addChoice" />
								<HStack gap="space-4" align="end" wrap>
									<TextField label="Navn" name="label" size="small" />
									<Checkbox name="requiresComment" size="small">
										Krev kommentar
									</Checkbox>
									<Checkbox name="requiresLink" size="small">
										Krev lenke
									</Checkbox>
									<Button type="submit" size="small" variant="secondary-neutral" icon={<PlusIcon aria-hidden />}>
										Legg til valg
									</Button>
								</HStack>
							</Form>
						)}
					</VStack>
				</Box>
			)}

			{/* Delete confirmation modal */}
			<Modal
				ref={deleteModalRef}
				header={{ heading: deleteTarget?.type === "choice" ? "Slett valg" : "Slett effekt" }}
				onClose={() => setDeleteTarget(null)}
			>
				<Modal.Body>
					<BodyShort>
						Er du sikker på at du vil slette{" "}
						{deleteTarget?.type === "choice" ? `valget «${deleteTarget.label}»` : `effekten for ${deleteTarget?.label}`}
						?{deleteTarget?.type === "choice" && " Alle tilhørende effekter vil også slettes."}
					</BodyShort>
				</Modal.Body>
				<Modal.Footer>
					{deleteTarget?.type === "choice" && !isNew ? (
						<Form method="post" onSubmit={() => deleteModalRef.current?.close()}>
							<input type="hidden" name="intent" value="deleteChoice" />
							<input type="hidden" name="choiceId" value={deleteTarget.id} />
							<HStack gap="space-4">
								<Button type="button" variant="secondary" size="small" onClick={() => deleteModalRef.current?.close()}>
									Avbryt
								</Button>
								<Button type="submit" variant="danger" size="small">
									Slett valg
								</Button>
							</HStack>
						</Form>
					) : deleteTarget?.type === "effect" && !isNew ? (
						<Form method="post" onSubmit={() => deleteModalRef.current?.close()}>
							<input type="hidden" name="intent" value="deleteEffect" />
							<input type="hidden" name="effectId" value={deleteTarget.id} />
							<HStack gap="space-4">
								<Button type="button" variant="secondary" size="small" onClick={() => deleteModalRef.current?.close()}>
									Avbryt
								</Button>
								<Button type="submit" variant="danger" size="small">
									Slett effekt
								</Button>
							</HStack>
						</Form>
					) : (
						<HStack gap="space-4">
							<Button type="button" variant="secondary" size="small" onClick={() => deleteModalRef.current?.close()}>
								Avbryt
							</Button>
							<Button
								type="button"
								variant="danger"
								size="small"
								onClick={() => {
									if (deleteTarget?.type === "choice" && isNew) {
										setPendingChoices((prev) => prev.filter((c) => c.clientId !== deleteTarget.id))
									}
									setDeleteTarget(null)
									deleteModalRef.current?.close()
								}}
							>
								Slett {deleteTarget?.type === "choice" ? "valg" : "effekt"}
							</Button>
						</HStack>
					)}
				</Modal.Footer>
			</Modal>
		</VStack>
	)
}

type ServerChoice = {
	id: string
	label: string
	requiresComment: boolean
	requiresLink: boolean
	effects: Array<{
		id: string
		controlTextId: string
		controlName: string | null
		effect: string | null
		comment: string | null
	}>
}

function ChoiceCard({
	choice,
	controls,
	onDeleteChoice,
	onDeleteEffect,
	onAddPendingEffect,
	onRemovePendingEffect,
	onRemovePendingChoice,
}: {
	choice: ServerChoice | PendingChoice
	controls: Array<{ controlId: string; name: string }>
	onDeleteChoice: (label: string) => void
	onDeleteEffect: (effectId: string, label: string) => void
	onAddPendingEffect?: (choiceClientId: string, eff: PendingEffectItem) => void
	onRemovePendingEffect?: (choiceClientId: string, effClientId: string) => void
	onRemovePendingChoice?: (clientId: string) => void
}) {
	const isPending = "clientId" in choice
	const effects = isPending ? choice.effects : choice.effects
	const choiceLabel = choice.label

	return (
		<Box padding="space-8" borderWidth="1" borderColor="neutral-subtle" borderRadius="8">
			<VStack gap="space-4">
				<HStack justify="space-between" align="center">
					<HStack gap="space-4" align="center">
						<Heading size="xsmall" level="4">
							{choiceLabel}
						</Heading>
						{choice.requiresComment && (
							<Tag variant="neutral" size="xsmall">
								Krev kommentar
							</Tag>
						)}
						{choice.requiresLink && (
							<Tag variant="neutral" size="xsmall">
								Krev lenke
							</Tag>
						)}
					</HStack>
					<Button
						type="button"
						size="xsmall"
						variant="tertiary-neutral"
						icon={<TrashIcon aria-hidden />}
						onClick={() => {
							if (isPending && onRemovePendingChoice) {
								onRemovePendingChoice(choice.clientId)
							} else {
								onDeleteChoice(choiceLabel)
							}
						}}
					>
						Slett
					</Button>
				</HStack>

				{/* Effects table for this choice */}
				{effects.length > 0 && (
					<Table size="small">
						<Table.Header>
							<Table.Row>
								<Table.HeaderCell scope="col">Kontroll</Table.HeaderCell>
								<Table.HeaderCell scope="col">Effekt</Table.HeaderCell>
								<Table.HeaderCell scope="col" />
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{effects.map((e) => {
								const effectId = "clientId" in e ? e.clientId : e.id
								return (
									<Table.Row key={effectId}>
										<Table.DataCell>
											<Tag variant="info" size="xsmall">
												{e.controlTextId}
												{e.controlName ? ` – ${e.controlName}` : ""}
											</Tag>
										</Table.DataCell>
										<Table.DataCell>
											{e.effect ? (
												<Tag variant="neutral" size="xsmall">
													{screeningEffectLabels[e.effect] ?? getStatusLabel(e.effect)}
												</Tag>
											) : (
												<BodyShort size="small" textColor="subtle">
													—
												</BodyShort>
											)}
										</Table.DataCell>
										<Table.DataCell>
											{isPending && onRemovePendingEffect ? (
												<Button
													type="button"
													size="xsmall"
													variant="tertiary-neutral"
													icon={<TrashIcon aria-hidden />}
													onClick={() => onRemovePendingEffect(choice.clientId, effectId)}
												/>
											) : (
												<Button
													type="button"
													size="xsmall"
													variant="tertiary-neutral"
													icon={<TrashIcon aria-hidden />}
													onClick={() =>
														onDeleteEffect(effectId, `${e.controlTextId}${e.controlName ? ` – ${e.controlName}` : ""}`)
													}
												/>
											)}
										</Table.DataCell>
									</Table.Row>
								)
							})}
						</Table.Body>
					</Table>
				)}

				{/* Add effect form for this choice */}
				{isPending && onAddPendingEffect ? (
					<AddPendingEffectForm choiceClientId={choice.clientId} controls={controls} onAdd={onAddPendingEffect} />
				) : !isPending ? (
					<Form method="post">
						<input type="hidden" name="intent" value="addEffect" />
						<input type="hidden" name="choiceId" value={choice.id} />
						<HStack gap="space-4" align="end" wrap>
							<Select label="Kontroll" name="controlTextId" size="small">
								<option value="">Velg kontroll</option>
								{controls.map((c) => (
									<option key={c.controlId} value={c.controlId}>
										{c.controlId} – {c.name}
									</option>
								))}
							</Select>
							<Select label="Effekt" name="effect" size="small">
								<option value="">Ingen</option>
								{Object.entries(screeningEffectLabels).map(([v, l]) => (
									<option key={v} value={v}>
										{l}
									</option>
								))}
							</Select>
							<Button type="submit" size="small" variant="secondary-neutral" icon={<PlusIcon aria-hidden />}>
								Legg til effekt
							</Button>
						</HStack>
					</Form>
				) : null}
			</VStack>
		</Box>
	)
}

function AddPendingChoiceForm({
	existingCount,
	onAdd,
}: {
	existingCount: number
	onAdd: (choice: PendingChoice) => void
}) {
	function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault()
		const fd = new FormData(e.currentTarget)
		const label = (fd.get("label") as string)?.trim()
		if (!label) return
		onAdd({
			clientId: crypto.randomUUID(),
			label,
			requiresComment: fd.get("requiresComment") === "on",
			requiresLink: fd.get("requiresLink") === "on",
			displayOrder: existingCount,
			effects: [],
		})
		e.currentTarget.reset()
	}

	return (
		<form onSubmit={handleSubmit}>
			<HStack gap="space-4" align="end" wrap>
				<TextField label="Navn" name="label" size="small" />
				<Checkbox name="requiresComment" size="small">
					Krev kommentar
				</Checkbox>
				<Checkbox name="requiresLink" size="small">
					Krev lenke
				</Checkbox>
				<Button type="submit" size="small" variant="secondary-neutral" icon={<PlusIcon aria-hidden />}>
					Legg til valg
				</Button>
			</HStack>
		</form>
	)
}

function AddPendingEffectForm({
	choiceClientId,
	controls,
	onAdd,
}: {
	choiceClientId: string
	controls: Array<{ controlId: string; name: string }>
	onAdd: (choiceClientId: string, eff: PendingEffectItem) => void
}) {
	function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault()
		const fd = new FormData(e.currentTarget)
		const controlTextId = fd.get("controlTextId") as string
		if (!controlTextId) return
		const control = controls.find((c) => c.controlId === controlTextId)
		onAdd(choiceClientId, {
			clientId: crypto.randomUUID(),
			controlTextId,
			controlName: control?.name ?? "",
			effect: (fd.get("effect") as string) || null,
			comment: (fd.get("comment") as string) || null,
		})
		e.currentTarget.reset()
	}

	return (
		<form onSubmit={handleSubmit}>
			<HStack gap="space-4" align="end" wrap>
				<Select label="Kontroll" name="controlTextId" size="small">
					<option value="">Velg kontroll</option>
					{controls.map((c) => (
						<option key={c.controlId} value={c.controlId}>
							{c.controlId} – {c.name}
						</option>
					))}
				</Select>
				<Select label="Effekt" name="effect" size="small">
					<option value="">Ingen</option>
					{Object.entries(screeningEffectLabels).map(([v, l]) => (
						<option key={v} value={v}>
							{l}
						</option>
					))}
				</Select>
				<Button type="submit" size="small" variant="secondary-neutral" icon={<PlusIcon aria-hidden />}>
					Legg til effekt
				</Button>
			</HStack>
		</form>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
