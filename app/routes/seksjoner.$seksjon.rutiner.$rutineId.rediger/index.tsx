import { PlusIcon, TrashIcon } from "@navikt/aksel-icons"
import {
	BodyLong,
	BodyShort,
	Button,
	Checkbox,
	CheckboxGroup,
	ErrorSummary,
	Heading,
	HStack,
	Label,
	LocalAlert,
	Modal,
	Select,
	TextField,
	VStack,
} from "@navikt/ds-react"
import { useEffect, useRef, useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, redirect, useActionData, useLoaderData } from "react-router"
import { ApproveReplaceModal } from "~/components/ApproveReplaceModal"
import { EventFrequencyCombobox } from "~/components/EventFrequencyCombobox"
import { MarkdownEditor } from "~/components/MarkdownEditor"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { SortableActivityList } from "~/components/SortableActivityList"
import { getAllControlsForSelection } from "~/db/queries/framework.server"
import {
	approveRoutine,
	deleteDraftRoutine,
	getRoutine,
	getRoutineActivityLinks,
	replaceRoutine,
	unarchiveRoutine,
	updateRoutine,
} from "~/db/queries/routines.server"
import {
	getChoicesForQuestion,
	getScreeningQuestions,
	getScreeningQuestionsByIds,
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
import { ROUTINE_ACTIVITY_TYPES, type RoutineActivityType, type RoutineStatus } from "~/db/schema/routines"
import { screeningQuestionStatusConfig } from "~/db/schema/screening"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { canApproveRoutine, isAdmin, requireAdmin, requireAnySectionRole } from "~/lib/authorization.server"
import {
	frequencyLabels,
	getStrictestFrequency,
	isFrequencyAtLeastAsOften,
	isRoutineFrequency,
	ROUTINE_FREQUENCIES,
	type RoutineFrequency,
} from "~/lib/routine-frequencies"
import type { RoutineFieldErrors } from "~/lib/routine-validation"

const EDITABLE_STATUSES: RoutineStatus[] = ["draft", "ready"]

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

	const { seksjon, rutineId } = params
	if (!seksjon || !rutineId) throw new Response("Mangler parametere", { status: 400 })

	const section = await getSectionBySlug(seksjon)
	if (!section) throw new Response("Seksjon ikke funnet", { status: 404 })

	requireAnySectionRole(authedUser, section.id)

	const routine = await getRoutine(rutineId)
	if (!routine) throw new Response("Rutine ikke funnet", { status: 404 })
	if (routine.sectionId !== section.id) throw new Response("Rutine ikke funnet", { status: 404 })

	const [globalQuestions, sectionQuestions, technologyElements, controls, activityLinks] = await Promise.all([
		getScreeningQuestions({ status: "approved" }),
		getSectionScreeningQuestions(section.id, { status: "approved" }),
		getAllTechnologyElements(),
		getAllControlsForSelection(),
		getRoutineActivityLinks(rutineId),
	])

	const allQuestions = [...globalQuestions, ...sectionQuestions]

	// Include questions already linked to this routine even if not approved,
	// so existing links remain visible and editable in the UI
	const linkedQuestionIds = new Set([
		...(routine.screeningQuestions?.map((sq: { questionId: string }) => sq.questionId) ?? []),
		...(routine.screeningQuestionId ? [routine.screeningQuestionId] : []),
	])
	const approvedIds = new Set(allQuestions.map((q) => q.id))
	const missingLinkedIds = [...linkedQuestionIds].filter((id) => !approvedIds.has(id))
	const missingLinkedQuestions = await getScreeningQuestionsByIds(missingLinkedIds)
	const combinedQuestions = [...allQuestions, ...missingLinkedQuestions]

	const questionsWithChoices = await Promise.all(
		combinedQuestions.map(async (q) => ({
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
		activityLinks: (activityLinks.length > 0
			? activityLinks.map((l) => l.activityType)
			: routine.activityType
				? [routine.activityType]
				: []) as RoutineActivityType[],
		questionsWithChoices,
		technologyElements,
		controls,
		userCanApprove,
	})
}

export async function action({ request, params }: ActionFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)

	const { seksjon, rutineId } = params
	if (!seksjon || !rutineId) throw new Response("Mangler parametere", { status: 400 })

	const section = await getSectionBySlug(seksjon)
	if (!section) throw new Response("Seksjon ikke funnet", { status: 404 })

	requireAnySectionRole(authedUser, section.id)

	const existingRoutine = await getRoutine(rutineId)
	if (!existingRoutine) throw new Response("Rutine ikke funnet", { status: 404 })
	if (existingRoutine.sectionId !== section.id) throw new Response("Rutine ikke funnet", { status: 404 })

	const formData = await request.formData()
	const intent = formData.get("intent") as string

	// Unarchive må håndteres før status-guarden, ellers blir backfillede rader
	// (status='deleted' + archivedAt) blokkert fra reaktivering.
	if (intent === "unarchive") {
		const effectiveRole =
			existingRoutine.responsibleRole || existingRoutine.controls.find((c) => c.responsible)?.responsible || null
		if (!isAdmin(authedUser) && !canApproveRoutine(authedUser, effectiveRole, section.id)) {
			throw new Response("Du har ikke rettigheter til å reaktivere denne rutinen.", { status: 403 })
		}
		if (!existingRoutine.archivedAt) {
			throw new Response("Rutinen er ikke arkivert.", { status: 409 })
		}
		await unarchiveRoutine(rutineId, authedUser.navIdent)
		return redirect(`/seksjoner/${seksjon}/rutiner/${rutineId}/rediger`)
	}

	// Arkiverte rutiner kan ikke redigeres eller slettes på nytt — bare reaktiveres.
	if (existingRoutine.archivedAt) {
		throw new Response("Arkiverte rutiner kan ikke endres. Reaktiver rutinen først.", { status: 403 })
	}

	// Only draft and active routines can be edited (allowlist to guard against unknown statuses)
	if (!EDITABLE_STATUSES.includes(existingRoutine.status as RoutineStatus)) {
		throw new Response(`Rutiner med status «${existingRoutine.status}» kan ikke redigeres.`, { status: 403 })
	}

	if (intent === "update") {
		const name = (formData.get("name") as string)?.trim()
		const description = (formData.get("description") as string)?.trim() || null
		const frequency = formData.get("frequency") as string
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
					fieldErrors: {
						sectionRoutineOwnerRole: "Eier/utførende rolle er påkrevd for seksjonsrutiner",
					} as FieldErrors,
				},
				{ status: 400 },
			)
		}
		const activityTypesField = formData.get("activityTypes") as string | null
		let activityTypes: RoutineActivityType[] | undefined
		let activityType: RoutineActivityType | null | undefined
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
		} else {
			// Legacy form: read single activityType field
			const activityTypeRaw = (formData.get("activityType") as string)?.trim() || null
			activityType =
				!isSectionRoutine && activityTypeRaw && ROUTINE_ACTIVITY_TYPES.includes(activityTypeRaw as RoutineActivityType)
					? (activityTypeRaw as RoutineActivityType)
					: null
		}
		const technologyElementIds = formData.getAll("technologyElementIds") as string[]
		const controlIds = formData.getAll("controlIds") as string[]
		const groupClassifications = formData.getAll("groupClassifications") as string[]
		const oracleRoleCriticalities = formData.getAll("oracleRoleCriticalities") as string[]
		const statusRaw = formData.get("status") as string | null
		const status =
			statusRaw && EDITABLE_STATUSES.includes(statusRaw as RoutineStatus) ? (statusRaw as RoutineStatus) : undefined

		// Parse persistence links from form
		const plTypes = formData.getAll("plPersistenceType") as string[]
		const plClassifications = formData.getAll("plDataClassification") as string[]
		const persistenceLinks = plTypes
			.map((t, i) => ({
				persistenceType: (t.trim() || null) as PersistenceType | null,
				dataClassification: (plClassifications[i]?.trim() || null) as DataClassification | null,
			}))
			.filter((l) => l.persistenceType || l.dataClassification)

		if (!name) return data({ fieldErrors: { name: "Navn er påkrevd" } as FieldErrors }, { status: 400 })
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
			frequency: parsedFrequency,
			eventFrequency: eventFrequencyRaw,
			responsibleRole,
			appliesToAllInSection,
			isSectionRoutine,
			sectionRoutineOwnerRole,
			activityTypes,
			activityType,
			persistenceLinks,
			screeningQuestionId: firstLink?.questionId ?? null,
			screeningChoiceValue: firstLink?.choiceValue ?? null,
			screeningQuestionLinks,
			technologyElementIds,
			controlIds,
			groupClassifications: groupClassifications.filter(Boolean) as GroupAccessClassification[],
			oracleRoleCriticalities: oracleRoleCriticalities.filter((v): v is GroupCriticality =>
				groupCriticalityEnum.includes(v as GroupCriticality),
			),
			status,
			updatedBy: authedUser.navIdent,
		})

		return redirect(`/seksjoner/${seksjon}/rutiner/${rutineId}`)
	}

	if (intent === "delete") {
		requireAdmin(authedUser)
		if (existingRoutine.status !== "draft") {
			throw new Response("Kun draft-rutiner kan slettes.", { status: 403 })
		}
		await deleteDraftRoutine(rutineId, authedUser.navIdent)
		return redirect(`/seksjoner/${seksjon}/rutiner`)
	}

	if (intent === "approve-replace") {
		const effectiveRole =
			existingRoutine.responsibleRole || existingRoutine.controls.find((c) => c.responsible)?.responsible || null
		if (!canApproveRoutine(authedUser, effectiveRole, section.id)) {
			throw new Response("Du har ikke riktig rolle til å godkjenne denne rutinen", { status: 403 })
		}

		const deadlinePolicy = formData.get("deadlinePolicy") as "reset" | "continue"
		if (!deadlinePolicy || !["reset", "continue"].includes(deadlinePolicy)) {
			throw new Response("Ugyldig fristpolicy", { status: 400 })
		}

		if (!existingRoutine.sourceRoutineId) {
			throw new Response("Rutinen har ikke et opphav å erstatte", { status: 400 })
		}

		await replaceRoutine(rutineId, existingRoutine.sourceRoutineId, deadlinePolicy, authedUser.navIdent)
		return redirect(`/seksjoner/${seksjon}/rutiner/${rutineId}`)
	}

	if (intent === "approve-as-new") {
		const effectiveRole =
			existingRoutine.responsibleRole || existingRoutine.controls.find((c) => c.responsible)?.responsible || null
		if (!canApproveRoutine(authedUser, effectiveRole, section.id)) {
			throw new Response("Du har ikke riktig rolle til å godkjenne denne rutinen", { status: 403 })
		}

		await approveRoutine(rutineId, authedUser.navIdent)
		return redirect(`/seksjoner/${seksjon}/rutiner/${rutineId}`)
	}

	throw new Response("Ugyldig handling", { status: 400 })
}

