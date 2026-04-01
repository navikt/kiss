import { PencilIcon, PlusIcon, TrashIcon, XMarkIcon } from "@navikt/aksel-icons"
import {
	Alert,
	BodyLong,
	Box,
	Button,
	Detail,
	Heading,
	HStack,
	Label,
	Select,
	Tag,
	Textarea,
	TextField,
	VStack,
} from "@navikt/ds-react"
import { useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, Link, useActionData, useLoaderData, useNavigation } from "react-router"
import type { ComplianceStatusValue } from "~/components/ComplianceStatus"
import { statusLabels } from "~/components/ComplianceStatus"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import {
	addPredefinedAnswer,
	deletePredefinedAnswer,
	getControlDetail,
	updateControlFields,
	updatePredefinedAnswer,
} from "~/db/queries/framework.server"
import {
	addControlElement,
	getAllTechnologyElements,
	getControlElements,
	removeControlElement,
} from "~/db/queries/technology-elements.server"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { isAdmin } from "~/lib/authorization.server"

const fieldConfig = [
	{ key: "shortTitle", label: "Kort tittel", multiline: false },
	{ key: "technologyElement", label: "Teknologielement", multiline: false },
	{ key: "requirement", label: "Krav", multiline: true },
	{ key: "responsible", label: "Ansvarlig", multiline: false },
	{ key: "routine", label: "Rutine", multiline: true },
	{ key: "frequency", label: "Frekvens", multiline: false },
	{ key: "documentationRequirement", label: "Dokumentasjonskrav", multiline: true },
	{ key: "testProcedure", label: "Testprosedyre", multiline: true },
	{ key: "dependencies", label: "Avhengigheter", multiline: true },
	{ key: "references", label: "Referanser", multiline: true },
	{ key: "commonPitfalls", label: "Vanlige fallgruver", multiline: true },
] as const

export async function loader({ request, params }: LoaderFunctionArgs) {
	const domene = params.domene?.toUpperCase()
	const kontrollId = params.kontrollId?.toUpperCase()

	if (!domene || !kontrollId) {
		throw new Response("Mangler parametere", { status: 400 })
	}

	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	if (!isAdmin(authedUser)) {
		throw new Response("Ikke tilgang", { status: 403 })
	}

	const control = await getControlDetail(kontrollId)
	if (!control) {
		throw new Response("Kontroll ikke funnet", { status: 404 })
	}

	const allElements = await getAllTechnologyElements()
	const controlElements = await getControlElements(control.uuid)

	return data({ domene, control, allElements, controlElements })
}

type ActionResult = { success: true; message: string } | { success: false; error: string }

export async function action({ request, params }: ActionFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	if (!isAdmin(authedUser)) return data<ActionResult>({ success: false, error: "Ikke tilgang" }, { status: 403 })

	const kontrollId = params.kontrollId?.toUpperCase()
	if (!kontrollId) return data<ActionResult>({ success: false, error: "Mangler kontroll-ID" }, { status: 400 })

	const formData = await request.formData()
	const intent = formData.get("intent") as string

	try {
		if (intent === "saveFields") {
			const fields: Record<string, string> = {}
			for (const field of fieldConfig) {
				const value = formData.get(field.key)
				if (typeof value === "string") {
					fields[field.key] = value
				}
			}
			await updateControlFields(kontrollId, fields, authedUser.navIdent)
			return data<ActionResult>({ success: true, message: "Endringene ble lagret." })
		}

		if (intent === "addAnswer") {
			const label = (formData.get("label") as string)?.trim()
			const status = formData.get("status") as string
			const comment = (formData.get("comment") as string)?.trim() || null
			if (!label || !status) return data<ActionResult>({ success: false, error: "Mangler label eller status" })
			await addPredefinedAnswer(kontrollId, label, status, comment, authedUser.navIdent)
			return data<ActionResult>({ success: true, message: "Forhåndsdefinert svar ble lagt til." })
		}

		if (intent === "updateAnswer") {
			const answerId = formData.get("answerId") as string
			const label = (formData.get("label") as string)?.trim()
			const status = formData.get("status") as string
			const comment = (formData.get("comment") as string)?.trim() || null
			if (!answerId || !label || !status) return data<ActionResult>({ success: false, error: "Mangler data" })
			await updatePredefinedAnswer(answerId, { label, status, comment }, authedUser.navIdent)
			return data<ActionResult>({ success: true, message: "Forhåndsdefinert svar ble oppdatert." })
		}

		if (intent === "deleteAnswer") {
			const answerId = formData.get("answerId") as string
			if (!answerId) return data<ActionResult>({ success: false, error: "Mangler svar-ID" })
			await deletePredefinedAnswer(answerId, authedUser.navIdent)
			return data<ActionResult>({ success: true, message: "Forhåndsdefinert svar ble slettet." })
		}

		if (intent === "addElement") {
			const control = await getControlDetail(kontrollId)
			if (!control) return data<ActionResult>({ success: false, error: "Kontroll ikke funnet" })
			const elementId = formData.get("elementId") as string
			if (!elementId) return data<ActionResult>({ success: false, error: "Mangler element-ID" })
			await addControlElement(control.uuid, elementId, authedUser.navIdent)
			return data<ActionResult>({ success: true, message: "Element ble lagt til." })
		}

		if (intent === "removeElement") {
			const control = await getControlDetail(kontrollId)
			if (!control) return data<ActionResult>({ success: false, error: "Kontroll ikke funnet" })
			const elementId = formData.get("elementId") as string
			if (!elementId) return data<ActionResult>({ success: false, error: "Mangler element-ID" })
			await removeControlElement(control.uuid, elementId, authedUser.navIdent)
			return data<ActionResult>({ success: true, message: "Element ble fjernet." })
		}

		return data<ActionResult>({ success: false, error: "Ukjent handling" }, { status: 400 })
	} catch (err) {
		return data<ActionResult>({
			success: false,
			error: err instanceof Error ? err.message : "Ukjent feil",
		})
	}
}

