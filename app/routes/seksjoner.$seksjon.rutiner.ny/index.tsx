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
	TextField,
	VStack,
} from "@navikt/ds-react"
import { useEffect, useRef, useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, Link, redirect, useActionData, useLoaderData } from "react-router"
import { EventFrequencyCombobox } from "~/components/EventFrequencyCombobox"
import { MarkdownEditor } from "~/components/MarkdownEditor"
import { PrioritySelect } from "~/components/PrioritySelect"
import { PriorityTag } from "~/components/PriorityTag"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { SortableActivityList } from "~/components/SortableActivityList"
import { getAllControlsForSelection } from "~/db/queries/framework.server"
import { createRoutine } from "~/db/queries/routines.server"
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
import { requireAuthenticatedUser } from "~/lib/auth.server"
import { canManageSection, isAdmin, requireAnySectionRole } from "~/lib/authorization.server"
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

interface PersistenceLinkItem {
	key: string
	persistenceType: string
	dataClassification: string
}

type FieldErrors = RoutineFieldErrors

export async function loader({ request, params }: LoaderFunctionArgs) {
	const authedUser = await requireAuthenticatedUser(request)

	const { seksjon } = params
	if (!seksjon) {
		throw data({ message: "Mangler seksjonsparameter" }, { status: 400 })
	}

	const section = await getSectionBySlug(seksjon)
	if (!section) {
		throw data({ message: `Fant ikke seksjon: ${seksjon}` }, { status: 404 })
	}

	requireAnySectionRole(authedUser, section.id)

	const [technologyElements, controls] = await Promise.all([getAllTechnologyElements(), getAllControlsForSelection()])

	return data({
		section,
		technologyElements,
		controls,
		userCanChangePriority: isAdmin(authedUser) || canManageSection(authedUser, section.id),
	})
}

export async function action({ request, params }: ActionFunctionArgs) {
	const authedUser = await requireAuthenticatedUser(request)

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
	const priorityStr = formData.get("priority") as string | null
	if (priorityStr !== null && !["1", "2", "3"].includes(priorityStr)) {
		return data({ fieldErrors: { priority: "Ugyldig prioritet" } as FieldErrors }, { status: 400 })
	}
	const canChangePriority = isAdmin(authedUser) || canManageSection(authedUser, section.id)
	const priority = (canChangePriority && priorityStr !== null ? Number(priorityStr) : 3) as 1 | 2 | 3
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
	const activityItemsField = formData.get("activityItems") as string | null
	type RawActivityItem = {
		id?: string
		type: string
		stepTitle?: string
		stepDescription?: string
		stepComponents?: Array<{ type: string; required: boolean }>
	}
	type ParsedActivityItem = {
		type: RoutineActivityType
		stepTitle: string | null
		stepDescription: string | null
		stepComponents: Array<{ type: string; required: boolean }> | null
	}
	let activityItems: ParsedActivityItem[] | undefined
	if (activityItemsField !== null) {
		let parsed: unknown
		try {
			parsed = JSON.parse(activityItemsField.trim() || "[]")
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
			activityItems = (parsed as RawActivityItem[])
				.filter((i) => ROUTINE_ACTIVITY_TYPES.includes(i.type as RoutineActivityType))
				.map((i) => ({
					type: i.type as RoutineActivityType,
					stepTitle: i.type === "manual_activity" ? i.stepTitle?.trim() || null : null,
					stepDescription: i.type === "manual_activity" ? i.stepDescription?.trim() || null : null,
					stepComponents:
						i.type === "manual_activity" && Array.isArray(i.stepComponents)
							? i.stepComponents.filter(
									(c): c is { type: string; required: boolean } =>
										typeof c === "object" &&
										c !== null &&
										typeof c.type === "string" &&
										typeof c.required === "boolean",
								)
							: null,
				}))
		} else {
			activityItems = []
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
		activityItems,
		persistenceLinks,
		screeningQuestionId: null,
		screeningChoiceValue: null,
		technologyElementIds: technologyElementIds.filter((id): id is string => typeof id === "string"),
		controlIds: controlIds.filter(Boolean),
		groupClassifications: groupClassifications.filter(Boolean) as GroupAccessClassification[],
		oracleRoleCriticalities: oracleRoleCriticalities.filter((v): v is GroupCriticality =>
			groupCriticalityEnum.includes(v as GroupCriticality),
		),
		priority: priority as 1 | 2 | 3,
		createdBy: authedUser.navIdent,
	})

	return redirect(`/seksjoner/${seksjon}/rutiner/${routine.id}`)
}