export default function RedigerRutine() {
	const { routine, activityLinks, questionsWithChoices, technologyElements, controls, userCanApprove } =
		useLoaderData<typeof loader>()
	const actionData = useActionData<typeof action>()
	const fieldErrors =
		actionData && typeof actionData === "object" && "fieldErrors" in actionData
			? (actionData.fieldErrors as FieldErrors)
			: undefined
	const errorSummaryRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		if (fieldErrors) {
			errorSummaryRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })
			errorSummaryRef.current?.focus()
		}
	}, [fieldErrors])

	const deleteModalRef = useRef<HTMLDialogElement>(null)
	const approveModalRef = useRef<HTMLDialogElement>(null)

	const [selectedControlIds, setSelectedControlIds] = useState<string[]>(routine.controls.map((c) => c.id))
	const [responsibleRole, setResponsibleRole] = useState(routine.responsibleRole ?? "")
	const [roleManuallySet, setRoleManuallySet] = useState(!!routine.responsibleRole)
	const [isSectionRoutine, setIsSectionRoutine] = useState(routine.isSectionRoutine === 1)
	const [appliesToAll, setAppliesToAll] = useState(routine.appliesToAllInSection === 1)
	const [selectedFrequency, setSelectedFrequency] = useState<RoutineFrequency | "">(routine.frequency ?? "")
	const [eventFrequency, setEventFrequency] = useState<string>(routine.eventFrequency ?? "")

	const selectedControls = controls.filter((c) => selectedControlIds.includes(c.id))
	const minimumFrequency = getStrictestFrequency(selectedControls.map((c) => c.frequency))

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

	// Persistence links state
	const initialPersistenceLinks: PersistenceLinkItem[] = routine.persistenceLinks.map((pl) => ({
		key: pl.id,
		persistenceType: pl.persistenceType ?? "",
		dataClassification: pl.dataClassification ?? "",
	}))
	const [persistenceLinks, setPersistenceLinks] = useState<PersistenceLinkItem[]>(initialPersistenceLinks)

	const addPersistenceLink = () => {
		setPersistenceLinks((prev) => [...prev, { key: crypto.randomUUID(), persistenceType: "", dataClassification: "" }])
	}

	const removePersistenceLink = (index: number) => {
		setPersistenceLinks((prev) => prev.filter((_, i) => i !== index))
	}

	const updatePersistenceLink = (index: number, field: "persistenceType" | "dataClassification", value: string) => {
		setPersistenceLinks((prev) => prev.map((link, i) => (i !== index ? link : { ...link, [field]: value })))
	}

	// Når rutinen er arkivert (soft-deleted) er hele skjemaet read-only.
	// Action-laget avviser uansett alle mutasjoner med 403 (unntatt
	// `unarchive`), så vi short-circuit-er UI-en til å kun vise banneret
	// + Reaktiver-knappen for å unngå forvirrende submit-feil.
	if (routine.archivedAt) {
		return (
			<VStack gap="space-8">
				<Heading size="xlarge" level="2" spacing>
					Rediger rutine: {routine.name}
				</Heading>

				<LocalAlert status="warning">
					<LocalAlert.Header>
						<LocalAlert.Title>Rutinen er arkivert</LocalAlert.Title>
					</LocalAlert.Header>
					<LocalAlert.Content>
						<VStack gap="space-8">
							<BodyShort size="small">
								Arkivert {new Date(routine.archivedAt).toLocaleString("nb-NO")}
								{routine.archivedBy ? ` av ${routine.archivedBy}` : ""}. Den er skjult fra oversikter, men all
								konfigurasjon, gjennomganger og audit-logg er bevart. Reaktiver rutinen for å redigere den.
							</BodyShort>
							<Form method="post">
								<input type="hidden" name="intent" value="unarchive" />
								<Button variant="secondary" size="small" type="submit">
									Reaktiver rutine
								</Button>
							</Form>
						</VStack>
					</LocalAlert.Content>
				</LocalAlert>
			</VStack>
		)
	}

	return (
		<VStack gap="space-8">
			<Heading size="xlarge" level="2" spacing>
				Rediger rutine: {routine.name}
			</Heading>

			{routine.sourceRoutineId && (
				<LocalAlert status="announcement">
					<LocalAlert.Header>
						<LocalAlert.Title>Kopi av eksisterende rutine</LocalAlert.Title>
					</LocalAlert.Header>
					<LocalAlert.Content>
						<BodyShort size="small">
							Denne rutinen er en kopi. Når du er ferdig med endringer, kan du godkjenne den for å erstatte originalen
							eller legge den til som en ny rutine.
						</BodyShort>
					</LocalAlert.Content>
				</LocalAlert>
			)}

			<Form method="post">
				<input type="hidden" name="intent" value="update" />
				<VStack gap="space-4">
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

					<TextField
						label="Navn"
						name="name"
						id="name"
						defaultValue={routine.name}
						size="small"
						autoComplete="off"
						error={fieldErrors?.name}
					/>
					<MarkdownEditor label="Beskrivelse" name="description" defaultValue={routine.description ?? ""} />
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
							size="small"
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

					<Select label="Status" name="status" defaultValue={routine.status ?? "draft"} size="small">
						<option value="draft">Kladd</option>
						<option value="ready">Ferdig</option>
						<option value="archived">Arkivert</option>
					</Select>

					{isSectionRoutine && <input type="hidden" name="appliesToAllInSection" value="on" />}
					<Checkbox
						name={isSectionRoutine ? undefined : "appliesToAllInSection"}
						checked={isSectionRoutine ? true : appliesToAll}
						onChange={(e) => !isSectionRoutine && setAppliesToAll(e.target.checked)}
						disabled={isSectionRoutine}
						size="small"
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
							defaultValue={routine.sectionRoutineOwnerRole ?? ""}
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
																{q.status !== "approved"
																	? ` (${screeningQuestionStatusConfig[q.status]?.label ?? q.status})`
																	: ""}
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
															{q.status !== "approved"
																? ` (${screeningQuestionStatusConfig[q.status]?.label ?? q.status})`
																: ""}
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
						size="small"
						defaultValue={routine.groupClassifications.map((gc) => gc.classification)}
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
						size="small"
						defaultValue={routine.oracleRoleCriticalities?.map((orc) => orc.criticality) ?? []}
					>
						{Object.entries(groupCriticalityLabels).map(([key, label]) => (
							<Checkbox key={key} name="oracleRoleCriticalities" value={key}>
								{label}
							</Checkbox>
						))}
					</CheckboxGroup>

					{controls.length > 0 && (
						<CheckboxGroup
							legend="Tilknyttede krav"
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

					<SortableActivityList initialActivities={activityLinks} disabled={isSectionRoutine} />

					<HStack gap="space-4">
						<Button type="submit" variant="primary" size="small">
							Lagre
						</Button>
						{routine.sourceRoutineId && userCanApprove && routine.status === "ready" && (
							<Button type="button" variant="primary" size="small" onClick={() => approveModalRef.current?.showModal()}>
								Godkjenn
							</Button>
						)}
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

			{routine.sourceRoutineId && (
				<ApproveReplaceModal
					modalRef={approveModalRef}
					routineName={routine.name}
					hasSource={!!routine.sourceRoutineId}
				/>
			)}
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
