import type { FileObject, FileRejected, FileRejectionReason, SortState } from "@navikt/ds-react"
import { Alert, BodyLong, Button, FileUpload, Heading, HStack, Switch, Table, Tag, VStack } from "@navikt/ds-react"
import { useState } from "react"
import type { ActionFunctionArgs } from "react-router"
import { data, Form, useActionData, useLoaderData, useNavigation, useSubmit } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getRecentAuditLog } from "~/db/queries/audit.server"
import {
	activateFrameworkVersion,
	getFrameworkVersionHistory,
	getStagingFrameworkVersion,
	stageFrameworkVersion,
} from "~/db/queries/framework.server"
import { type ParsedFrameworkRow, parseFrameworkExcel, summarizeFramework } from "~/lib/excel-parser.server"

export async function loader() {
	const [versions, auditEntries] = await Promise.all([getFrameworkVersionHistory(), getRecentAuditLog(50)])

	return data({ versions, auditEntries })
}

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

type ActionResult =
	| { success: true; summary: SerializedSummary; versionId: string }
	| { success: false; error: string }
	| { activated: true }

export async function action({ request }: ActionFunctionArgs) {
	const formData = await request.formData()
	const intent = formData.get("intent")

	if (intent === "activate") {
		try {
			const staging = await getStagingFrameworkVersion()
			if (!staging) {
				return data<ActionResult>({
					success: false,
					error: "Ingen staging-versjon funnet. Last opp en fil først.",
				})
			}
			await activateFrameworkVersion(staging.id, "Ukjent bruker")
			return data<ActionResult>({ activated: true })
		} catch (err) {
			return data<ActionResult>({
				success: false,
				error: err instanceof Error ? err.message : "Ukjent feil ved aktivering.",
			})
		}
	}

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

		// Stage in database
		const versionId = await stageFrameworkVersion(parsed, file.name, "Ukjent bruker")

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
			versionId,
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

const actionLabels: Record<string, string> = {
	framework_imported: "Kontrollrammeverk importert",
	framework_activated: "Kontrollrammeverk aktivert",
	framework_archived: "Kontrollrammeverk arkivert",
	risk_short_title_updated: "Risiko-tittel endret",
	control_short_title_updated: "Kontroll-tittel endret",
}

function formatAction(action: string): string {
	return actionLabels[action] ?? action
}

function formatDetails(entry: {
	action: string
	entityId: string
	previousValue: string | null
	newValue: string | null
}): string {
	if (entry.action === "risk_short_title_updated" || entry.action === "control_short_title_updated") {
		const prev = entry.previousValue ?? "(tom)"
		const next = entry.newValue ?? "(tom)"
		return `${entry.entityId}: «${prev}» → «${next}»`
	}
	if (entry.action === "framework_imported") {
		return entry.newValue ?? entry.entityId
	}
	if (entry.action === "framework_activated" || entry.action === "framework_archived") {
		return entry.newValue ?? entry.previousValue ?? entry.entityId
	}
	return entry.entityId
}

export default function Import() {
	const { versions, auditEntries } = useLoaderData<typeof loader>()
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

	// Column order matches the Excel file (cols 0–13)
	const allColumns = [
		{ key: "domain", label: "Domene" },
		{ key: "riskId", label: "Risiko-ID" },
		{ key: "riskDescription", label: "Risiko" },
		{ key: "controlId", label: "Kontroll-ID" },
		{ key: "technologyElement", label: "Teknologielement" },
		{ key: "requirement", label: "Krav" },
		{ key: "responsible", label: "Ansvarlig" },
		{ key: "routine", label: "Rutine" },
		{ key: "frequency", label: "Frekvens" },
		{ key: "documentationRequirement", label: "Dokumentasjonskrav" },
		{ key: "testProcedure", label: "Testprosedyre" },
		{ key: "dependencies", label: "Avhengigheter" },
		{ key: "references", label: "Referanser" },
		{ key: "commonPitfalls", label: "Vanlige fallgruver" },
	]

	const basicKeys = new Set(["domain", "riskId", "controlId", "requirement", "responsible", "frequency"])
	const visibleColumns = showAllColumns ? allColumns : allColumns.filter((c) => basicKeys.has(c.key))

	const isStaged = actionData && "success" in actionData && actionData.success
	const isActivated = actionData && "activated" in actionData && actionData.activated

	const sortedControls = isStaged
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

			{actionData && "success" in actionData && !actionData.success && (
				<Alert variant="error">{actionData.error}</Alert>
			)}

			{isActivated && (
				<Alert variant="success">Kontrollrammeverket er nå aktivert og tilgjengelig på kontrollrammeverk-siden.</Alert>
			)}

			{isStaged && (
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

			{versions.length > 0 && (
				<VStack gap="space-4">
					<Heading size="medium" level="3">
						Versjonshistorikk
					</Heading>
					{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */}
					<section className="table-scroll" tabIndex={0} aria-label="Versjonshistorikk">
						<Table size="small">
							<Table.Header>
								<Table.Row>
									<Table.HeaderCell scope="col">Filnavn</Table.HeaderCell>
									<Table.HeaderCell scope="col">Status</Table.HeaderCell>
									<Table.HeaderCell scope="col">Importert</Table.HeaderCell>
									<Table.HeaderCell scope="col">Importert av</Table.HeaderCell>
									<Table.HeaderCell scope="col">Aktivert</Table.HeaderCell>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{versions.map((v) => (
									<Table.Row key={v.id}>
										<Table.DataCell>{v.sourceFileName}</Table.DataCell>
										<Table.DataCell>
											<Tag
												variant={v.status === "active" ? "success" : v.status === "staging" ? "warning" : "neutral"}
												size="small"
											>
												{v.status === "active" ? "Aktiv" : v.status === "staging" ? "Staging" : "Arkivert"}
											</Tag>
										</Table.DataCell>
										<Table.DataCell>{new Date(v.createdAt).toLocaleString("nb-NO")}</Table.DataCell>
										<Table.DataCell>{v.createdBy}</Table.DataCell>
										<Table.DataCell>
											{v.activatedAt ? new Date(v.activatedAt).toLocaleString("nb-NO") : "–"}
										</Table.DataCell>
									</Table.Row>
								))}
							</Table.Body>
						</Table>
					</section>
				</VStack>
			)}

			{auditEntries.length > 0 && (
				<VStack gap="space-4">
					<Heading size="medium" level="3">
						Endringslogg
					</Heading>
					{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */}
					<section className="table-scroll" tabIndex={0} aria-label="Endringslogg">
						<Table size="small">
							<Table.Header>
								<Table.Row>
									<Table.HeaderCell scope="col">Tidspunkt</Table.HeaderCell>
									<Table.HeaderCell scope="col">Handling</Table.HeaderCell>
									<Table.HeaderCell scope="col">Detaljer</Table.HeaderCell>
									<Table.HeaderCell scope="col">Utført av</Table.HeaderCell>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{auditEntries.map((entry) => (
									<Table.Row key={entry.id}>
										<Table.DataCell>{new Date(entry.performedAt).toLocaleString("nb-NO")}</Table.DataCell>
										<Table.DataCell>{formatAction(entry.action)}</Table.DataCell>
										<Table.DataCell>{formatDetails(entry)}</Table.DataCell>
										<Table.DataCell>{entry.performedBy}</Table.DataCell>
									</Table.Row>
								))}
							</Table.Body>
						</Table>
					</section>
				</VStack>
			)}
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
