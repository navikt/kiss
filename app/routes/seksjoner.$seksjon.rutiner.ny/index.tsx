import { PlusIcon, TrashIcon } from "@navikt/aksel-icons"
import {
	BodyShort,
	Button,
	Checkbox,
	CheckboxGroup,
	ErrorSummary,
	Heading,
	HStack,
	Label,
	Select,
	Textarea,
	TextField,
	VStack,
} from "@navikt/ds-react"
import { useEffect, useRef, useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, Link, redirect, useActionData, useLoaderData } from "react-router"
import { EventFrequencyCombobox } from "~/components/EventFrequencyCombobox"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { SortableActivityList } from "~/components/SortableActivityList"
import { getAllControlsForSelection } from "~/db/queries/framework.server"
import { createRoutine } from "~/db/queries/routines.server"
import {
	getChoicesForQuestion,
	getScreeningQuestions,
	getSectionScreeningQuestions,
} from "~/db/queries/screening.server"
import { getSectionBySlug } from "~/db/queries/sections.server"
import { getAllTechnologyElements } from "~/db/queries/technology-elements.server"
import {
	type DataClassification,
	dataClassificationLabels,
	type GroupAccessClassification,
	type GroupCriticality,
	groupAccessClassificationLabels,
	groupCriticalityEnum,
	groupCriticalityLabels,
	type PersistenceType,
	persistenceTypeEnum,
	persistenceTypeLabels,
} from "~/db/schema/applications"
import { ROUTINE_ACTIVITY_TYPES, type RoutineActivityType } from "~/db/schema/routines"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { requireAnySectionRole } from "~/lib/authorization.server"
import {
	frequencyLabels,
	getStrictestFrequency,
	isFrequencyAtLeastAsOften,
	isRoutineFrequency,
	ROUTINE_FREQUENCIES,
	type RoutineFrequency,
} from "~/lib/routine-frequencies"
import type { RoutineFieldErrors } from "~/lib/routine-validation"

const PREDEFINED_ROLES = [
	"Seksjonsleder",
	"Teknologileder",
	"Teamleder",
	"Utvikler",
	"Arkitekt",
	"Sikkerhetsansvarlig",
	"Testleder",
] as const

interface QuestionLink {
	key: string
	questionId: string
	choiceValue: string
}

interface PersistenceLinkItem {
	key: string
	persistenceType: string
	dataClassification: string
}

type FieldErrors = RoutineFieldErrors

