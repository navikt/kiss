import { BodyLong, Button, Heading, HGrid, HStack, Select, Table, Tag, VStack } from "@navikt/ds-react"
import type { LoaderFunctionArgs } from "react-router"
import { data, Form, Link, useLoaderData } from "react-router"
import {
	getAuditLogCountForSyncJob,
	getAuditLogsForSyncJob,
	getDistinctAuditLogActionsForSyncJob,
	getDistinctAuditLogEntityTypesForSyncJob,
} from "~/db/queries/audit.server"
import { getSyncJob } from "~/db/queries/sync-jobs.server"
import { type AuditLogAction, auditLogActionEnum } from "~/db/schema/audit"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { requireAdmin } from "~/lib/authorization.server"
import { getSyncJobStateLabel, getSyncJobStateTagVariant } from "~/lib/sync-job-state-tags"
import { formatDateTimeOslo, isValidUuid, safeJsonParse } from "~/lib/utils"

export async function loader({ params, request }: LoaderFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	requireAdmin(authedUser)

	const jobId = params.jobId
	if (!jobId) {
		throw new Response("Missing jobId", { status: 400 })
	}

	if (!isValidUuid(jobId)) {
		throw new Response("Job not found", { status: 404 })
	}

	const url = new URL(request.url)
	const actionFilter = parseAuditLogAction(url.searchParams.get("action"))
	const entityTypeFilter = url.searchParams.get("entityType") || ""
	const pageSize = 25
	const requestedPage = parsePositiveInt(url.searchParams.get("page"))

	const job = await getSyncJob(jobId)
	if (!job) {
		throw new Response("Job not found", { status: 404 })
	}

	const [totalAuditLogs, availableActions, availableEntityTypes] = await Promise.all([
		getAuditLogCountForSyncJob(jobId, { action: actionFilter, entityType: entityTypeFilter || undefined }),
		getDistinctAuditLogActionsForSyncJob(jobId),
		getDistinctAuditLogEntityTypesForSyncJob(jobId),
	])
	const totalPages = totalAuditLogs > 0 ? Math.ceil(totalAuditLogs / pageSize) : 1
	const page = Math.min(requestedPage, totalPages)
	const offset = (page - 1) * pageSize
	const auditLogs = await getAuditLogsForSyncJob(jobId, {
		limit: pageSize,
		offset,
		action: actionFilter,
		entityType: entityTypeFilter || undefined,
	})
	const hasPreviousPage = page > 1
	const hasNextPage = page < totalPages

	return data({
		job,
		auditLogs,
		totalAuditLogs,
		page,
		pageSize,
		totalPages,
		hasPreviousPage,
		hasNextPage,
		availableActions,
		availableEntityTypes,
		actionFilter: actionFilter ?? "",
		entityTypeFilter,
	})
}

