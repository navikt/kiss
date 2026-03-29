import type { FileObject } from "@navikt/ds-react"
import { Alert, BodyLong, Button, FileUpload, Heading, Table, VStack } from "@navikt/ds-react"
import { useState } from "react"
import type { ActionFunctionArgs } from "react-router"
import { data, Form, useActionData, useNavigation, useSubmit } from "react-router"
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
	const navigation = useNavigation()
	const submit = useSubmit()
	const [selectedFile, setSelectedFile] = useState<File | null>(null)
	const [fileError, setFileError] = useState<string | undefined>(undefined)

	const isSubmitting = navigation.state === "submitting"

	function handleSelect(files: FileObject[]) {
		setFileError(undefined)

		const rejected = files.filter((f): f is Extract<FileObject, { error: true }> => f.error)
		const accepted = files.filter((f): f is Extract<FileObject, { error: false }> => !f.error)

		if (rejected.length > 0) {
			setFileError(rejected[0].reasons.join(", "))
			setSelectedFile(null)
			return
		}

		if (accepted.length > 0) {
			setSelectedFile(accepted[0].file)
		}
	}

	function handleRemoveFile() {
		setSelectedFile(null)
		setFileError(undefined)
	}

	function handleUpload() {
		if (!selectedFile) return
		const formData = new FormData()
		formData.append("file", selectedFile)
		submit(formData, { method: "post", encType: "multipart/form-data" })
	}

	return (
		<VStack gap="space-6">
			<Heading size="xlarge" level="2">
				Importer kontrollrammeverk
			</Heading>
			<BodyLong>
				Dra og slipp en Excel-fil (.xlsx) i feltet nedenfor, eller klikk for å velge fil fra filsystemet.
			</BodyLong>

			<FileUpload.Dropzone
				label="Last opp Excel-fil (.xlsx)"
				description="Maks én fil. Kun .xlsx-format støttes."
				accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
				multiple={false}
				onSelect={handleSelect}
				error={fileError}
				fileLimit={{ max: 1, current: selectedFile ? 1 : 0 }}
			/>

			{selectedFile && (
				<VStack gap="space-4">
					<FileUpload.Item
						file={selectedFile}
						button={{
							action: "delete",
							onClick: handleRemoveFile,
						}}
						status={isSubmitting ? "uploading" : "idle"}
					/>
					<div>
						<Button type="button" variant="primary" onClick={handleUpload} loading={isSubmitting}>
							Last opp og valider
						</Button>
					</div>
				</VStack>
			)}

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
						{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */}
						<section className="table-scroll" tabIndex={0} aria-label="Kontroller forhåndsvisning">
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
						</section>
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
