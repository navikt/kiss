import { PencilIcon, PlusIcon, TrashIcon } from "@navikt/aksel-icons"
import {
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
import { data, Form, useLoaderData } from "react-router"
import type { ComplianceStatusValue } from "~/components/ComplianceStatus"
import { statusLabels } from "~/components/ComplianceStatus"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import {
	addPredefinedAnswer,
	deletePredefinedAnswer,
	getControlDetail,
	updateControlField,
	updatePredefinedAnswer,
} from "~/db/queries/framework.server"
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

	const control = await getControlDetail(kontrollId)
	if (!control) {
		throw new Response("Kontroll ikke funnet", { status: 404 })
	}

	const user = await getAuthenticatedUser(request)
	const canEdit = user ? isAdmin(user) : false

	return data({ domene, control, canEdit })
}

export async function action({ request, params }: ActionFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	if (!isAdmin(authedUser)) return data({ error: "Ikke tilgang" }, { status: 403 })

	const kontrollId = params.kontrollId?.toUpperCase()
	if (!kontrollId) return data({ error: "Mangler kontroll-ID" }, { status: 400 })

	const formData = await request.formData()
	const intent = formData.get("intent") as string

	try {
		if (intent === "updateField") {
			const fieldName = formData.get("fieldName") as string
			const value = formData.get("value") as string
			if (!fieldName) return data({ error: "Mangler feltnavn" }, { status: 400 })
			await updateControlField(kontrollId, fieldName, value ?? "", authedUser.navIdent)
			return data({ success: true })
		}

		if (intent === "addAnswer") {
			const label = (formData.get("label") as string)?.trim()
			const status = formData.get("status") as string
			const comment = (formData.get("comment") as string)?.trim() || null
			if (!label || !status) return data({ error: "Mangler label eller status" }, { status: 400 })
			await addPredefinedAnswer(kontrollId, label, status, comment, authedUser.navIdent)
			return data({ success: true })
		}

		if (intent === "updateAnswer") {
			const answerId = formData.get("answerId") as string
			const label = (formData.get("label") as string)?.trim()
			const status = formData.get("status") as string
			const comment = (formData.get("comment") as string)?.trim() || null
			if (!answerId || !label || !status) return data({ error: "Mangler data" }, { status: 400 })
			await updatePredefinedAnswer(answerId, { label, status, comment }, authedUser.navIdent)
			return data({ success: true })
		}

		if (intent === "deleteAnswer") {
			const answerId = formData.get("answerId") as string
			if (!answerId) return data({ error: "Mangler svar-ID" }, { status: 400 })
			await deletePredefinedAnswer(answerId, authedUser.navIdent)
			return data({ success: true })
		}

		return data({ error: "Ukjent handling" }, { status: 400 })
	} catch (err) {
		return data({ error: err instanceof Error ? err.message : "Ukjent feil" }, { status: 500 })
	}
}

function EditableField({
	fieldKey,
	label,
	value,
	multiline,
	canEdit,
	controlId,
}: {
	fieldKey: string
	label: string
	value: string
	multiline: boolean
	canEdit: boolean
	controlId: string
}) {
	const [editing, setEditing] = useState(false)
	const [currentValue, setCurrentValue] = useState(value)

	if (editing && canEdit) {
		return (
			<Form method="post" onSubmit={() => setEditing(false)}>
				<VStack gap="space-2">
					<input type="hidden" name="intent" value="updateField" />
					<input type="hidden" name="fieldName" value={fieldKey} />
					{multiline ? (
						<Textarea
							label={label}
							name="value"
							value={currentValue}
							onChange={(e) => setCurrentValue(e.target.value)}
							minRows={3}
							autoFocus
						/>
					) : (
						<TextField
							label={label}
							name="value"
							value={currentValue}
							onChange={(e) => setCurrentValue(e.target.value)}
							autoFocus
						/>
					)}
					<HStack gap="space-2">
						<Button type="submit" variant="primary" size="small">
							Lagre
						</Button>
						<Button
							type="button"
							variant="tertiary"
							size="small"
							onClick={() => {
								setCurrentValue(value)
								setEditing(false)
							}}
						>
							Avbryt
						</Button>
					</HStack>
				</VStack>
			</Form>
		)
	}

	return (
		<VStack gap="space-2">
			<HStack gap="space-2" align="center">
				<Label size="small">{label}</Label>
				{canEdit && (
					<Button
						type="button"
						variant="tertiary-neutral"
						size="xsmall"
						icon={<PencilIcon aria-hidden />}
						onClick={() => setEditing(true)}
						aria-label={`Rediger ${label} for ${controlId}`}
					/>
				)}
			</HStack>
			<BodyLong style={{ whiteSpace: "pre-wrap" }}>{currentValue}</BodyLong>
		</VStack>
	)
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

export default function ControlDetailPage() {
	const { domene, control, canEdit } = useLoaderData<typeof loader>()
	const [addingAnswer, setAddingAnswer] = useState(false)
	const [editingAnswerId, setEditingAnswerId] = useState<string | null>(null)

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
				<Detail>Domene: {domene} / Kontroll</Detail>
				<Heading size="xlarge" level="2">
					{control.id}: {control.name}
				</Heading>
			</VStack>

			<VStack gap="space-6">
				{fieldConfig.map((field) => (
					<EditableField
						key={field.key}
						fieldKey={field.key}
						label={field.label}
						value={fieldValues[field.key]}
						multiline={field.multiline}
						canEdit={canEdit}
						controlId={control.id}
					/>
				))}
			</VStack>

			{/* Predefined answers — admin only */}
			{canEdit && (
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
			)}
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
