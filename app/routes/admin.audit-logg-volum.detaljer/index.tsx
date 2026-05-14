import { BodyLong, Button, CopyButton, Heading, Select, Table, Tag, VStack } from "@navikt/ds-react"
import { sql } from "drizzle-orm"
import { useState } from "react"
import type { LoaderFunctionArgs } from "react-router"
import { data, Link, useLoaderData, useNavigate } from "react-router"
import { db } from "~/db/connection.server"
import { normalizePeriod, periodToInterval } from "~/lib/audit-log-periods"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { requireAdmin } from "~/lib/authorization.server"

interface AuditLogEntry {
	id: string
	action: string
	entityType: string
	entityId: string
	previousValue: string | null
	newValue: string | null
	metadata: string | null
	performedBy: string
	performedAt: string
}

interface LoaderData {
	entries: AuditLogEntry[]
	action: string
	period: string
	totalCount: number
}

export async function loader({ request }: LoaderFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	requireAdmin(authedUser)

	const url = new URL(request.url)
	const action = url.searchParams.get("action")
	if (!action) throw data({ message: "Mangler action-parameter" }, { status: 400 })

	const rawPeriod = url.searchParams.get("period") ?? "6h"
	const period = normalizePeriod(rawPeriod)
	const interval = periodToInterval(period)

	const countRows = await db.execute<{ count: string }>(
		sql`SELECT COUNT(*)::text AS count
			FROM audit_log
			WHERE action = ${action}
				AND performed_at > NOW() - ${interval}::interval`,
	)
	const totalCount = Number(countRows.rows[0].count)

	const rows = await db.execute<{
		id: string
		action: string
		entity_type: string
		entity_id: string
		previous_value: string | null
		new_value: string | null
		metadata: string | null
		performed_by: string
		performed_at_display: string
	}>(
		sql`SELECT id, action, entity_type, entity_id,
				   previous_value, new_value, metadata,
				   performed_by,
				   to_char(performed_at AT TIME ZONE 'Europe/Oslo', 'YYYY-MM-DD HH24:MI:SS') AS performed_at_display
			FROM audit_log
			WHERE action = ${action}
				AND performed_at > NOW() - ${interval}::interval
			ORDER BY audit_log.performed_at DESC
			LIMIT 100`,
	)

	const entries: AuditLogEntry[] = rows.rows.map((r) => ({
		id: r.id,
		action: r.action,
		entityType: r.entity_type,
		entityId: r.entity_id,
		previousValue: r.previous_value,
		newValue: r.new_value,
		metadata: r.metadata,
		performedBy: r.performed_by,
		performedAt: r.performed_at_display,
	}))

	return data({ entries, action, period, totalCount })
}

function truncate(value: string | null, maxLength = 80): string {
	if (!value) return "–"
	if (value.length <= maxLength) return value
	return `${value.slice(0, maxLength)}…`
}

function formatJson(value: string | null): string {
	if (!value) return "–"
	try {
		return JSON.stringify(JSON.parse(value), null, 2)
	} catch {
		return value
	}
}

export { RouteErrorBoundary as ErrorBoundary } from "~/components/RouteErrorBoundary"

