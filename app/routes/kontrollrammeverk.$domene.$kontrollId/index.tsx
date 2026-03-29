import { PencilIcon } from "@navikt/aksel-icons"
import { BodyLong, Button, Detail, Heading, HStack, Label, TextField, VStack } from "@navikt/ds-react"
import { useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getControlDetail, updateControlShortTitle } from "~/db/queries/framework.server"
import { getAuthenticatedUser } from "~/lib/auth.server"

export async function loader({ params }: LoaderFunctionArgs) {
	const domene = params.domene?.toUpperCase()
	const kontrollId = params.kontrollId?.toUpperCase()

	if (!domene || !kontrollId) {
		throw new Response("Mangler parametere", { status: 400 })
	}

	const control = await getControlDetail(kontrollId)
	if (!control) {
		throw new Response("Kontroll ikke funnet", { status: 404 })
	}

	return data({ domene, control })
}

export async function action({ request, params }: ActionFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const userName = user?.navIdent ?? "system"
	const kontrollId = params.kontrollId?.toUpperCase()
	if (!kontrollId) return data({ error: "Mangler kontroll-ID" }, { status: 400 })

	const formData = await request.formData()
	const shortTitle = formData.get("shortTitle") as string

	try {
		await updateControlShortTitle(kontrollId, shortTitle, userName)
		return data({ success: true })
	} catch (err) {
		return data({ error: err instanceof Error ? err.message : "Ukjent feil" }, { status: 500 })
	}
}

function FieldRow({ label, value }: { label: string; value: string }) {
	return (
		<VStack gap="space-2">
			<Label size="small">{label}</Label>
			<BodyLong>{value}</BodyLong>
		</VStack>
	)
}

export default function ControlDetailPage() {
	const { domene, control } = useLoaderData<typeof loader>()
	const [editing, setEditing] = useState(false)
	const [titleValue, setTitleValue] = useState(control.name)

	return (
		<VStack gap="space-6">
			<VStack gap="space-2">
				<Detail>Domene: {domene} / Kontroll</Detail>
				{editing ? (
					<Form method="post" onSubmit={() => setEditing(false)}>
						<HStack gap="space-2" align="end" wrap={false}>
							<TextField
								label={`Kort tittel for ${control.id}`}
								hideLabel
								size="small"
								name="shortTitle"
								value={titleValue}
								onChange={(e) => setTitleValue(e.target.value)}
								autoFocus
							/>
							<Button type="submit" variant="primary" size="small">
								Lagre
							</Button>
							<Button
								type="button"
								variant="tertiary"
								size="small"
								onClick={() => {
									setTitleValue(control.name)
									setEditing(false)
								}}
							>
								Avbryt
							</Button>
						</HStack>
					</Form>
				) : (
					<HStack gap="space-2" align="center">
						<Heading size="xlarge" level="2">
							{control.id}: {control.name}
						</Heading>
						<Button
							type="button"
							variant="tertiary-neutral"
							size="small"
							icon={<PencilIcon aria-hidden />}
							onClick={() => setEditing(true)}
							aria-label={`Rediger kort tittel for ${control.id}`}
						/>
					</HStack>
				)}
			</VStack>

			<VStack gap="space-4">
				<FieldRow label="Teknologielement" value={control.teknologielement} />
				<FieldRow label="Krav" value={control.krav} />
				<FieldRow label="Ansvarlig" value={control.ansvarlig} />
				<FieldRow label="Rutine" value={control.rutine} />
				<FieldRow label="Frekvens" value={control.frekvens} />
				<FieldRow label="Dokumentasjonskrav" value={control.dokumentasjonskrav} />
				<FieldRow label="Testprosedyre" value={control.testprosedyre} />
				<FieldRow label="Avhengigheter" value={control.avhengigheter} />
				<FieldRow label="Referanser" value={control.referanser} />
				<FieldRow label="Vanlige fallgruver" value={control.vanligeFallgruver} />
			</VStack>
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
