import { TrashIcon } from "@navikt/aksel-icons"
import {
	BodyShort,
	Button,
	Checkbox,
	CheckboxGroup,
	Heading,
	HStack,
	LocalAlert,
	Select,
	VStack,
} from "@navikt/ds-react"
import { useRef, useState } from "react"
import { Form, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { groupAccessClassificationLabels } from "~/db/schema/applications"
import { getStrictestFrequency, isFrequencyAtLeastAsOften, isRoutineFrequency } from "~/lib/routine-frequencies"
import { ApproveReplaceModal } from "./components/ApproveReplaceModal"
import { DeleteRoutineModal } from "./components/DeleteRoutineModal"
import { GrunnleggendeFields } from "./components/GrunnleggendeFields"
import { KontrollerField } from "./components/KontrollerField"
import { PersistenceLinks } from "./components/PersistenceLinks"
import { ScreeningQuestionLinks } from "./components/ScreeningQuestionLinks"
import type { loader } from "./loader.server"
import { type PersistenceLinkItem, PREDEFINED_ROLES, type QuestionLink } from "./shared"

export { action } from "./action.server"
export { loader } from "./loader.server"
export { RouteErrorBoundary as ErrorBoundary }

export default function RedigerRutine() {
	const { routine, questionsWithChoices, technologyElements, controls, userCanApprove } = useLoaderData<typeof loader>()

	const deleteModalRef = useRef<HTMLDialogElement>(null)
	const approveModalRef = useRef<HTMLDialogElement>(null)

	const [selectedControlIds, setSelectedControlIds] = useState<string[]>(routine.controls.map((c) => c.id))
	const [responsibleRole, setResponsibleRole] = useState(routine.responsibleRole ?? "")
	const [roleManuallySet, setRoleManuallySet] = useState(!!routine.responsibleRole)
	const [selectedFrequency, setSelectedFrequency] = useState(routine.frequency)

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
					<GrunnleggendeFields
						name={routine.name}
						description={routine.description}
						frequency={selectedFrequency}
						onFrequencyChange={setSelectedFrequency}
						minimumFrequency={minimumFrequency}
						status={routine.status}
						appliesToAllInSection={routine.appliesToAllInSection === 1}
					/>

					<ScreeningQuestionLinks
						links={questionLinks}
						questionsWithChoices={questionsWithChoices}
						onAdd={addQuestionLink}
						onRemove={removeQuestionLink}
						onUpdate={updateQuestionLink}
					/>

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

					<PersistenceLinks
						links={persistenceLinks}
						onAdd={addPersistenceLink}
						onRemove={removePersistenceLink}
						onUpdate={updatePersistenceLink}
					/>

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

					<KontrollerField controls={controls} selectedControlIds={selectedControlIds} onChange={handleControlChange} />

					<Select
						label="Vedlikeholdsaktivitet"
						description="Velg om gjennomganger av denne rutinen skal inkludere en strukturert vedlikeholdsaktivitet"
						name="activityType"
						defaultValue={routine.activityType ?? ""}
						size="small"
					>
						<option value="">Ingen</option>
						<option value="entra_id_group_maintenance">Entra ID-gruppevedlikehold</option>
					</Select>

					<HStack gap="space-4">
						<Button type="submit" variant="primary" size="small">
							Lagre
						</Button>
						{routine.sourceRoutineId && userCanApprove && routine.status === "active" && (
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

			<DeleteRoutineModal modalRef={deleteModalRef} routineName={routine.name} />

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
