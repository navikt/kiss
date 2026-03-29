import { BodyLong, Detail, Heading, Label, VStack } from "@navikt/ds-react"
import type { LoaderFunctionArgs } from "react-router"
import { data, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getControlDetail } from "~/lib/mock-data.server"

export async function loader({ params }: LoaderFunctionArgs) {
	const domene = params.domene?.toUpperCase()
	const kontrollId = params.kontrollId?.toUpperCase()

	if (!domene || !kontrollId) {
		throw new Response("Mangler parametere", { status: 400 })
	}

	const control = getControlDetail(kontrollId)

	return data({ domene, control })
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

	return (
		<VStack gap="space-6">
			<VStack gap="space-2">
				<Detail>Domene: {domene} / Kontroll</Detail>
				<Heading size="xlarge" level="2">
					{control.id}: {control.name}
				</Heading>
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
