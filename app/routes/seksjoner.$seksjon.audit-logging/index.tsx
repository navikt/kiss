import {
	BodyShort,
	Box,
	Button,
	DatePicker,
	Heading,
	HGrid,
	HStack,
	Modal,
	ReadMore,
	Search,
	Table,
	Tag,
	Textarea,
	TextField,
	ToggleGroup,
	VStack,
} from "@navikt/ds-react"
import { useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, Link, redirect, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import {
	type AuditLoggingStatus,
	type AuditOverviewRow,
	createAuditConfirmation,
	getAuditConfirmationLog,
	getSectionAuditOverview,
	revokeAuditConfirmation,
	updateAuditConfirmation,
} from "~/db/queries/audit-logging.server"
import { getSectionBySlug } from "~/db/queries/sections.server"
import { getAuthenticatedUser } from "~/lib/auth.server"
import { canManageSection } from "~/lib/authorization.server"

// ─── Status config ──────────────────────────────────────────────────────────

const statusConfig: Record<
	AuditLoggingStatus,
	{ label: string; variant: "success" | "warning" | "error" | "neutral" | "info" }
> = {
	active: { label: "Aktiv", variant: "success" },
	partial: { label: "Delvis", variant: "warning" },
	inactive: { label: "Av", variant: "error" },
	unknown: { label: "Ukjent", variant: "neutral" },
	confirmed: { label: "Bekreftet", variant: "info" },
}

const persistenceTypeLabels: Record<string, string> = {
	cloud_sql_postgres: "Cloud SQL PostgreSQL",
	nais_postgres: "Nais PostgreSQL",
	on_prem_postgres: "On-prem PostgreSQL",
	oracle: "Oracle",
	opensearch: "OpenSearch",
}

const STALENESS_THRESHOLD_MS = 2 * 60 * 60 * 1000 // 2 hours

// ─── Loader ─────────────────────────────────────────────────────────────────

export async function loader({ request, params }: LoaderFunctionArgs) {
	const { seksjon } = params
	if (!seksjon) throw data({ message: "Mangler seksjonsparameter" }, { status: 400 })

	const user = await getAuthenticatedUser(request)

	const section = await getSectionBySlug(seksjon)
	if (!section) throw data({ message: `Fant ikke seksjon: ${seksjon}` }, { status: 404 })

	const [overview, auditLog] = await Promise.all([
		getSectionAuditOverview(seksjon),
		getAuditConfirmationLog(seksjon, 20),
	])

	const stats = {
		total: overview.length,
		active: overview.filter((r) => r.status === "active").length,
		partial: overview.filter((r) => r.status === "partial").length,
		inactive: overview.filter((r) => r.status === "inactive").length,
		unknown: overview.filter((r) => r.status === "unknown").length,
		confirmed: overview.filter((r) => r.status === "confirmed").length,
	}

	return data({
		section,
		seksjon,
		overview,
		stats,
		auditLog,
		canManage: user ? canManageSection(user, section.id) : false,
	})
}

// ─── Action ─────────────────────────────────────────────────────────────────

export async function action({ request, params }: ActionFunctionArgs) {
	const { seksjon } = params
	if (!seksjon) throw data({ message: "Mangler seksjonsparameter" }, { status: 400 })

	const user = await getAuthenticatedUser(request)
	if (!user) throw new Response("Ikke autentisert", { status: 401 })

	const section = await getSectionBySlug(seksjon)
	if (!section) throw data({ message: `Fant ikke seksjon: ${seksjon}` }, { status: 404 })

	if (!canManageSection(user, section.id)) {
		throw new Response("Ikke autorisert", { status: 403 })
	}

	// Load section overview to validate ownership of persistence/confirmation IDs
	const overview = await getSectionAuditOverview(seksjon)
	const sectionPersistenceIds = new Set(overview.map((r) => r.persistenceId))
	const sectionConfirmationIds = new Set(overview.filter((r) => r.confirmation).map((r) => r.confirmation?.id))

	const formData = await request.formData()
	const intent = formData.get("intent") as string

	if (intent === "confirmAuditLogging") {
		const persistenceId = formData.get("persistenceId") as string
		const enabledAt = formData.get("enabledAt") as string
		const description = (formData.get("description") as string)?.trim()
		const evidenceUrl = (formData.get("evidenceUrl") as string)?.trim()

		// Validering
		if (!persistenceId) throw data({ message: "Mangler persistenceId" }, { status: 400 })
		if (!sectionPersistenceIds.has(persistenceId)) {
			throw data({ message: "Databasen tilhører ikke denne seksjonen" }, { status: 403 })
		}
		if (!enabledAt) throw data({ message: "Dato for aktivering er påkrevd" }, { status: 400 })
		const parsedDate = new Date(enabledAt)
		if (Number.isNaN(parsedDate.getTime())) {
			throw data({ message: "Ugyldig datoformat" }, { status: 400 })
		}
		if (parsedDate > new Date()) throw data({ message: "Dato kan ikke være i fremtiden" }, { status: 400 })
		if (!description || description.length < 10) {
			throw data({ message: "Beskrivelse må være minst 10 tegn" }, { status: 400 })
		}
		if (!evidenceUrl?.startsWith("https://")) {
			throw data({ message: "Lenke må starte med https://" }, { status: 400 })
		}

		const existingConfirmationId = formData.get("confirmationId") as string | null

		if (existingConfirmationId) {
			if (!sectionConfirmationIds.has(existingConfirmationId)) {
				throw data({ message: "Bekreftelsen tilhører ikke denne seksjonen" }, { status: 403 })
			}
			await updateAuditConfirmation({
				confirmationId: existingConfirmationId,
				enabledAt,
				description,
				evidenceUrl,
				performedBy: user.navIdent,
				metadata: { sectionSlug: seksjon },
			})
		} else {
			await createAuditConfirmation({
				persistenceId,
				enabledAt,
				description,
				evidenceUrl,
				performedBy: user.navIdent,
				metadata: { sectionSlug: seksjon },
			})
		}
	} else if (intent === "revokeAuditLogging") {
		const confirmationId = formData.get("confirmationId") as string
		if (!confirmationId) throw data({ message: "Mangler confirmationId" }, { status: 400 })
		if (!sectionConfirmationIds.has(confirmationId)) {
			throw data({ message: "Bekreftelsen tilhører ikke denne seksjonen" }, { status: 403 })
		}

		await revokeAuditConfirmation({
			confirmationId,
			performedBy: user.navIdent,
			metadata: { sectionSlug: seksjon },
		})
	}

	return redirect(`/seksjoner/${seksjon}/audit-logging`)
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function SeksjonAuditLogging() {
	const { section, overview, stats, auditLog, canManage } = useLoaderData<typeof loader>()
	const [filter, setFilter] = useState<string>("alle")
	const [confirmingId, setConfirmingId] = useState<string | null>(null)
	const [revokingId, setRevokingId] = useState<string | null>(null)
	const [searchQuery, setSearchQuery] = useState("")
	const [sort, setSort] = useState<{ orderBy: string; direction: "ascending" | "descending" } | undefined>()

	const handleSort = (sortKey: string) =>
		setSort((prev) =>
			prev?.orderBy === sortKey && prev.direction === "ascending"
				? { orderBy: sortKey, direction: "descending" }
				: { orderBy: sortKey, direction: "ascending" },
		)

	const filteredOverview = sortRows(
		overview.filter((row) => {
			if (filter === "ikke-aktiv" && (row.status === "active" || row.status === "confirmed")) return false
			if (filter !== "alle" && filter !== "ikke-aktiv" && row.status !== filter) return false
			if (searchQuery) {
				const q = searchQuery.toLowerCase()
				return (
					row.appName.toLowerCase().includes(q) ||
					row.persistenceName.toLowerCase().includes(q) ||
					(row.teamName?.toLowerCase().includes(q) ?? false) ||
					(persistenceTypeLabels[row.persistenceType] ?? row.persistenceType).toLowerCase().includes(q)
				)
			}
			return true
		}),
		sort,
	)

	const confirmingRow = overview.find((r) => r.persistenceId === confirmingId)
	const revokingRow = overview.find((r) => r.confirmation?.id === revokingId)

	return (
		<VStack gap="space-8">
			<Heading size="large">Audit logging — {section.name}</Heading>

			{/* Statistikk-kort */}
			<HGrid gap="space-4" columns={{ xs: 2, sm: 3, md: 6 }}>
				<StatCard label="Totalt" value={stats.total} />
				<StatCard label="Aktiv" value={stats.active} variant="success" />
				<StatCard label="Delvis" value={stats.partial} variant="warning" />
				<StatCard label="Av" value={stats.inactive} variant="error" />
				<StatCard label="Ukjent" value={stats.unknown} variant="neutral" />
				<StatCard label="Bekreftet" value={stats.confirmed} variant="info" />
			</HGrid>

			{/* Filter */}
			<ToggleGroup value={filter} onChange={setFilter} size="small">
				<ToggleGroup.Item value="alle">Alle ({stats.total})</ToggleGroup.Item>
				<ToggleGroup.Item value="ikke-aktiv">
					Ikke aktiv ({stats.inactive + stats.unknown + stats.partial})
				</ToggleGroup.Item>
				<ToggleGroup.Item value="active">Aktiv ({stats.active})</ToggleGroup.Item>
				<ToggleGroup.Item value="confirmed">Bekreftet ({stats.confirmed})</ToggleGroup.Item>
				<ToggleGroup.Item value="unknown">Ukjent ({stats.unknown})</ToggleGroup.Item>
			</ToggleGroup>

			{/* Søk */}
			<Search
				label="Søk i tabellen"
				variant="simple"
				size="small"
				value={searchQuery}
				onChange={setSearchQuery}
				onClear={() => setSearchQuery("")}
				placeholder="Filtrer på applikasjon, team, type eller databasenavn"
			/>

			{/* Hovedtabell */}
			{filteredOverview.length === 0 ? (
				<Box padding="space-6" borderRadius="8" background="sunken">
					<BodyShort>
						{searchQuery
							? `Ingen treff for «${searchQuery}» med valgt filter.`
							: "Ingen databaser matcher valgt filter."}
					</BodyShort>
				</Box>
			) : (
				// biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable table container needs keyboard focus
				<section className="table-scroll" tabIndex={0} aria-label="Audit logging-oversikt">
					<Table sort={sort} onSortChange={handleSort}>
						<Table.Header>
							<Table.Row>
								<Table.ColumnHeader sortKey="appName" sortable scope="col">
									Applikasjon
								</Table.ColumnHeader>
								<Table.ColumnHeader sortKey="teamName" sortable scope="col">
									Team
								</Table.ColumnHeader>
								<Table.ColumnHeader sortKey="persistenceType" sortable scope="col">
									Databasetype
								</Table.ColumnHeader>
								<Table.ColumnHeader sortKey="persistenceName" sortable scope="col">
									Databasenavn
								</Table.ColumnHeader>
								<Table.ColumnHeader sortKey="status" sortable scope="col">
									Audit logging
								</Table.ColumnHeader>
								<Table.HeaderCell scope="col">Handling</Table.HeaderCell>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{filteredOverview.map((row) => (
								<AuditRow
									key={row.persistenceId}
									row={row}
									canManage={canManage}
									onConfirm={() => setConfirmingId(row.persistenceId)}
									onRevoke={() => row.confirmation && setRevokingId(row.confirmation.id)}
								/>
							))}
						</Table.Body>
					</Table>
				</section>
			)}
			{/* Endringslogg */}
			{auditLog.length > 0 && (
				<ReadMore header="Endringslogg for bekreftelser" defaultOpen={false}>
					{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable table container needs keyboard focus */}
					<section className="table-scroll" tabIndex={0} aria-label="Endringslogg">
						<Table size="small">
							<Table.Header>
								<Table.Row>
									<Table.HeaderCell>Tidspunkt</Table.HeaderCell>
									<Table.HeaderCell>Handling</Table.HeaderCell>
									<Table.HeaderCell>Detaljer</Table.HeaderCell>
									<Table.HeaderCell>Utført av</Table.HeaderCell>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{auditLog.map((entry) => (
									<Table.Row key={entry.id}>
										<Table.DataCell>{new Date(entry.performedAt).toLocaleString("nb-NO")}</Table.DataCell>
										<Table.DataCell>{formatAction(entry.action)}</Table.DataCell>
										<Table.DataCell>
											<BodyShort size="small" truncate>
												{formatAuditDetails(entry)}
											</BodyShort>
										</Table.DataCell>
										<Table.DataCell>{entry.performedBy}</Table.DataCell>
									</Table.Row>
								))}
							</Table.Body>
						</Table>
					</section>
				</ReadMore>
			)}

			{/* Bekreftelse-modal */}
			<Modal
				open={confirmingId !== null}
				onClose={() => setConfirmingId(null)}
				header={{
					heading: confirmingRow?.confirmation ? "Oppdater bekreftelse" : "Bekreft audit logging",
				}}
			>
				<Modal.Body>
					{confirmingRow && (
						<Form method="post" id="confirm-form">
							<VStack gap="space-4">
								<input type="hidden" name="intent" value="confirmAuditLogging" />
								<input type="hidden" name="persistenceId" value={confirmingRow.persistenceId} />
								{confirmingRow.confirmation && (
									<input type="hidden" name="confirmationId" value={confirmingRow.confirmation.id} />
								)}
								<BodyShort>
									{persistenceTypeLabels[confirmingRow.persistenceType] ?? confirmingRow.persistenceType}:{" "}
									<strong>{confirmingRow.persistenceName}</strong> ({confirmingRow.appName})
								</BodyShort>
								<DatePicker>
									<DatePicker.Input
										label="Dato for aktivering av audit logging"
										name="enabledAt"
										defaultValue={confirmingRow.confirmation?.enabledAt ?? ""}
									/>
								</DatePicker>
								<Textarea
									label="Beskrivelse"
									name="description"
									description="Beskriv hvordan audit logging er konfigurert (min. 10 tegn)"
									defaultValue={confirmingRow.confirmation?.description ?? ""}
									minRows={3}
								/>
								<TextField
									label="Lenke til bekreftelse"
									name="evidenceUrl"
									description="URL til dokumentasjon eller bevis (må starte med https://)"
									defaultValue={confirmingRow.confirmation?.evidenceUrl ?? ""}
									type="url"
								/>
							</VStack>
						</Form>
					)}
				</Modal.Body>
				<Modal.Footer>
					<Button type="submit" form="confirm-form" variant="primary">
						{confirmingRow?.confirmation ? "Oppdater" : "Bekreft"}
					</Button>
					<Button variant="secondary" onClick={() => setConfirmingId(null)}>
						Avbryt
					</Button>
				</Modal.Footer>
			</Modal>

			{/* Tilbakekall-modal */}
			<Modal
				open={revokingId !== null}
				onClose={() => setRevokingId(null)}
				header={{ heading: "Tilbakekall bekreftelse" }}
			>
				<Modal.Body>
					{revokingRow && (
						<VStack gap="space-2">
							<BodyShort>
								Er du sikker på at du vil tilbakekalle bekreftelsen for <strong>{revokingRow.persistenceName}</strong> (
								{revokingRow.appName})?
							</BodyShort>
							<BodyShort size="small">
								Bekreftet av {revokingRow.confirmation?.confirmedBy},{" "}
								{revokingRow.confirmation?.confirmedAt
									? new Date(revokingRow.confirmation.confirmedAt).toLocaleDateString("nb-NO")
									: ""}
							</BodyShort>
						</VStack>
					)}
				</Modal.Body>
				<Modal.Footer>
					<Form method="post">
						<input type="hidden" name="intent" value="revokeAuditLogging" />
						<input type="hidden" name="confirmationId" value={revokingId ?? ""} />
						<Button type="submit" variant="danger">
							Tilbakekall
						</Button>
					</Form>
					<Button variant="secondary" onClick={() => setRevokingId(null)}>
						Avbryt
					</Button>
				</Modal.Footer>
			</Modal>
		</VStack>
	)
}

// ─── Sub-components ─────────────────────────────────────────────────────────

const statusSortOrder: Record<string, number> = {
	inactive: 0,
	unknown: 1,
	partial: 2,
	confirmed: 3,
	active: 4,
}

function sortRows(
	rows: AuditOverviewRow[],
	sort: { orderBy: string; direction: "ascending" | "descending" } | undefined,
): AuditOverviewRow[] {
	if (!sort) return rows
	return [...rows].sort((a, b) => {
		const dir = sort.direction === "ascending" ? 1 : -1
		switch (sort.orderBy) {
			case "appName":
				return dir * a.appName.localeCompare(b.appName, "nb")
			case "teamName":
				return dir * (a.teamName ?? "").localeCompare(b.teamName ?? "", "nb")
			case "persistenceType":
				return (
					dir *
					(persistenceTypeLabels[a.persistenceType] ?? a.persistenceType).localeCompare(
						persistenceTypeLabels[b.persistenceType] ?? b.persistenceType,
						"nb",
					)
				)
			case "persistenceName":
				return dir * a.persistenceName.localeCompare(b.persistenceName, "nb")
			case "status":
				return dir * ((statusSortOrder[a.status] ?? 99) - (statusSortOrder[b.status] ?? 99))
			default:
				return 0
		}
	})
}

function StatCard({
	label,
	value,
	variant,
}: {
	label: string
	value: number
	variant?: "success" | "warning" | "error" | "neutral" | "info"
}) {
	return (
		<Box padding="space-4" borderRadius="8" background="sunken">
			<VStack align="center">
				<BodyShort size="small">{label}</BodyShort>
				<Heading size="xlarge" level="3">
					{variant ? (
						<Tag variant={variant} size="medium">
							{value}
						</Tag>
					) : (
						value
					)}
				</Heading>
			</VStack>
		</Box>
	)
}

function AuditRow({
	row,
	canManage,
	onConfirm,
	onRevoke,
}: {
	row: AuditOverviewRow
	canManage: boolean
	onConfirm: () => void
	onRevoke: () => void
}) {
	const config = statusConfig[row.status]
	const isStale =
		row.summary?.fetchedAt && Date.now() - new Date(row.summary.fetchedAt).getTime() > STALENESS_THRESHOLD_MS

	return (
		<Table.Row>
			<Table.DataCell>
				<Link to={`/applikasjoner/${row.appId}/detaljer`}>{row.appName}</Link>
			</Table.DataCell>
			<Table.DataCell>{row.teamName ?? "–"}</Table.DataCell>
			<Table.DataCell>{persistenceTypeLabels[row.persistenceType] ?? row.persistenceType}</Table.DataCell>
			<Table.DataCell>{row.persistenceName}</Table.DataCell>
			<Table.DataCell>
				<HStack gap="space-2" align="center">
					<Tag variant={config.variant} size="small">
						{config.label}
					</Tag>
					{isStale && (
						<Tag variant="neutral" size="xsmall">
							⚠️ Foreldet
						</Tag>
					)}
				</HStack>
				{row.confirmation && (
					<BodyShort size="small">
						Bekreftet {new Date(row.confirmation.confirmedAt).toLocaleDateString("nb-NO")} av{" "}
						{row.confirmation.confirmedBy}
					</BodyShort>
				)}
			</Table.DataCell>
			<Table.DataCell>
				{canManage && row.status === "unknown" && !row.confirmation && (
					<Button variant="tertiary" size="xsmall" onClick={onConfirm}>
						Bekreft
					</Button>
				)}
				{canManage && row.confirmation && (
					<HStack gap="space-1">
						<Button variant="tertiary" size="xsmall" onClick={onConfirm}>
							Rediger
						</Button>
						<Button variant="tertiary-neutral" size="xsmall" onClick={onRevoke}>
							Tilbakekall
						</Button>
					</HStack>
				)}
			</Table.DataCell>
		</Table.Row>
	)
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatAction(action: string): string {
	switch (action) {
		case "audit_confirmation_created":
			return "Opprettet"
		case "audit_confirmation_updated":
			return "Oppdatert"
		case "audit_confirmation_revoked":
			return "Tilbakekalt"
		default:
			return action
	}
}

function formatAuditDetails(entry: { newValue?: string | null; previousValue?: string | null }): string {
	try {
		const val = entry.newValue ?? entry.previousValue
		if (!val) return "–"
		const parsed = JSON.parse(val)
		return parsed.description ?? parsed.evidenceUrl ?? "–"
	} catch {
		return "–"
	}
}

export { RouteErrorBoundary as ErrorBoundary }
