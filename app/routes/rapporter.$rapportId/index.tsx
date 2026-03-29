import { BodyLong, Heading, Table, Tag, VStack } from "@navikt/ds-react"
import type { LoaderFunctionArgs } from "react-router"
import { data, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getMockReport } from "~/lib/mock-data.server"

const statusTagVariant: Record<string, "success" | "warning" | "error" | "neutral"> = {
	oppfylt: "success",
	delvis: "warning",
	"ikke-oppfylt": "error",
	"ikke-vurdert": "neutral",
}

const statusLabel: Record<string, string> = {
	oppfylt: "Oppfylt",
	delvis: "Delvis oppfylt",
	"ikke-oppfylt": "Ikke oppfylt",
	"ikke-vurdert": "Ikke vurdert",
}

export async function loader({ params }: LoaderFunctionArgs) {
	const rapportId = params.rapportId ?? "ukjent"
	return data({ report: getMockReport(rapportId) })
}

export default function RapportDetalj() {
	const { report } = useLoaderData<typeof loader>()

	return (
		<VStack gap="space-6">
			<Heading size="xlarge" level="2">
				{report.name}
			</Heading>

			<VStack gap="space-2">
				<Heading size="medium" level="3">
					Metadata
				</Heading>
				<BodyLong>
					<strong>Rapport-ID:</strong> {report.rapportId}
				</BodyLong>
				<BodyLong>
					<strong>Type:</strong> {report.type}
				</BodyLong>
				<BodyLong>
					<strong>Omfang:</strong> {report.scope}
				</BodyLong>
				<BodyLong>
					<strong>Opprettet:</strong> {new Date(report.createdAt).toLocaleString("nb-NO")}
				</BodyLong>
				<BodyLong>
					<strong>Appversjon:</strong> {report.appVersion}
				</BodyLong>
			</VStack>

			<VStack gap="space-4">
				<Heading size="medium" level="3">
					Compliance-status
				</Heading>
				<section className="table-scroll" tabIndex={-1} aria-label="Compliance-status">
					<Table>
						<Table.Header>
							<Table.Row>
								<Table.HeaderCell scope="col">Kontroll-ID</Table.HeaderCell>
								<Table.HeaderCell scope="col">Kontrollnavn</Table.HeaderCell>
								<Table.HeaderCell scope="col">Status</Table.HeaderCell>
								<Table.HeaderCell scope="col">Kommentar</Table.HeaderCell>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{report.complianceRows.map((row) => (
								<Table.Row key={row.controlId}>
									<Table.DataCell>{row.controlId}</Table.DataCell>
									<Table.DataCell>{row.controlName}</Table.DataCell>
									<Table.DataCell>
										<Tag variant={statusTagVariant[row.status]} size="small">
											{statusLabel[row.status]}
										</Tag>
									</Table.DataCell>
									<Table.DataCell>{row.comment || "–"}</Table.DataCell>
								</Table.Row>
							))}
						</Table.Body>
					</Table>
				</section>
			</VStack>
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
