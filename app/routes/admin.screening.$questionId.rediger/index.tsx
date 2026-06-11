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
	archiveChoice,
	archiveChoiceEffect,
	changeScreeningQuestionStatus,
	createChoice,
	createScreeningQuestion,
	getChoiceEffects,
	getChoicesForQuestion,
	getQuestionTechnologyElements,
	getRoutinesForAllControlsAndTechElements,
	getScreeningQuestion,
	setQuestionTechnologyElements,
	updateChoice,
	updateScreeningQuestion,
} from "~/db/queries/screening.server"
import { getSectionBySlug } from "~/db/queries/sections.server"
import { getAllTechnologyElements } from "~/db/queries/technology-elements.server"
import { isRulesetCategory, RULESET_CATEGORIES, rulesetCategoryLabels } from "~/db/schema/rulesets"
import {
	screeningEffectLabels,
	screeningQuestionStatusConfig,
	validScreeningQuestionStatuses,
} from "~/db/schema/screening"
import { requireAuthenticatedUser } from "~/lib/auth.server"
import { requireAdmin } from "~/lib/authorization.server"
import { getStatusLabel } from "~/lib/compliance-status"
import { renderMarkdown } from "~/lib/markdown.server"
import { applyPendingChoices, parsePendingChoices, validateAndAddChoiceEffect } from "~/lib/screening-actions.server"
import type { PendingChoice, PendingEffectItem } from "~/lib/screening-types"