export default function AuditLoggDetaljer() {
	const { entries, action, period, totalCount } = useLoaderData<LoaderData>()
	const navigate = useNavigate()

	return (
		<VStack gap="space-8">
			<VStack gap="space-2">
				<Button
					as={Link}
					to={`/admin/audit-logg-volum?period=${period}`}
					variant="tertiary"
					size="small"
					style={{ alignSelf: "flex-start" }}
				>
					← Tilbake til volum-oversikt
				</Button>
				<Heading size="xlarge" level="2">
					<code>{action}</code>
				</Heading>
				<BodyLong>
					Viser de siste {Math.min(entries.length, 100)} av {totalCount.toLocaleString("nb-NO")} oppføringer i perioden.
				</BodyLong>
			</VStack>

			<Select
				label="Tidsperiode"
				value={period}
				onChange={(e) => {
					navigate(`/admin/audit-logg-volum/detaljer?action=${encodeURIComponent(action)}&period=${e.target.value}`)
				}}
				style={{ maxWidth: "16rem" }}
			>
				<option value="1h">Siste time</option>
				<option value="6h">Siste 6 timer</option>
				<option value="24h">Siste 24 timer</option>
				<option value="7d">Siste 7 dager</option>
			</Select>

			<EntitySummary entries={entries} />

			{entries.length === 0 ? (
				<BodyLong>Ingen oppføringer for denne handlingen i perioden.</BodyLong>
			) : (
				// biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1
				<section className="table-scroll" tabIndex={0} aria-label={`Audit-logg detaljer for ${action}`}>
					<Table size="small">
						<Table.Header>
							<Table.Row>
								<Table.HeaderCell scope="col">Tidspunkt</Table.HeaderCell>
								<Table.HeaderCell scope="col">Entity</Table.HeaderCell>
								<Table.HeaderCell scope="col">Forrige verdi</Table.HeaderCell>
								<Table.HeaderCell scope="col">Ny verdi</Table.HeaderCell>
								<Table.HeaderCell scope="col">Metadata</Table.HeaderCell>
								<Table.HeaderCell scope="col">Utført av</Table.HeaderCell>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{entries.map((entry) => (
								<Table.Row key={entry.id}>
									<Table.DataCell
										style={{ whiteSpace: "nowrap", fontFamily: "monospace", fontSize: "var(--ax-font-size-small)" }}
									>
										{entry.performedAt}
									</Table.DataCell>
									<Table.DataCell>
										<div style={{ fontSize: "var(--ax-font-size-small)" }}>
											<div style={{ color: "var(--ax-text-subtle)" }}>{entry.entityType}</div>
											<CopyButton
												copyText={entry.entityId}
												text={truncate(entry.entityId, 20)}
												size="xsmall"
												variant="action"
											/>
										</div>
									</Table.DataCell>
									<Table.DataCell>
										<JsonCell value={entry.previousValue} />
									</Table.DataCell>
									<Table.DataCell>
										<JsonCell value={entry.newValue} />
									</Table.DataCell>
									<Table.DataCell>
										<JsonCell value={entry.metadata} />
									</Table.DataCell>
									<Table.DataCell style={{ fontSize: "var(--ax-font-size-small)" }}>{entry.performedBy}</Table.DataCell>
								</Table.Row>
							))}
						</Table.Body>
					</Table>
				</section>
			)}
		</VStack>
	)
}

function JsonCell({ value }: { value: string | null }) {
	const [formatted, setFormatted] = useState<string | null>(null)
	if (!value) return <span style={{ color: "var(--ax-text-subtle)" }}>–</span>
	const truncated = truncate(value, 60)
	return (
		<details
			style={{ fontSize: "var(--ax-font-size-small)", maxWidth: "20rem" }}
			onToggle={(e) => {
				if ((e.target as HTMLDetailsElement).open && formatted === null) {
					setFormatted(formatJson(value))
				}
			}}
		>
			<summary style={{ cursor: "pointer", fontFamily: "monospace", wordBreak: "break-all" }}>{truncated}</summary>
			{formatted !== null && (
				<pre
					style={{
						whiteSpace: "pre-wrap",
						wordBreak: "break-all",
						margin: "var(--ax-space-2) 0",
						padding: "var(--ax-space-2)",
						backgroundColor: "var(--ax-bg-subtle)",
						borderRadius: "var(--ax-radius-4)",
						fontSize: "var(--ax-font-size-small)",
					}}
				>
					{formatted}
				</pre>
			)}
		</details>
	)
}

function EntitySummary({ entries }: { entries: AuditLogEntry[] }) {
	const entityCounts = new Map<string, number>()
	for (const entry of entries) {
		const key = `${entry.entityType}:${entry.entityId}`
		entityCounts.set(key, (entityCounts.get(key) ?? 0) + 1)
	}
	const sorted = [...entityCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)

	if (sorted.length === 0) return null

	return (
		<section className="admin-maintenance-card">
			<VStack gap="space-4">
				<Heading size="medium" level="3">
					Mest berørte entiteter (topp 10)
				</Heading>
				<div style={{ display: "flex", flexWrap: "wrap", gap: "var(--ax-space-2)" }}>
					{sorted.map(([key, count]) => (
						<Tag key={key} variant="neutral" size="small">
							{truncate(key, 40)} ({count})
						</Tag>
					))}
				</div>
			</VStack>
		</section>
	)
}