export default function NyRutine() {
	const { section, technologyElements, controls, userCanChangePriority } = useLoaderData<typeof loader>()
	const actionData = useActionData<typeof action>()
	const fieldErrors = actionData && "fieldErrors" in actionData ? (actionData.fieldErrors as FieldErrors) : undefined
	const errorSummaryRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		if (fieldErrors) {
			errorSummaryRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })
			errorSummaryRef.current?.focus()
		}
	}, [fieldErrors])

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

					<TextField label="Navn" name="name" id="name" size="small" error={fieldErrors?.name} />

					<MarkdownEditor label="Beskrivelse" name="description" minRows={12} />

					<HStack gap="space-8" align="start" wrap>
						{technologyElements.length > 0 && (
							<div style={{ flex: "1 1 0" }}>
								<CheckboxGroup legend="Teknologielementer" size="small">
									{technologyElements.map((el) => (
										<Checkbox key={el.id} name="technologyElementIds" value={el.id}>
											{el.name}
										</Checkbox>
									))}
								</CheckboxGroup>
							</div>
						)}

						<VStack gap="space-2" style={{ flex: "1 1 0" }}>
							{isSectionRoutine && <input type="hidden" name="appliesToAllInSection" value="on" />}
							<CheckboxGroup
								legend="Scope"
								description="Vanligvis tilknyttes rutiner applikasjoner basert på screeningssvar. Her kan du overstyre dette og gjøre rutinen gjeldende for alle applikasjoner i seksjonen uten at de har gjennomført en screening."
								size="small"
							>
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
							</CheckboxGroup>
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
						</VStack>
					</HStack>

					<HStack gap="space-6" wrap align="end">
						<div style={{ flex: "1 1 0" }}>
							<Select
								label="Kronologisk frekvens"
								name="frequency"
								id="frequency"
								size="small"
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
						</div>
						<EventFrequencyCombobox value={eventFrequency} onChange={setEventFrequency} />
					</HStack>

					{userCanChangePriority ? (
						<PrioritySelect
							name="priority"
							defaultValue={3}
							size="small"
							id="priority"
							error={fieldErrors?.priority}
							description="Prioritet settes på seksjonsnivå og brukes til å hjelpe seksjonen med å prioritere hvilke rutiner som bør gjennomgås først."
						/>
					) : (
						<VStack gap="space-1">
							<Label size="small">Prioritet</Label>
							<BodyShort size="small" textColor="subtle">
								Prioritet settes på seksjonsnivå og brukes til å hjelpe seksjonen med å prioritere hvilke rutiner som
								bør gjennomgås først.
							</BodyShort>
							<PriorityTag priority={3} size="small" />
						</VStack>
					)}

					<Select
						label="Ansvarlig rolle"
						description="Rollen som er ansvarlig for å gjennomføre gjennomgangen av rutinen."
						name="responsibleRole"
						size="small"
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

					{controls.length > 0 && (
						<CheckboxGroup
							legend="Tilknyttede krav"
							description="Kravene som dokumenteres og bekreftes gjennom gjennomgangen av denne rutinen."
							size="small"
							value={selectedControlIds}
							onChange={handleControlChange}
						>
							{controls.map((ctrl) => (
								<Checkbox key={ctrl.id} name="controlIds" value={ctrl.id}>
									{ctrl.controlId} – {ctrl.name}
									{ctrl.responsible && ` (${ctrl.responsible})`}
								</Checkbox>
							))}
						</CheckboxGroup>
					)}

					<VStack gap="space-2">
						<Label size="small">Vedlikeholdsaktiviteter</Label>
						<BodyShort size="small" textColor="subtle">
							Dersom rutinen har vedlikeholdsaktiviteter, vil gjennomgangen inkludere et eget steg for å dokumentere
							oppfølging av et spesifikt krav.
						</BodyShort>
						<SortableActivityList disabled={isSectionRoutine} />
					</VStack>

					<Heading size="small" level="3">
						Avanserte innstillinger
					</Heading>

					<Heading size="xsmall" level="4">
						Database
					</Heading>

					<VStack gap="space-2">
						<Label size="small">Database og klassifisering</Label>
						<BodyShort size="small" textColor="subtle">
							Rutinen legges automatisk til for alle applikasjoner som bruker valgte databasetyper og/eller
							dataklassifiseringer.
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
								size="small"
								icon={<PlusIcon aria-hidden />}
								onClick={addPersistenceLink}
							>
								Legg til kobling
							</Button>
						</div>
					</VStack>

					<CheckboxGroup
						legend="Kritikalitet for Oracle-roller"
						description="Rutinen legges automatisk til for alle applikasjoner som har Oracle-roller med valgte kritikalitetsnivåer."
						size="small"
					>
						{Object.entries(groupCriticalityLabels).map(([key, label]) => (
							<Checkbox key={key} name="oracleRoleCriticalities" value={key}>
								{label}
							</Checkbox>
						))}
					</CheckboxGroup>

					<Heading size="xsmall" level="4">
						Tilgangskontroll
					</Heading>

					<CheckboxGroup
						legend="Tilgangsklassifisering for Entra ID-grupper"
						description="Rutinen legges automatisk til for alle applikasjoner som har Entra ID-grupper med valgte tilgangsmetoder."
						size="small"
					>
						{Object.entries(groupAccessClassificationLabels).map(([key, label]) => (
							<Checkbox key={key} name="groupClassifications" value={key}>
								{label}
							</Checkbox>
						))}
					</CheckboxGroup>

					<HStack gap="space-4">
						<Button type="submit" variant="primary" size="small">
							Opprett
						</Button>
						<Button as={Link} to=".." variant="secondary" size="small">
							Avbryt
						</Button>
					</HStack>
				</VStack>
			</Form>
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
