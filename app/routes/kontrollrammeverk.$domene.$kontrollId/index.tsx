import { PencilIcon } from "@navikt/aksel-icons"
import { BodyLong, Button, Detail, Heading, HStack, Label, Textarea, TextField, VStack } from "@navikt/ds-react"
import { useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getControlDetail, updateControlField } from "~/db/queries/framework.server"
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
	const kontrollId = params.kontrollId?.toUpperCase()
	if (!kontrollId) return data({ error: "Mangler kontroll-ID" }, { status: 400 })

	const formData = await request.formData()
	const fieldName = formData.get("fieldName") as string
	const value = formData.get("value") as string

	if (!fieldName) return data({ error: "Mangler feltnavn" }, { status: 400 })

	try {
		await updateControlField(kontrollId, fieldName, value ?? "", authedUser.navIdent)
		return data({ success: true })
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

export default function ControlDetailPage() {
	const { domene, control, canEdit } = useLoaderData<typeof loader>()

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
		<VStack gap="space-6">
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
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
