import type { FileObject, FileRejected, FileRejectionReason, SortState } from "@navikt/ds-react"
import { Alert, BodyLong, Button, FileUpload, Heading, HStack, Switch, Table, VStack } from "@navikt/ds-react"
import { useState } from "react"
import type { ActionFunctionArgs } from "react-router"
import { data, Form, useActionData, useNavigation, useSubmit } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { type ParsedFrameworkRow, parseFrameworkExcel, summarizeFramework } from "~/lib/excel-parser.server"

interface SerializedControl {
	controlId: string
	domain: string
	riskId: string
	riskDescription: string | null
	technologyElement: string | null
	requirement: string | null
	responsible: string | null
	routine: string | null
	frequency: string | null
	documentationRequirement: string | null
	testProcedure: string | null
	dependencies: string | null
	references: string | null
	commonPitfalls: string | null
}

interface SerializedSummary {
	domainCount: number
	riskCount: number
	controlCount: number
	fileName: string
	uploadedAt: string
	uploadedBy: string
	controls: SerializedControl[]
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

		const controls: SerializedControl[] = Array.from(summary.controls.values()).map((row: ParsedFrameworkRow) => ({
			controlId: row.controlId,
			domain: row.domain,
			riskId: row.riskId,
			riskDescription: row.riskDescription,
			technologyElement: row.technologyElement,
			requirement: row.requirement,
			responsible: row.responsible,
			routine: row.routine,
			frequency: row.frequency,
			documentationRequirement: row.documentationRequirement,
			testProcedure: row.testProcedure,
			dependencies: row.dependencies,
			references: row.references,
			commonPitfalls: row.commonPitfalls,
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

const MAX_SIZE_MB = 10
const MAX_SIZE = MAX_SIZE_MB * 1024 * 1024

const rejectionErrors: Record<FileRejectionReason, string> = {
	fileType: "Filformatet støttes ikke. Last opp en .xlsx-fil.",
	fileSize: `Filen er større enn ${MAX_SIZE_MB} MB.`,
}

export default function Import() {
	const actionData = useActionData<typeof action>()
	const navigation = useNavigation()
	const submit = useSubmit()
	const [files, setFiles] = useState<FileObject[]>([])
	const [showAllColumns, setShowAllColumns] = useState(false)
	const [sort, setSort] = useState<SortState | undefined>(undefined)
	const isSubmitting = navigation.state === "submitting"

	const acceptedFiles = files.filter((f): f is Extract<FileObject, { error: false }> => !f.error)
	const rejectedFiles = files.filter((f): f is FileRejected => f.error)
	const selectedFile = acceptedFiles.length > 0 ? acceptedFiles[0].file : null

	function handleUpload() {
		if (!selectedFile) return
		const formData = new FormData()
		formData.append("file", selectedFile)
		submit(formData, { method: "post", encType: "multipart/form-data" })
	}

	const baseColumns = [
		{ key: "controlId", label: "Kontroll-ID" },
		{ key: "domain", label: "Domene" },
		{ key: "riskId", label: "Risiko-ID" },
		{ key: "requirement", label: "Krav" },
		{ key: "responsible", label: "Ansvarlig" },
		{ key: "frequency", label: "Frekvens" },
	]

	const extraColumns = [
		{ key: "riskDescription", label: "Risiko" },
		{ key: "technologyElement", label: "Teknologielement" },
		{ key: "routine", label: "Rutine" },
		{ key: "documentationRequirement", label: "Dokumentasjonskrav" },
		{ key: "testProcedure", label: "Testprosedyre" },
		{ key: "dependencies", label: "Avhengigheter" },
		{ key: "references", label: "Referanser" },
		{ key: "commonPitfalls", label: "Vanlige fallgruver" },
	]

	const visibleColumns = showAllColumns ? [...baseColumns, ...extraColumns] : baseColumns

	const sortedControls = actionData?.success
		? [...actionData.summary.controls].sort((a, b) => {
				if (!sort) return 0
				const aVal = a[sort.orderBy as keyof SerializedControl] ?? ""
				const bVal = b[sort.orderBy as keyof SerializedControl] ?? ""
				const cmp = String(aVal).localeCompare(String(bVal), "nb")
				return sort.direction === "descending" ? -cmp : cmp
			})
		: []

	return (
		<VStack gap="space-6">
			<Heading size="xlarge" level="2">
				Importer kontrollrammeverk
			</Heading>
			<BodyLong>
				Dra og slipp en Excel-fil (.xlsx) i feltet nedenfor, eller klikk for å velge fil fra filsystemet.
			</BodyLong>

			<FileUpload.Dropzone
				label="Last opp kontrollrammeverk"
				description={`Du kan laste opp filer i xlsx-format. Maks størrelse ${MAX_SIZE_MB} MB.`}
				accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
				maxSizeInBytes={MAX_SIZE}
				multiple={false}
				onSelect={setFiles}
				fileLimit={{ max: 1, current: acceptedFiles.length }}
			/>

			{acceptedFiles.length > 0 && (
				<VStack gap="space-8">
					<VStack as="ul" gap="space-12">
						{acceptedFiles.map((file) => (
							<FileUpload.Item
								as="li"
								key={file.file.name}
								file={file.file}
								button={{
									action: "delete",
									onClick: () => setFiles([]),
								}}
								status={isSubmitting ? "uploading" : "idle"}
							/>
						))}
					</VStack>
					<div>
						<Button type="button" variant="primary" onClick={handleUpload} loading={isSubmitting}>
							Last opp og valider
						</Button>
					</div>
				</VStack>
			)}

			{rejectedFiles.length > 0 && (
				<VStack gap="space-8">
					<Heading level="3" size="xsmall">
						Filer med feil
					</Heading>
					<VStack as="ul" gap="space-12">
						{rejectedFiles.map((rejected) => (
							<FileUpload.Item
								as="li"
								key={rejected.file.name}
								file={rejected.file}
								error={
									rejected.reasons[0] in rejectionErrors
										? rejectionErrors[rejected.reasons[0] as FileRejectionReason]
										: rejected.reasons.join(", ")
								}
								button={{
									action: "delete",
									onClick: () => setFiles(files.filter((f) => f !== rejected)),
								}}
							/>
						))}
					</VStack>
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
						<HStack gap="space-6" align="center" justify="space-between">
							<Heading size="medium" level="3">
								Kontroller (forhåndsvisning)
							</Heading>
							<Switch size="small" checked={showAllColumns} onChange={() => setShowAllColumns((v) => !v)}>
								Vis alle kolonner
							</Switch>
						</HStack>
						{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */}
						<section className="table-scroll" tabIndex={0} aria-label="Kontroller forhåndsvisning">
							<Table
								size="small"
								sort={sort}
								onSortChange={(sortKey) =>
									setSort((prev) =>
										prev?.orderBy === sortKey && prev.direction === "ascending"
											? { orderBy: sortKey, direction: "descending" }
											: { orderBy: sortKey, direction: "ascending" },
									)
								}
							>
								<Table.Header>
									<Table.Row>
										{visibleColumns.map((col) => (
											<Table.ColumnHeader key={col.key} sortKey={col.key} sortable>
												{col.label}
											</Table.ColumnHeader>
										))}
									</Table.Row>
								</Table.Header>
								<Table.Body>
									{sortedControls.map((control) => (
										<Table.Row key={control.controlId}>
											{visibleColumns.map((col) => (
												<Table.DataCell key={col.key}>
													{control[col.key as keyof SerializedControl] ?? "–"}
												</Table.DataCell>
											))}
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