export default function JobDetailPage() {
	const {
		job,
		auditLogs,
		totalAuditLogs,
		page,
		pageSize,
		totalPages,
		hasPreviousPage,
		hasNextPage,
		availableActions,
		availableEntityTypes,
		actionFilter,
		entityTypeFilter,
	} = useLoaderData<typeof loader>()
	const firstItemOnPage = totalAuditLogs === 0 ? 0 : (page - 1) * pageSize + 1
	const lastItemOnPage = totalAuditLogs === 0 ? 0 : firstItemOnPage + auditLogs.length - 1

	return (
		<div style={{ padding: "var(--ax-space-16)" }}>
			<VStack gap="space-16">
				{/* Header */}
				<VStack gap="space-4">
					<div>
						<Link to="/admin/synkjobber">← Tilbake til oversikt</Link>
					</div>
					<Heading level="1" size="large">
						Synkjobb-detaljer
					</Heading>
					<BodyLong>Job ID: {job.id}</BodyLong>
				</VStack>

				{/* Job Metadata */}
				<section style={{ padding: "var(--ax-space-12)", backgroundColor: "var(--ax-bg-subtle)" }}>
					<VStack gap="space-8">
						<Heading level="2" size="medium">
							Jobbinformasjon
						</Heading>

						<HGrid columns={{ xs: 1, sm: 2, md: 3 }} gap="space-8">
							{/* Job ID */}
							<div>
								<strong style={{ display: "block", marginBottom: "var(--ax-space-2)" }}>Job ID</strong>
								<code style={{ fontSize: "0.875rem", wordBreak: "break-all" }}>{job.id}</code>
							</div>

							{/* Job Type */}
							<div>
								<strong style={{ display: "block", marginBottom: "var(--ax-space-2)" }}>Jobbtype</strong>
								<span>{job.jobType}</span>
							</div>

							{/* State */}
							<div>
								<strong style={{ display: "block", marginBottom: "var(--ax-space-2)" }}>Status</strong>
								<Tag variant={getSyncJobStateTagVariant(job.state)}>{getSyncJobStateLabel(job.state)}</Tag>
							</div>

							{/* Created */}
							<div>
								<strong style={{ display: "block", marginBottom: "var(--ax-space-2)" }}>Opprettet</strong>
								<span>{formatDateTimeOslo(job.createdAt)}</span>
							</div>

							{/* Created By */}
							<div>
								<strong style={{ display: "block", marginBottom: "var(--ax-space-2)" }}>Opprettet av</strong>
								<span>{job.createdBy}</span>
							</div>

							{/* Updated */}
							<div>
								<strong style={{ display: "block", marginBottom: "var(--ax-space-2)" }}>Sist oppdatert</strong>
								<span>{formatDateTimeOslo(job.updatedAt)}</span>
							</div>

							{/* Scope (if present) */}
							{job.scopeType && (
								<div>
									<strong style={{ display: "block", marginBottom: "var(--ax-space-2)" }}>Omfangstype</strong>
									<span>{job.scopeType}</span>
								</div>
							)}

							{job.scopeId && (
								<div>
									<strong style={{ display: "block", marginBottom: "var(--ax-space-2)" }}>Omfangs-ID</strong>
									<code style={{ fontSize: "0.875rem", wordBreak: "break-all" }}>{job.scopeId}</code>
								</div>
							)}
						</HGrid>

						{/* Message */}
						{job.message && (
							<div>
								<strong style={{ display: "block", marginBottom: "var(--ax-space-4)" }}>Melding</strong>
								<p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{job.message}</p>
							</div>
						)}

						{/* Started/Finished timestamps */}
						{job.startedAt && (
							<div>
								<strong style={{ display: "block", marginBottom: "var(--ax-space-2)" }}>Startet</strong>
								<span>{formatDateTimeOslo(job.startedAt)}</span>
							</div>
						)}

						{job.finishedAt && (
							<div>
								<strong style={{ display: "block", marginBottom: "var(--ax-space-2)" }}>Ferdig</strong>
								<span>{formatDateTimeOslo(job.finishedAt)}</span>
							</div>
						)}
					</VStack>
				</section>

				{/* Result (if completed) */}
				{job.state === "completed" && job.result && (
					<section style={{ padding: "var(--ax-space-12)", backgroundColor: "var(--ax-bg-subtle)" }}>
						<VStack gap="space-8">
							<Heading level="2" size="medium">
								Resultat
							</Heading>
							<pre
								style={{
									padding: "var(--ax-space-8)",
									backgroundColor: "var(--ax-bg-default)",
									borderRadius: "var(--ax-radius-4)",
									overflow: "auto",
									fontSize: "0.875rem",
									margin: 0,
								}}
							>
								{JSON.stringify(job.result, null, 2)}
							</pre>
						</VStack>
					</section>
				)}

				{/* Error (if failed) */}
				{job.state === "failed" && job.error && (
					<section style={{ padding: "var(--ax-space-12)", backgroundColor: "var(--ax-bg-error-subtle)" }}>
						<VStack gap="space-8">
							<Heading level="2" size="medium">
								Feil
							</Heading>
							<p style={{ margin: 0, color: "var(--ax-text-danger)", whiteSpace: "pre-wrap" }}>{job.error}</p>
						</VStack>
					</section>
				)}

				{/* Audit Logs */}
				<section style={{ padding: "var(--ax-space-12)", backgroundColor: "var(--ax-bg-subtle)" }}>
					<VStack gap="space-8">
						<Heading level="2" size="medium">
							Revisjonslogg ({auditLogs.length} av {totalAuditLogs})
						</Heading>
						<BodyLong>
							Viser {firstItemOnPage}–{lastItemOnPage} av {totalAuditLogs} revisjonslogginnslag.
						</BodyLong>

						<Form method="get">
							<HStack gap="space-4" wrap>
								<Select label="Handling" name="action" defaultValue={actionFilter}>
									<option value="">Alle handlinger</option>
									{availableActions.map((action) => (
										<option key={action} value={action}>
											{action}
										</option>
									))}
								</Select>
								<Select label="Entitytype" name="entityType" defaultValue={entityTypeFilter}>
									<option value="">Alle entitytyper</option>
									{availableEntityTypes.map((entityType) => (
										<option key={entityType} value={entityType}>
											{entityType}
										</option>
									))}
								</Select>
								<input type="hidden" name="page" value="1" />
								<HStack gap="space-2" align="end">
									<Button type="submit" size="small">
										Filtrer
									</Button>
									<Button as={Link} to={`/admin/synkjobber/${job.id}`} variant="secondary" size="small">
										Nullstill
									</Button>
								</HStack>
							</HStack>
						</Form>

						{auditLogs.length === 0 ? (
							<BodyLong>Ingen revisjonslogginnslag knyttet til denne jobben.</BodyLong>
						) : (
							// biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable table wrapper needs keyboard access
							<section className="table-scroll" tabIndex={0} aria-label="Revisjonslogg">
								<Table>
									<Table.Header>
										<Table.Row>
											<Table.HeaderCell>Tidspunkt</Table.HeaderCell>
											<Table.HeaderCell>Handling</Table.HeaderCell>
											<Table.HeaderCell>Detaljer</Table.HeaderCell>
											<Table.HeaderCell>Utført av</Table.HeaderCell>
										</Table.Row>
									</Table.Header>
									<Table.Body>
										{auditLogs.map((log) => (
											<Table.Row key={`${log.performedAt}-${log.id}`}>
												<Table.DataCell>{formatDateTimeOslo(log.performedAt)}</Table.DataCell>
												<Table.DataCell>{log.action}</Table.DataCell>
												<Table.DataCell>
													{formatAuditLogDetails(log.entityType, log.entityId, log.metadata)}
												</Table.DataCell>
												<Table.DataCell>{log.performedBy}</Table.DataCell>
											</Table.Row>
										))}
									</Table.Body>
								</Table>
							</section>
						)}
						<HStack gap="space-4" align="center" justify="space-between">
							<BodyLong>
								Side {page} av {totalPages}
							</BodyLong>
							<HStack gap="space-2">
								{hasPreviousPage ? (
									<Button
										as={Link}
										to={buildAuditLogPageLink(job.id, actionFilter, entityTypeFilter, page - 1)}
										variant="secondary"
										size="small"
									>
										Forrige
									</Button>
								) : (
									<Button variant="secondary" size="small" disabled>
										Forrige
									</Button>
								)}
								{hasNextPage ? (
									<Button
										as={Link}
										to={buildAuditLogPageLink(job.id, actionFilter, entityTypeFilter, page + 1)}
										variant="secondary"
										size="small"
									>
										Neste
									</Button>
								) : (
									<Button variant="secondary" size="small" disabled>
										Neste
									</Button>
								)}
							</HStack>
						</HStack>
					</VStack>
				</section>
			</VStack>
		</div>
	)
}

