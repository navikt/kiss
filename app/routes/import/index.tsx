import { Alert, BodyLong, Button, Heading, Table, VStack } from "@navikt/ds-react"
import type { ActionFunctionArgs } from "react-router"
import { data, Form, useActionData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { type ParsedFrameworkRow, parseFrameworkExcel, summarizeFramework } from "~/lib/excel-parser.server"

interface SerializedSummary {
	domainCount: number
	riskCount: number
	controlCount: number
	fileName: string
	uploadedAt: string
	uploadedBy: string
	controls: Array<{
		controlId: string
		domain: string
		riskId: string
		requirement: string | null
		responsible: string | null
		frequency: string | null
	}>
}

type ActionResult = { success: true; summary: SerializedSummary } | { success: false; error: string }

export async function action({ request }: ActionFunctionArgs) {
	const formData = await request.formData()
	const file = formData.get("file")

	if (!file || !(file instanceof File) || file.size === 0) {
		return data<ActionResult>({
			success: false,
			error: "Ingen fil valgt. Vennligst last opp en .xlsx-fil.",
		})
	}

	if (!file.name.endsWith(".xlsx")) {
		return data<ActionResult>({
			success: false,
			error: "Ugyldig filformat. Kun .xlsx-filer støttes.",
		})
	}

	try {
		const arrayBuffer = await file.arrayBuffer()
		const buffer = Buffer.from(arrayBuffer)
		const parsed = parseFrameworkExcel(buffer)
		const summary = summarizeFramework(parsed)

		const controls = Array.from(summary.controls.values()).map((row: ParsedFrameworkRow) => ({
			controlId: row.controlId,
			domain: row.domain,
			riskId: row.riskId,
			requirement: row.requirement,
			responsible: row.responsible,
			frequency: row.frequency,
		}))

		return data<ActionResult>({
			success: true,
			summary: {
				domainCount: summary.domains.size,
				riskCount: summary.risks.size,
				controlCount: summary.controls.size,
				fileName: file.name,
				uploadedAt: new Date().toISOString(),
				uploadedBy: "Ukjent bruker",
				controls,
			},
		})
	} catch (err) {
		return data<ActionResult>({
			success: false,
			error: err instanceof Error ? err.message : "Ukjent feil ved parsing av fil.",
		})
	}
}

export default function Import() {
	const actionData = useActionData<typeof action>()

	return (
		<VStack gap="space-6">
			<Heading size="xlarge" level="2">
				Importer kontrollrammeverk
			</Heading>
			<BodyLong>Last opp Excel-fil med kontrollrammeverk-data for import.</BodyLong>

			<Form method="post" encType="multipart/form-data">
				<VStack gap="space-4">
					<div>
						<label htmlFor="file-upload" style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600 }}>
							Velg Excel-fil (.xlsx)
						</label>
						<input id="file-upload" type="file" name="file" accept=".xlsx" />
					</div>
					<div>
						<Button type="submit" variant="primary">
							Last opp og valider
						</Button>
					</div>
				</VStack>
			</Form>

			{actionData && !actionData.success && <Alert variant="error">{actionData.error}</Alert>}

			{actionData?.success && (
				<VStack gap="space-6">
					<Alert variant="success">Filen ble lest og validert. Kontroller dataene nedenfor før aktivering.</Alert>

					<VStack gap="space-2">
						<Heading size="medium" level="3">
							Metadata
						</Heading>
						<BodyLong>
							<strong>Filnavn:</strong> {actionData.summary.fileName}
						</BodyLong>
						<BodyLong>
							<strong>Lastet opp:</strong> {new Date(actionData.summary.uploadedAt).toLocaleString("nb-NO")}
						</BodyLong>
						<BodyLong>
							<strong>Lastet opp av:</strong> {actionData.summary.uploadedBy}
						</BodyLong>
					</VStack>

					<VStack gap="space-2">
						<Heading size="medium" level="3">
							Oppsummering
						</Heading>
						<BodyLong>
							{actionData.summary.domainCount} domener · {actionData.summary.riskCount} risikoer ·{" "}
							{actionData.summary.controlCount} kontroller
						</BodyLong>
					</VStack>

					<VStack gap="space-4">
						<Heading size="medium" level="3">
							Kontroller (forhåndsvisning)
						</Heading>
						<Table>
							<Table.Header>
								<Table.Row>
									<Table.HeaderCell scope="col">Kontroll-ID</Table.HeaderCell>
									<Table.HeaderCell scope="col">Domene</Table.HeaderCell>
									<Table.HeaderCell scope="col">Risiko-ID</Table.HeaderCell>
									<Table.HeaderCell scope="col">Krav</Table.HeaderCell>
									<Table.HeaderCell scope="col">Ansvarlig</Table.HeaderCell>
									<Table.HeaderCell scope="col">Frekvens</Table.HeaderCell>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{actionData.summary.controls.map((control) => (
									<Table.Row key={control.controlId}>
										<Table.DataCell>{control.controlId}</Table.DataCell>
										<Table.DataCell>{control.domain}</Table.DataCell>
										<Table.DataCell>{control.riskId}</Table.DataCell>
										<Table.DataCell>{control.requirement ?? "–"}</Table.DataCell>
										<Table.DataCell>{control.responsible ?? "–"}</Table.DataCell>
										<Table.DataCell>{control.frequency ?? "–"}</Table.DataCell>
									</Table.Row>
								))}
							</Table.Body>
						</Table>
					</VStack>

					<div>
						<Form method="post">
							<input type="hidden" name="intent" value="activate" />
							<Button type="submit" variant="primary">
								Aktiver
							</Button>
						</Form>
					</div>
				</VStack>
			)}
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
