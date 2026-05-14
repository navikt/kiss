import { BodyLong, Heading, HGrid, Table, Tag, VStack } from "@navikt/ds-react"
import type { LoaderFunctionArgs } from "react-router"
import { data, Link, useLoaderData } from "react-router"
import { getAuditLogsForSyncJob } from "~/db/queries/audit.server"
import { getSyncJob } from "~/db/queries/sync-jobs.server"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { requireAdmin } from "~/lib/authorization.server"
import { getSyncJobStateLabel, getSyncJobStateTagVariant } from "~/lib/sync-job-state-tags"
import { formatDateTimeOslo } from "~/lib/utils"

export async function loader({ params, request }: LoaderFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	requireAdmin(authedUser)

	const jobId = params.jobId
	if (!jobId) {
		throw new Response("Missing jobId", { status: 400 })
	}

	// Validate that jobId is a valid UUID to prevent postgres errors
	const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
	if (!uuidPattern.test(jobId)) {
		throw new Response("Job not found", { status: 404 })
	}

	const job = await getSyncJob(jobId)
	if (!job) {
		throw new Response("Job not found", { status: 404 })
	}

	const auditLogs = await getAuditLogsForSyncJob(jobId, 100)

	return data({ job, auditLogs })
}

export default function JobDetailPage() {
	const { job, auditLogs } = useLoaderData<typeof loader>()

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
							Revisjonslogg ({auditLogs.length})
						</Heading>

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
											<Table.HeaderCell>Entitytype</Table.HeaderCell>
											<Table.HeaderCell>Entity-ID</Table.HeaderCell>
											<Table.HeaderCell>Utført av</Table.HeaderCell>
										</Table.Row>
									</Table.Header>
									<Table.Body>
										{auditLogs.map((log) => (
											<Table.Row key={`${log.performedAt}-${log.id}`}>
												<Table.DataCell>{formatDateTimeOslo(log.performedAt)}</Table.DataCell>
												<Table.DataCell>{log.action}</Table.DataCell>
												<Table.DataCell>{log.entityType}</Table.DataCell>
												<Table.DataCell style={{ wordBreak: "break-all" }}>
													<code style={{ fontSize: "0.875rem" }}>{log.entityId}</code>
												</Table.DataCell>
												<Table.DataCell>{log.performedBy}</Table.DataCell>
											</Table.Row>
										))}
									</Table.Body>
								</Table>
							</section>
						)}
					</VStack>
				</section>
			</VStack>
		</div>
	)
}