const statusVariants: Record<string, "info" | "success" | "warning" | "error" | "neutral"> = {
	not_relevant: "neutral",
	not_implemented: "error",
	partially_implemented: "warning",
	implemented: "success",
}

function PredefinedAnswerForm({
	answer,
	onCancel,
}: {
	answer?: { id: string; label: string; status: string; comment: string | null }
	onCancel?: () => void
}) {
	return (
		<Form method="post">
			<Box background="sunken" padding="space-16" borderRadius="8">
				<VStack gap="space-8">
					<input type="hidden" name="intent" value={answer ? "updateAnswer" : "addAnswer"} />
					{answer && <input type="hidden" name="answerId" value={answer.id} />}
					<TextField
						label="Navn på forhåndsdefinert svar"
						name="label"
						size="small"
						defaultValue={answer?.label ?? ""}
						description="Kort beskrivelse som vises som knapp, f.eks. «Implementert med Azure AD»"
					/>
					<Select label="Status" name="status" size="small" defaultValue={answer?.status ?? ""}>
						<option value="" disabled>
							Velg status
						</option>
						{Object.entries(statusLabels).map(([value, label]) => (
							<option key={value} value={value}>
								{label}
							</option>
						))}
					</Select>
					<Textarea
						label="Kommentar"
						name="comment"
						size="small"
						defaultValue={answer?.comment ?? ""}
						description="Forhåndsutfylt kommentar. Lenker vil vises som klikkbare lenker."
						minRows={2}
					/>
					<HStack gap="space-4">
						<Button type="submit" variant="primary" size="small">
							{answer ? "Oppdater" : "Legg til"}
						</Button>
						{onCancel && (
							<Button type="button" variant="tertiary" size="small" onClick={onCancel}>
								Avbryt
							</Button>
						)}
					</HStack>
				</VStack>
			</Box>
		</Form>
	)
}