function formatAuditLogDetails(entityType: string, entityId: string, metadata: string | null): string {
	const details = [`${entityType}: ${entityId}`]
	if (!metadata) {
		return details[0]
	}

	const parsed = safeJsonParse(metadata)
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return details[0]
	}

	const metadataEntries = Object.entries(parsed as Record<string, unknown>).filter(([key]) => key !== "syncJobId")
	const visibleMetadataEntries = metadataEntries.slice(0, 2)

	if (visibleMetadataEntries.length > 0) {
		const metadataString = visibleMetadataEntries
			.map(([key, value]) => `${key}=${formatMetadataValue(value)}`)
			.join(", ")
		const suffix = metadataEntries.length > visibleMetadataEntries.length ? " …" : ""
		details.push(`${metadataString}${suffix}`)
	}

	return details.join(" — ")
}

function formatMetadataValue(value: unknown): string {
	if (value === null || value === undefined) {
		return String(value)
	}
	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
		return String(value)
	}
	try {
		return JSON.stringify(value)
	} catch {
		return "[ukjent]"
	}
}

function parseAuditLogAction(value: string | null): AuditLogAction | undefined {
	if (!value) {
		return undefined
	}
	return (auditLogActionEnum as readonly string[]).includes(value) ? (value as AuditLogAction) : undefined
}

function parsePositiveInt(value: string | null): number {
	const parsed = Number(value)
	if (!Number.isInteger(parsed) || parsed < 1) {
		return 1
	}
	return parsed
}

function buildAuditLogPageLink(jobId: string, actionFilter: string, entityTypeFilter: string, page: number): string {
	const query = new URLSearchParams()
	if (actionFilter) {
		query.set("action", actionFilter)
	}
	if (entityTypeFilter) {
		query.set("entityType", entityTypeFilter)
	}
	query.set("page", String(page))
	return `/admin/synkjobber/${jobId}?${query.toString()}`
}