export async function loader({ request, params }: LoaderFunctionArgs) {
	const authedUser = await requireAuthenticatedUser(request)
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
		const [controls, technologyElementsList, allRoutinesForControls] = await Promise.all([
			getAllControls(),
			getAllTechnologyElements(),
			getRoutinesForAllControlsAndTechElements([]),
		])

		// Check if an economy_system question already exists in this scope
		const { getScreeningQuestions, getSectionScreeningQuestions } = await import("~/db/queries/screening.server")
		const scopeQuestions = sectionId
			? await getSectionScreeningQuestions(sectionId, { includeArchived: false })
			: await getScreeningQuestions({ includeArchived: false })
		const hasExistingEconomyQuestion = scopeQuestions.some((q) => q.answerType === "economy_system")

		return data({
			isNew: true,
			hasExistingEconomyQuestion,
			question: {
				id: "ny",
				questionText: "",
				description: null,
				descriptionHtml: "",
				displayOrder: 0,
				answerType: "",
				status: "draft" as const,
				rulesetId: null as string | null,
				rulesetCategoryFilter: null as string | null,
				technologyElementIds: [] as string[],
			},
			choices: [],
			controls,
			technologyElements: technologyElementsList,
			rulesets: [] as { id: string; name: string }[],
			allRoutinesForControls,
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

	const techElementIds = questionTechElements.map((e) => e.elementId)

	// Load all routines for all controls (for the add-effect form preset_routine dropdown)
	const allRoutinesForControls = await getRoutinesForAllControlsAndTechElements(techElementIds)

	return data({
		isNew: false,
		hasExistingEconomyQuestion: false,
		question: {
			...question,
			descriptionHtml: renderMarkdown(question.description),
			technologyElementIds: techElementIds,
		},
		choices: choicesWithEffects,
		controls,
		technologyElements: technologyElementsList,
		rulesets: [] as { id: string; name: string }[],
		allRoutinesForControls,
		seksjon: seksjonSlug,
		sectionId,
		sectionName,
		returnPath,
	})
}

export async function action({ request, params }: ActionFunctionArgs) {
	const authedUser = await requireAuthenticatedUser(request)
	requireAdmin(authedUser)

	const questionId = params.questionId as string
	const formData = await request.formData()
	const intent = formData.get("intent") as string
	const sectionId = formData.get("sectionId") as string | null
	const returnPath = (formData.get("returnPath") as string) || "/admin/screening"

	if (intent === "updateQuestion") {
		const questionText = formData.get("questionText") as string
		const description = (formData.get("description") as string)?.trim() || null
		const answerType = (formData.get("answerType") as string) || "boolean"
		const technologyElementIds = formData.getAll("technologyElementIds") as string[]
		const rulesetId = (formData.get("rulesetId") as string) || null
		const rulesetCategoryFilterRaw = (formData.get("rulesetCategoryFilter") as string) || null
		const rulesetCategoryFilter =
			rulesetCategoryFilterRaw === null || isRulesetCategory(rulesetCategoryFilterRaw) ? rulesetCategoryFilterRaw : null
		if (!questionText?.trim()) throw new Response("Ugyldig data", { status: 400 })

		if (questionId === "ny") {
			const q = await createScreeningQuestion(
				questionText.trim(),
				description,
				authedUser.navIdent,
				sectionId,
				answerType,
				rulesetId,
			)

			await setQuestionTechnologyElements(q.id, technologyElementIds.filter(Boolean), authedUser.navIdent)

			const pending = parsePendingChoices(formData.get("pendingChoices") as string | null)
			await applyPendingChoices(q.id, pending)

			return redirect(returnPath)
		}

		await updateScreeningQuestion(
			questionId,
			questionText.trim(),
			description,
			authedUser.navIdent,
			rulesetId,
			rulesetCategoryFilter,
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
		const effectRaw = (formData.get("effect") as string) || null
		const comment = formData.get("comment") as string
		const presetRoutineId = (formData.get("presetRoutineId") as string) || null
		if (!choiceId || !controlTextId) throw new Response("Mangler data", { status: 400 })
		await validateAndAddChoiceEffect({
			choiceId,
			controlTextId,
			effect: effectRaw,
			comment: comment || null,
			presetRoutineId,
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

export default function EditScreeningQuestion() {
	const {
		isNew,
		hasExistingEconomyQuestion,
		question,
		choices,
		controls,
		technologyElements,
		sectionId,
		returnPath,
		allRoutinesForControls,
	} = useLoaderData<typeof loader>()
	const [pendingChoices, setPendingChoices] = useState<PendingChoice[]>([])
	const [answerType, setAnswerType] = useState(question.answerType ?? "")
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
					<Select
						label="Svartype"
						name="answerType"
						size="small"
						value={answerType}
						onChange={(e) => {
							const newType = e.target.value
							const prevType = answerType
							setAnswerType(newType)
							if (newType === "boolean" && isNew) {
								setPendingChoices([
									{
										clientId: crypto.randomUUID(),
										label: "Ja",
										requiresComment: false,
										requiresLink: false,
										displayOrder: 0,
										effects: [],
									},
									{
										clientId: crypto.randomUUID(),
										label: "Nei",
										requiresComment: false,
										requiresLink: false,
										displayOrder: 1,
										effects: [],
									},
								])
							} else if (prevType === "boolean" && newType !== "boolean" && isNew) {
								// Clear default Ja/Nei choices if unmodified
								setPendingChoices((prev) => {
									const isDefault =
										prev.length === 2 &&
										prev[0].label === "Ja" &&
										prev[1].label === "Nei" &&
										prev.every((c) => c.effects.length === 0 && !c.requiresComment && !c.requiresLink)
									return isDefault ? [] : prev
								})
							}
						}}
						style={{ maxWidth: "20rem" }}
					>
						<option value="" disabled>
							– Velg svartype –
						</option>
						<option value="boolean">Ja/Nei</option>
						<option value="single_choice">Egendefinerte valg</option>
						<option value="persistence">Persistens (databaser)</option>
						<option value="entra_id_groups">Entra ID-grupper</option>
						{((isNew && !hasExistingEconomyQuestion) || question.answerType === "economy_system") && (
							<option value="economy_system">Økonomisystem</option>
						)}
						<option value="ruleset">Regelsett</option>
					</Select>
					{answerType === "persistence" && (
						<BodyShort size="small" textColor="subtle">
							Spørsmål av typen «Persistens» lar brukeren oppgi hvilke databaser applikasjonen bruker, med type, navn og
							klassifisering. Ingen valgmuligheter eller effekter trengs.
						</BodyShort>
					)}
					{answerType === "entra_id_groups" && (
						<BodyShort size="small" textColor="subtle">
							Spørsmål av typen «Entra ID-grupper» lar brukeren vedlikeholde tilgangsgrupper for applikasjonen, med
							kritikalitetsvurdering. Ingen valgmuligheter eller effekter trengs.
						</BodyShort>
					)}
					{answerType === "ruleset" && (
						<>
							<BodyShort size="small" textColor="subtle">
								Spørsmål av typen «Regelsett» lar brukeren velge et regelsett fra seksjonen som svar. Ingen
								valgmuligheter eller effekter trengs.
							</BodyShort>
							<Select
								label="Kategoribegrensning (valgfritt)"
								name="rulesetCategoryFilter"
								defaultValue={question.rulesetCategoryFilter ?? ""}
								description="Begrens hvilke regelsett brukeren kan velge fra"
							>
								<option value="">— Alle regelsett —</option>
								{RULESET_CATEGORIES.map((c) => (
									<option key={c} value={c}>
										{rulesetCategoryLabels[c]}
									</option>
								))}
							</Select>
						</>
					)}
					{answerType === "economy_system" && (
						<BodyShort size="small" textColor="subtle">
							Spørsmål av typen «Økonomisystem» lar brukeren klassifisere om applikasjonen er et økonomisystem iht.
							Bestemmelser om økonomistyring i staten. Klassifiseringen revideres årlig. Ingen valgmuligheter eller
							effekter trengs.
						</BodyShort>
					)}
					{!isNew && (
						<HStack gap="space-4" align="center">
							<BodyShort size="small" weight="semibold">
								Status:
							</BodyShort>
							<Tag
								variant={
									screeningQuestionStatusConfig[question.status as keyof typeof screeningQuestionStatusConfig]
										?.variant ?? "neutral"
								}
								size="small"
							>
								{screeningQuestionStatusConfig[question.status as keyof typeof screeningQuestionStatusConfig]?.label ??
									question.status}
							</Tag>
						</HStack>
					)}
					<div>
						<Button type="submit" size="small" variant="primary">
							{isNew ? "Opprett spørsmål" : "Lagre endringer"}
						</Button>
					</div>
				</VStack>
			</Form>

			{/* Status actions */}
			{!isNew && (
				<HStack gap="space-4">
					{question.status === "draft" && (
						<Form method="post">
							<input type="hidden" name="intent" value="changeStatus" />
							<input type="hidden" name="newStatus" value="ready" />
							<Button type="submit" size="small" variant="secondary">
								Merk som ferdig
							</Button>
						</Form>
					)}
					{question.status === "ready" && (
						<Form method="post">
							<input type="hidden" name="intent" value="changeStatus" />
							<input type="hidden" name="newStatus" value="approved" />
							<Button type="submit" size="small" variant="primary">
								Godkjenn
							</Button>
						</Form>
					)}
					{(question.status === "ready" || question.status === "approved") && (
						<Form method="post">
							<input type="hidden" name="intent" value="changeStatus" />
							<input type="hidden" name="newStatus" value="draft" />
							<Button type="submit" size="small" variant="tertiary">
								Tilbakestill til kladd
							</Button>
						</Form>
					)}
				</HStack>
			)}

			{/* Choices management — hidden for persistence/entra/ruleset/economy_system/blank */}
			{answerType !== "" &&
				answerType !== "persistence" &&
				answerType !== "entra_id_groups" &&
				answerType !== "ruleset" &&
				answerType !== "economy_system" && (
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
									allRoutinesForControls={allRoutinesForControls}
									onDeleteChoice={
										answerType === "boolean"
											? undefined
											: (label) => {
													const id = "clientId" in choice ? choice.clientId : choice.id
													setDeleteTarget({ type: "choice", id, label })
													deleteModalRef.current?.showModal()
												}
									}
									onDeleteEffect={(effectId, label) => {
										setDeleteTarget({ type: "effect", id: effectId, label })
										deleteModalRef.current?.showModal()
									}}
									onAddPendingEffect={
										isNew
											? (choiceClientId, eff) => {
													setPendingChoices((prev) =>
														prev.map((c) =>
															c.clientId === choiceClientId ? { ...c, effects: [...c.effects, eff] } : c,
														),
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
										isNew && answerType !== "boolean"
											? (clientId) => setPendingChoices((prev) => prev.filter((c) => c.clientId !== clientId))
											: undefined
									}
								/>
							))}

							{/* Add choice form — hidden for boolean (Ja/Nei are fixed) */}
							{answerType !== "boolean" &&
								(isNew ? (
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
								))}
						</VStack>
					</Box>
				)}

			{/* Archive confirmation modal */}
			<Modal
				ref={deleteModalRef}
				header={{ heading: deleteTarget?.type === "choice" ? "Arkiver valg" : "Arkiver effekt" }}
				onClose={() => setDeleteTarget(null)}
			>
				<Modal.Body>
					<BodyShort>
						{deleteTarget?.type === "choice" && !isNew
							? `Er du sikker på at du vil arkivere valget «${deleteTarget.label}»? Tilhørende effekter arkiveres også. Eksisterende svar bevares for historikk.`
							: deleteTarget?.type === "effect" && !isNew
								? `Er du sikker på at du vil arkivere effekten for ${deleteTarget?.label}? Effekten påvirker ikke lenger compliance-vurderingen.`
								: `Er du sikker på at du vil fjerne ${
										deleteTarget?.type === "choice"
											? `valget «${deleteTarget.label}»`
											: `effekten for ${deleteTarget?.label}`
									}?${deleteTarget?.type === "choice" ? " Alle tilhørende effekter vil også fjernes." : ""}`}
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
									Arkiver valg
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
									Arkiver effekt
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
								Fjern {deleteTarget?.type === "choice" ? "valg" : "effekt"}
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
		presetRoutineId: string | null
		presetRoutineName: string | null
	}>
}

function ChoiceCard({
	choice,
	controls,
	allRoutinesForControls,
	onDeleteChoice,
	onDeleteEffect,
	onAddPendingEffect,
	onRemovePendingEffect,
	onRemovePendingChoice,
}: {
	choice: ServerChoice | PendingChoice
	controls: Array<{ controlId: string; name: string }>
	allRoutinesForControls?: Record<string, Array<{ id: string; name: string }>>
	onDeleteChoice?: (label: string) => void
	onDeleteEffect: (effectId: string, label: string) => void
	onAddPendingEffect?: (choiceClientId: string, eff: PendingEffectItem) => void
	onRemovePendingEffect?: (choiceClientId: string, effClientId: string) => void
	onRemovePendingChoice?: (clientId: string) => void
}) {
	const isPending = "clientId" in choice
	const effects = isPending ? choice.effects : choice.effects
	const choiceLabel = choice.label
	const [addEffectControl, setAddEffectControl] = useState("")
	const [addEffectType, setAddEffectType] = useState("")

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
					{(onDeleteChoice || (isPending && onRemovePendingChoice)) && (
						<Button
							type="button"
							size="xsmall"
							variant="tertiary-neutral"
							icon={<TrashIcon aria-hidden />}
							onClick={() => {
								if (isPending && onRemovePendingChoice) {
									onRemovePendingChoice(choice.clientId)
								} else if (onDeleteChoice) {
									onDeleteChoice(choiceLabel)
								}
							}}
						>
							Slett
						</Button>
					)}
				</HStack>

				{/* Effects table for this choice */}
				{effects.length > 0 && (
					<Table size="small">
						<Table.Header>
							<Table.Row>
								<Table.HeaderCell scope="col">Kontroll</Table.HeaderCell>
								<Table.HeaderCell scope="col">Effekt</Table.HeaderCell>
								<Table.HeaderCell scope="col">Valgt rutine</Table.HeaderCell>
								<Table.HeaderCell scope="col" />
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{effects.map((e) => {
								const effectId = "clientId" in e ? e.clientId : e.id
								const isPresetRoutine = e.effect === "preset_routine"
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
											{isPresetRoutine && "presetRoutineName" in e && e.presetRoutineName ? (
												<BodyShort size="small">{e.presetRoutineName}</BodyShort>
											) : isPresetRoutine && isPending && "presetRoutineId" in e && e.presetRoutineId ? (
												<BodyShort size="small">{e.presetRoutineId}</BodyShort>
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
					<AddPendingEffectForm
						choiceClientId={choice.clientId}
						controls={controls}
						allRoutinesForControls={allRoutinesForControls ?? {}}
						onAdd={onAddPendingEffect}
					/>
				) : !isPending ? (
					<Form method="post">
						<input type="hidden" name="intent" value="addEffect" />
						<input type="hidden" name="choiceId" value={choice.id} />
						<HStack gap="space-4" align="end" wrap>
							<Select
								label="Kontroll"
								name="controlTextId"
								size="small"
								value={addEffectControl}
								onChange={(e) => setAddEffectControl(e.target.value)}
							>
								<option value="">Velg kontroll</option>
								{controls.map((c) => (
									<option key={c.controlId} value={c.controlId}>
										{c.controlId} – {c.name}
									</option>
								))}
							</Select>
							<Select
								label="Effekt"
								name="effect"
								size="small"
								value={addEffectType}
								onChange={(e) => setAddEffectType(e.target.value)}
							>
								<option value="">Ingen</option>
								{Object.entries(screeningEffectLabels).map(([v, l]) => (
									<option key={v} value={v}>
										{l}
									</option>
								))}
							</Select>
							{addEffectType === "preset_routine" && (
								<Select label="Valgt rutine" name="presetRoutineId" size="small" required>
									<option value="">— Velg rutine —</option>
									{(allRoutinesForControls?.[addEffectControl] ?? []).map((r) => (
										<option key={r.id} value={r.id}>
											{r.name}
										</option>
									))}
								</Select>
							)}
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
	allRoutinesForControls,
	onAdd,
}: {
	choiceClientId: string
	controls: Array<{ controlId: string; name: string }>
	allRoutinesForControls: Record<string, Array<{ id: string; name: string }>>
	onAdd: (choiceClientId: string, eff: PendingEffectItem) => void
}) {
	const [selectedControl, setSelectedControl] = useState("")
	const [selectedEffect, setSelectedEffect] = useState("")

	function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault()
		const fd = new FormData(e.currentTarget)
		const controlTextId = fd.get("controlTextId") as string
		if (!controlTextId) return
		if (selectedEffect === "preset_routine" && !(fd.get("presetRoutineId") as string)) return
		const control = controls.find((c) => c.controlId === controlTextId)
		onAdd(choiceClientId, {
			clientId: crypto.randomUUID(),
			controlTextId,
			controlName: control?.name ?? "",
			effect: selectedEffect || null,
			comment: (fd.get("comment") as string) || null,
			presetRoutineId: (fd.get("presetRoutineId") as string) || null,
		})
		e.currentTarget.reset()
		setSelectedControl("")
		setSelectedEffect("")
	}

	return (
		<form onSubmit={handleSubmit}>
			<HStack gap="space-4" align="end" wrap>
				<Select
					label="Kontroll"
					name="controlTextId"
					size="small"
					value={selectedControl}
					onChange={(e) => setSelectedControl(e.target.value)}
				>
					<option value="">Velg kontroll</option>
					{controls.map((c) => (
						<option key={c.controlId} value={c.controlId}>
							{c.controlId} – {c.name}
						</option>
					))}
				</Select>
				<Select
					label="Effekt"
					name="effect"
					size="small"
					value={selectedEffect}
					onChange={(e) => setSelectedEffect(e.target.value)}
				>
					<option value="">Ingen</option>
					{Object.entries(screeningEffectLabels).map(([v, l]) => (
						<option key={v} value={v}>
							{l}
						</option>
					))}
				</Select>
				{selectedEffect === "preset_routine" && (
					<Select label="Valgt rutine" name="presetRoutineId" size="small" required>
						<option value="">— Velg rutine —</option>
						{(allRoutinesForControls[selectedControl] ?? []).map((r) => (
							<option key={r.id} value={r.id}>
								{r.name}
							</option>
						))}
					</Select>
				)}
				<Button type="submit" size="small" variant="secondary-neutral" icon={<PlusIcon aria-hidden />}>
					Legg til effekt
				</Button>
			</HStack>
		</form>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