export default function ControlEditPage() {
	const { domene, control, allElements, controlElements } = useLoaderData<typeof loader>()
	const actionData = useActionData<typeof action>()
	const navigation = useNavigation()
	const isSubmitting = navigation.state === "submitting"

	const [addingAnswer, setAddingAnswer] = useState(false)
	const [editingAnswerId, setEditingAnswerId] = useState<string | null>(null)

	const assignedIds = new Set(controlElements.map((e) => e.id))
	const availableElements = allElements.filter((e) => !assignedIds.has(e.id))

	const fieldValues: Record<string, string> = {
		shortTitle: control.name,
		technologyElement: control.teknologielement,
		requirement: control.krav,
		responsible: control.ansvarlig,
		routine: control.rutine,
		frequency: control.frekvens,
		documentationRequirement: control.dokumentasjonskrav,
		testProcedure: control.testprosedyre,
		dependencies: control.avhengigheter,
		references: control.referanser,
		commonPitfalls: control.vanligeFallgruver,
	}

	return (
		<VStack gap="space-12">
			<VStack gap="space-2">
				<Detail>
					<Link to={`/kontrollrammeverk/${domene}/${control.id}`}>← Tilbake til kontroll</Link>
				</Detail>
				<Heading size="xlarge" level="2">
					Rediger {control.id}: {control.name}
				</Heading>
			</VStack>

			{actionData && "success" in actionData && actionData.success && (
				<Alert variant="success" size="small">
					{actionData.message}
				</Alert>
			)}
			{actionData && "success" in actionData && !actionData.success && (
				<Alert variant="error" size="small">
					{actionData.error}
				</Alert>
			)}

			<Form method="post">
				<input type="hidden" name="intent" value="saveFields" />
				<VStack gap="space-6">
					<Heading size="medium" level="3">
						Kontrollinformasjon
					</Heading>
					{fieldConfig.map((field) =>
						field.multiline ? (
							<Textarea
								key={field.key}
								label={field.label}
								name={field.key}
								defaultValue={fieldValues[field.key]}
								minRows={3}
								size="small"
							/>
						) : (
							<TextField
								key={field.key}
								label={field.label}
								name={field.key}
								defaultValue={fieldValues[field.key]}
								size="small"
							/>
						),
					)}
					<div>
						<Button type="submit" variant="primary" loading={isSubmitting}>
							Lagre endringer
						</Button>
					</div>
				</VStack>
			</Form>

			<VStack gap="space-6">
				<Heading size="medium" level="3">
					Teknologielementer
				</Heading>
				<HStack gap="space-2" wrap>
					{controlElements.map((el) => (
						<Form method="post" key={el.id}>
							<input type="hidden" name="intent" value="removeElement" />
							<input type="hidden" name="elementId" value={el.id} />
							<Tag variant="info" size="small">
								{el.name}
								<Button
									type="submit"
									variant="tertiary-neutral"
									size="xsmall"
									icon={<XMarkIcon aria-hidden />}
									aria-label={`Fjern ${el.name}`}
								/>
							</Tag>
						</Form>
					))}
					{controlElements.length === 0 && <BodyLong size="small">Ingen elementer tilknyttet.</BodyLong>}
				</HStack>
				{availableElements.length > 0 && (
					<Form method="post">
						<input type="hidden" name="intent" value="addElement" />
						<HStack gap="space-4" align="end">
							<Select label="Legg til element" name="elementId" size="small">
								{availableElements.map((el) => (
									<option key={el.id} value={el.id}>
										{el.name}
									</option>
								))}
							</Select>
							<Button type="submit" variant="secondary" size="small" icon={<PlusIcon aria-hidden />}>
								Legg til
							</Button>
						</HStack>
					</Form>
				)}
			</VStack>

			<VStack gap="space-8">
				<Heading size="medium" level="3">
					Forhåndsdefinerte svar
				</Heading>
				<BodyLong size="small">
					Forhåndsdefinerte svar vises som hurtigvalg når applikasjoner skal vurderes mot denne kontrollen.
				</BodyLong>

				{control.predefinedAnswers.length > 0 && (
					<VStack gap="space-6">
						{control.predefinedAnswers.map((answer) =>
							editingAnswerId === answer.id ? (
								<PredefinedAnswerForm key={answer.id} answer={answer} onCancel={() => setEditingAnswerId(null)} />
							) : (
								<Box key={answer.id} borderWidth="1" borderColor="neutral-subtle" padding="space-16" borderRadius="8">
									<HStack justify="space-between" align="start">
										<VStack gap="space-4">
											<HStack gap="space-8" align="center">
												<Label size="small">{answer.label}</Label>
												<Tag size="xsmall" variant={statusVariants[answer.status] ?? "neutral"}>
													{statusLabels[answer.status as ComplianceStatusValue] ?? answer.status}
												</Tag>
											</HStack>
											{answer.comment && (
												<BodyLong size="small" style={{ whiteSpace: "pre-wrap", color: "var(--ax-text-subtle)" }}>
													{answer.comment}
												</BodyLong>
											)}
										</VStack>
										<HStack gap="space-2">
											<Button
												type="button"
												variant="tertiary-neutral"
												size="xsmall"
												icon={<PencilIcon aria-hidden />}
												onClick={() => setEditingAnswerId(answer.id)}
												aria-label={`Rediger ${answer.label}`}
											/>
											<Form method="post">
												<input type="hidden" name="intent" value="deleteAnswer" />
												<input type="hidden" name="answerId" value={answer.id} />
												<Button
													type="submit"
													variant="tertiary-neutral"
													size="xsmall"
													icon={<TrashIcon aria-hidden />}
													aria-label={`Slett ${answer.label}`}
												/>
											</Form>
										</HStack>
									</HStack>
								</Box>
							),
						)}
					</VStack>
				)}

				{addingAnswer ? (
					<PredefinedAnswerForm onCancel={() => setAddingAnswer(false)} />
				) : (
					<div>
						<Button
							variant="secondary"
							size="small"
							icon={<PlusIcon aria-hidden />}
							onClick={() => setAddingAnswer(true)}
						>
							Legg til forhåndsdefinert svar
						</Button>
					</div>
				)}
			</VStack>
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