export async function loader({ request, params }: LoaderFunctionArgs) {
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

	requireAnySectionRole(authedUser, section.id)

	const [globalQuestions, sectionQuestions, technologyElements, controls] = await Promise.all([
		getScreeningQuestions({ status: "approved" }),
		getSectionScreeningQuestions(section.id, { status: "approved" }),
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
		section,
		screeningQuestions: questionsWithChoices,
		technologyElements,
		controls,
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

	requireAnySectionRole(authedUser, section.id)

	const formData = await request.formData()
	const name = formData.get("name")
	const description = formData.get("description")
	const frequency = formData.get("frequency")
	const eventFrequencyValue = formData.get("eventFrequency")
	const eventFrequencyRaw = typeof eventFrequencyValue === "string" ? eventFrequencyValue.trim() || null : null
	const responsibleRole = (formData.get("responsibleRole") as string)?.trim() || null
	const isSectionRoutine = formData.get("isSectionRoutine") === "on"
	// Section routines must apply to all apps in section
	const appliesToAllInSection = isSectionRoutine || formData.get("appliesToAllInSection") === "on"
	const sectionRoutineOwnerRole = isSectionRoutine
		? (formData.get("sectionRoutineOwnerRole") as string)?.trim() || null
		: null
	if (isSectionRoutine && !sectionRoutineOwnerRole) {
		return data(
			{
				fieldErrors: { sectionRoutineOwnerRole: "Eier/utførende rolle er påkrevd for seksjonsrutiner" } as FieldErrors,
			},
			{ status: 400 },
		)
	}
	const activityTypesField = formData.get("activityTypes") as string | null
	let activityTypes: RoutineActivityType[] | undefined
	if (activityTypesField !== null) {
		const raw = activityTypesField.trim() || "[]"
		let parsed: unknown
		try {
			parsed = JSON.parse(raw)
		} catch {
			return data(
				{ fieldErrors: { activityTypes: "Ugyldig format for vedlikeholdsaktiviteter" } as FieldErrors },
				{ status: 400 },
			)
		}
		if (!Array.isArray(parsed)) {
			return data(
				{ fieldErrors: { activityTypes: "Ugyldig format for vedlikeholdsaktiviteter" } as FieldErrors },
				{ status: 400 },
			)
		}
		if (!isSectionRoutine) {
			activityTypes = [
				...new Set(
					(parsed as string[]).filter((t): t is RoutineActivityType =>
						ROUTINE_ACTIVITY_TYPES.includes(t as RoutineActivityType),
					),
				),
			]
		} else {
			activityTypes = []
		}
	}
	const technologyElementIds = formData.getAll("technologyElementIds")
	const controlIds = formData.getAll("controlIds") as string[]
	const groupClassifications = formData.getAll("groupClassifications") as string[]
	const oracleRoleCriticalities = formData.getAll("oracleRoleCriticalities") as string[]

	// Parse persistence links from form
	const plTypes = formData.getAll("plPersistenceType") as string[]
	const plClassifications = formData.getAll("plDataClassification") as string[]
	const persistenceLinks = plTypes
		.map((t, i) => ({
			persistenceType: (t.trim() || null) as PersistenceType | null,
			dataClassification: (plClassifications[i]?.trim() || null) as DataClassification | null,
		}))
		.filter((l) => l.persistenceType || l.dataClassification)

	if (!name || typeof name !== "string" || !name.trim()) {
		return data({ fieldErrors: { name: "Navn er påkrevd" } as FieldErrors }, { status: 400 })
	}

	// Parse frequency: either periodic, event-based, or both. At least one is required.
	const parsedFrequency = frequency && isRoutineFrequency(frequency) ? frequency : null
	if (frequency && !parsedFrequency) {
		return data({ fieldErrors: { frequency: "Ugyldig kronologisk frekvens" } as FieldErrors }, { status: 400 })
	}
	if (!parsedFrequency && !eventFrequencyRaw) {
		return data(
			{
				fieldErrors: {
					frequency: "Enten kronologisk frekvens eller hendelsesbasert frekvens er påkrevd",
				} as FieldErrors,
			},
			{ status: 400 },
		)
	}

	// Validate frequency is at least as often as the strictest control requirement
	if (controlIds.length > 0) {
		const allControls = await getAllControlsForSelection()
		const selectedControls = allControls.filter((c) => controlIds.includes(c.id))
		const minFreq = getStrictestFrequency(selectedControls.map((c) => c.frequency))
		if (minFreq && !parsedFrequency) {
			return data(
				{
					fieldErrors: {
						frequency: `Kontrollene krever periodisk frekvens (minimum ${frequencyLabels[minFreq]})`,
					} as FieldErrors,
				},
				{ status: 400 },
			)
		}
		if (minFreq && parsedFrequency && !isFrequencyAtLeastAsOften(parsedFrequency, minFreq)) {
			return data(
				{
					fieldErrors: {
						frequency: `Frekvensen kan ikke være sjeldnere enn kravet (${frequencyLabels[minFreq]})`,
					} as FieldErrors,
				},
				{ status: 400 },
			)
		}
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
		frequency: parsedFrequency,
		eventFrequency: eventFrequencyRaw,
		responsibleRole,
		appliesToAllInSection,
		isSectionRoutine,
		sectionRoutineOwnerRole,
		activityTypes,
		persistenceLinks,
		screeningQuestionId: firstLink?.questionId ?? null,
		screeningChoiceValue: firstLink?.choiceValue ?? null,
		screeningQuestionLinks,
		technologyElementIds: technologyElementIds.filter((id): id is string => typeof id === "string"),
		controlIds: controlIds.filter(Boolean),
		groupClassifications: groupClassifications.filter(Boolean) as GroupAccessClassification[],
		oracleRoleCriticalities: oracleRoleCriticalities.filter((v): v is GroupCriticality =>
			groupCriticalityEnum.includes(v as GroupCriticality),
		),
		createdBy: authedUser.navIdent,
	})

	return redirect(`/seksjoner/${seksjon}/rutiner/${routine.id}`)
}

export default function NyRutine() {
	const { section, screeningQuestions, technologyElements, controls } = useLoaderData<typeof loader>()
	const actionData = useActionData<typeof action>()
	const fieldErrors = actionData && "fieldErrors" in actionData ? (actionData.fieldErrors as FieldErrors) : undefined
	const errorSummaryRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		if (fieldErrors) {
			errorSummaryRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })
			errorSummaryRef.current?.focus()
		}
	}, [fieldErrors])

	const [questionLinks, setQuestionLinks] = useState<QuestionLink[]>([])
	const [selectedControlIds, setSelectedControlIds] = useState<string[]>([])
	const [responsibleRole, setResponsibleRole] = useState("")
	const [roleManuallySet, setRoleManuallySet] = useState(false)
	const [isSectionRoutine, setIsSectionRoutine] = useState(false)
	const [appliesToAll, setAppliesToAll] = useState(false)
	const [persistenceLinks, setPersistenceLinks] = useState<PersistenceLinkItem[]>([])
	const [selectedFrequency, setSelectedFrequency] = useState<RoutineFrequency | "">("")
	const [eventFrequency, setEventFrequency] = useState("")

	const selectedControls = controls.filter((c) => selectedControlIds.includes(c.id))
	const minimumFrequency = getStrictestFrequency(selectedControls.map((c) => c.frequency))

	const addPersistenceLink = () => {
		setPersistenceLinks((prev) => [...prev, { key: crypto.randomUUID(), persistenceType: "", dataClassification: "" }])
	}

	const removePersistenceLink = (index: number) => {
		setPersistenceLinks((prev) => prev.filter((_, i) => i !== index))
	}

	const updatePersistenceLink = (index: number, field: "persistenceType" | "dataClassification", value: string) => {
		setPersistenceLinks((prev) => prev.map((link, i) => (i !== index ? link : { ...link, [field]: value })))
	}

	const handleControlChange = (newIds: string[]) => {
		setSelectedControlIds(newIds)
		if (!roleManuallySet) {
			const firstControl = controls.find((c) => newIds.includes(c.id))
			setResponsibleRole(firstControl?.responsible ?? "")
		}
		// Auto-adjust frequency if current selection is too infrequent
		const newSelectedControls = controls.filter((c) => newIds.includes(c.id))
		const newMinFreq = getStrictestFrequency(newSelectedControls.map((c) => c.frequency))
		if (
			newMinFreq &&
			isRoutineFrequency(selectedFrequency) &&
			!isFrequencyAtLeastAsOften(selectedFrequency, newMinFreq)
		) {
			setSelectedFrequency(newMinFreq)
		}
	}

	const handleRoleChange = (value: string) => {
		setResponsibleRole(value)
		setRoleManuallySet(true)
	}

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
					{fieldErrors && (
						<ErrorSummary ref={errorSummaryRef} heading="Du må rette disse feilene før du kan lagre">
							{fieldErrors.name && <ErrorSummary.Item href="#name">{fieldErrors.name}</ErrorSummary.Item>}
							{fieldErrors.frequency && (
								<ErrorSummary.Item href="#frequency">{fieldErrors.frequency}</ErrorSummary.Item>
							)}
							{fieldErrors.sectionRoutineOwnerRole && (
								<ErrorSummary.Item href="#sectionRoutineOwnerRole">
									{fieldErrors.sectionRoutineOwnerRole}
								</ErrorSummary.Item>
							)}
							{fieldErrors.activityTypes && (
								<ErrorSummary.Item href="#activityTypes">{fieldErrors.activityTypes}</ErrorSummary.Item>
							)}
						</ErrorSummary>
					)}

					<TextField label="Navn" name="name" id="name" error={fieldErrors?.name} />

					<Textarea label="Beskrivelse" name="description" />

					<Heading size="small" level="3">
						Frekvens
					</Heading>
					<HStack gap="space-6" wrap>
						<Select
							label="Kronologisk frekvens"
							name="frequency"
							id="frequency"
							value={selectedFrequency}
							onChange={(e) => setSelectedFrequency(e.target.value as RoutineFrequency | "")}
							description={minimumFrequency ? `Krav krever minimum: ${frequencyLabels[minimumFrequency]}` : undefined}
							error={fieldErrors?.frequency}
						>
							<option value="">Ingen</option>
							{ROUTINE_FREQUENCIES.map((freq) => (
								<option
									key={freq}
									value={freq}
									disabled={minimumFrequency ? !isFrequencyAtLeastAsOften(freq, minimumFrequency) : false}
								>
									{frequencyLabels[freq]}
									{minimumFrequency === freq ? " (fra krav)" : ""}
								</option>
							))}
						</Select>
						<EventFrequencyCombobox value={eventFrequency} onChange={setEventFrequency} />
					</HStack>

					{isSectionRoutine && <input type="hidden" name="appliesToAllInSection" value="on" />}
					<Checkbox
						name={isSectionRoutine ? undefined : "appliesToAllInSection"}
						size="small"
						checked={isSectionRoutine ? true : appliesToAll}
						onChange={(e) => !isSectionRoutine && setAppliesToAll(e.target.checked)}
						disabled={isSectionRoutine}
					>
						Gjelder alle applikasjoner i seksjonen
					</Checkbox>

					<Checkbox
						name="isSectionRoutine"
						size="small"
						checked={isSectionRoutine}
						onChange={(e) => setIsSectionRoutine(e.target.checked)}
					>
						Seksjonsrutine (gjennomgås på seksjonsnivå, ikke per applikasjon)
					</Checkbox>

					{isSectionRoutine && (
						<Select
							label="Eier / utførende rolle"
							name="sectionRoutineOwnerRole"
							id="sectionRoutineOwnerRole"
							size="small"
							error={fieldErrors?.sectionRoutineOwnerRole}
						>
							<option value="">Velg rolle</option>
							{PREDEFINED_ROLES.map((role) => (
								<option key={role} value={role}>
									{role}
								</option>
							))}
						</Select>
					)}

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
						<CheckboxGroup legend="Teknologielementer">
							{technologyElements.map((el) => (
								<Checkbox key={el.id} name="technologyElementIds" value={el.id}>
									{el.name}
								</Checkbox>
							))}
						</CheckboxGroup>
					)}

					<Select
						label="Ansvarlig rolle"
						name="responsibleRole"
						value={responsibleRole}
						onChange={(e) => handleRoleChange(e.target.value)}
					>
						<option value="">Arves fra krav</option>
						{PREDEFINED_ROLES.map((role) => (
							<option key={role} value={role}>
								{role}
							</option>
						))}
						{responsibleRole && !PREDEFINED_ROLES.includes(responsibleRole as (typeof PREDEFINED_ROLES)[number]) && (
							<option value={responsibleRole}>{responsibleRole} (fra krav)</option>
						)}
					</Select>

					<VStack gap="space-2">
						<Label size="small">Database og klassifisering</Label>
						<BodyShort size="small" textColor="subtle">
							Knytt rutinen til én eller flere databasetyper og/eller dataklassifiseringer.
						</BodyShort>
						{persistenceLinks.map((link, index) => (
							<HStack key={link.key} gap="space-2" align="end" wrap>
								<div style={{ flex: 1, minWidth: "12rem" }}>
									<Select
										label={index === 0 ? "Databasetype" : undefined}
										hideLabel={index > 0}
										aria-label="Databasetype"
										size="small"
										value={link.persistenceType}
										onChange={(e) => updatePersistenceLink(index, "persistenceType", e.target.value)}
									>
										<option value="">Ikke angitt</option>
										{persistenceTypeEnum.map((t) => (
											<option key={t} value={t}>
												{persistenceTypeLabels[t]}
											</option>
										))}
									</Select>
								</div>
								<div style={{ flex: 1, minWidth: "12rem" }}>
									<Select
										label={index === 0 ? "Dataklassifisering" : undefined}
										hideLabel={index > 0}
										aria-label="Dataklassifisering"
										size="small"
										value={link.dataClassification}
										onChange={(e) => updatePersistenceLink(index, "dataClassification", e.target.value)}
									>
										<option value="">Ikke angitt</option>
										{(Object.entries(dataClassificationLabels) as [DataClassification, string][]).map(
											([value, label]) => (
												<option key={value} value={value}>
													{label}
												</option>
											),
										)}
									</Select>
								</div>
								<input type="hidden" name="plPersistenceType" value={link.persistenceType} />
								<input type="hidden" name="plDataClassification" value={link.dataClassification} />
								<Button
									type="button"
									variant="tertiary-neutral"
									size="small"
									icon={<TrashIcon aria-hidden />}
									onClick={() => removePersistenceLink(index)}
									aria-label="Fjern kobling"
								/>
							</HStack>
						))}
						<div>
							<Button
								type="button"
								variant="secondary"
								size="xsmall"
								icon={<PlusIcon aria-hidden />}
								onClick={addPersistenceLink}
							>
								Legg til kobling
							</Button>
						</div>
					</VStack>

					<CheckboxGroup
						legend="Tilgangsklassifisering for Entra ID-grupper"
						description="Rutinen gjelder for applikasjoner som har Entra ID-grupper med valgte tilgangsmetoder."
					>
						{Object.entries(groupAccessClassificationLabels).map(([key, label]) => (
							<Checkbox key={key} name="groupClassifications" value={key}>
								{label}
							</Checkbox>
						))}
					</CheckboxGroup>

					<CheckboxGroup
						legend="Kritikalitet for Oracle-roller"
						description="Rutinen gjelder for applikasjoner som har Oracle-roller med valgte kritikalitetsnivåer."
					>
						{Object.entries(groupCriticalityLabels).map(([key, label]) => (
							<Checkbox key={key} name="oracleRoleCriticalities" value={key}>
								{label}
							</Checkbox>
						))}
					</CheckboxGroup>

					{controls.length > 0 && (
						<CheckboxGroup legend="Tilknyttede krav" value={selectedControlIds} onChange={handleControlChange}>
							{controls.map((ctrl) => (
								<Checkbox key={ctrl.id} name="controlIds" value={ctrl.id}>
									{ctrl.controlId} – {ctrl.name}
									{ctrl.responsible && ` (${ctrl.responsible})`}
								</Checkbox>
							))}
						</CheckboxGroup>
					)}

					<SortableActivityList disabled={isSectionRoutine} />

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
