import { BodyLong, Link as DsLink, Heading, Select, Table, Tag, VStack } from "@navikt/ds-react"
import { sql } from "drizzle-orm"
import type { LoaderFunctionArgs } from "react-router"
import { data, Link, useLoaderData, useSearchParams } from "react-router"
import { db } from "~/db/connection.server"
import { normalizePeriod, periodToInterval } from "~/lib/audit-log-periods"
import { requireAuthenticatedUser } from "~/lib/auth.server"
import { requireAdmin } from "~/lib/authorization.server"

interface VolumeByAction {
	action: string
	performedBy: string
	count: number
}

interface VolumeByHour {
	hour: string
	count: number
}

interface LoaderData {
	byAction: VolumeByAction[]
	byHour: VolumeByHour[]
	totalCount: number
	period: string
}

export async function loader({ request, url }: LoaderFunctionArgs) {
	const authedUser = await requireAuthenticatedUser(request)
	requireAdmin(authedUser)

	const rawPeriod = url.searchParams.get("period") ?? "6h"
	const period = normalizePeriod(rawPeriod)
	const interval = periodToInterval(period)

	const [byAction, byHour] = await Promise.all([getVolumeByAction(interval), getVolumeByHour(interval)])
	const totalCount = byHour.reduce((sum, h) => sum + h.count, 0)

	return data({ byAction, byHour, totalCount, period })
}

async function getVolumeByAction(interval: string): Promise<VolumeByAction[]> {
	const rows = await db.execute<{ action: string; performed_by: string; count: string }>(
		sql`SELECT action, performed_by, COUNT(*)::text AS count
			FROM audit_log
			WHERE performed_at > NOW() - ${interval}::interval
			GROUP BY action, performed_by
			ORDER BY COUNT(*) DESC
			LIMIT 50`,
	)
	return rows.rows.map((r) => ({
		action: r.action,
		performedBy: r.performed_by,
		count: Number(r.count),
	}))
}

async function getVolumeByHour(interval: string): Promise<VolumeByHour[]> {
	const rows = await db.execute<{ hour: string; count: string }>(
		sql`SELECT to_char(date_trunc('hour', performed_at AT TIME ZONE 'Europe/Oslo'), 'YYYY-MM-DD HH24:00') AS hour,
				   COUNT(*)::text AS count
			FROM audit_log
			WHERE performed_at > NOW() - ${interval}::interval
			GROUP BY date_trunc('hour', performed_at AT TIME ZONE 'Europe/Oslo')
			ORDER BY date_trunc('hour', performed_at AT TIME ZONE 'Europe/Oslo')`,
	)
	return rows.rows.map((r) => ({ hour: r.hour, count: Number(r.count) }))
}

export { RouteErrorBoundary as ErrorBoundary } from "~/components/RouteErrorBoundary"

export default function AuditLoggVolum() {
	const { byAction, byHour, totalCount, period } = useLoaderData<LoaderData>()
	const [, setSearchParams] = useSearchParams()

	function handlePeriodChange(newPeriod: string) {
		setSearchParams({ period: newPeriod })
	}

	const maxHourCount = Math.max(...byHour.map((h) => h.count), 1)

	return (
		<VStack gap="space-8">
			<VStack gap="space-2">
				<Heading size="xlarge" level="2">
					Audit-logg volum
				</Heading>
				<BodyLong>Analyser volumet av audit-logg-oppføringer for å identifisere unormal aktivitet.</BodyLong>
			</VStack>

			<Select
				label="Tidsperiode"
				value={period}
				onChange={(e) => handlePeriodChange(e.target.value)}
				style={{ maxWidth: "16rem" }}
			>
				<option value="1h">Siste time</option>
				<option value="6h">Siste 6 timer</option>
				<option value="24h">Siste 24 timer</option>
				<option value="7d">Siste 7 dager</option>
			</Select>

			<section className="admin-maintenance-card">
				<VStack gap="space-4">
					<Heading size="medium" level="3">
						Sammendrag
					</Heading>
					<Tag variant={totalCount > 10000 ? "error" : totalCount > 1000 ? "warning" : "success"} size="small">
						{totalCount.toLocaleString("nb-NO")} oppføringer i perioden
					</Tag>
				</VStack>
			</section>

			<section className="admin-maintenance-card">
				<VStack gap="space-4">
					<Heading size="medium" level="3">
						Volum per time
					</Heading>
					{byHour.length === 0 ? (
						<BodyLong>Ingen data i perioden.</BodyLong>
					) : (
						<div style={{ display: "flex", flexDirection: "column", gap: "var(--ax-space-1)" }}>
							{byHour.map((h) => (
								<div key={h.hour} style={{ display: "flex", alignItems: "center", gap: "var(--ax-space-3)" }}>
									<span style={{ minWidth: "10rem", fontSize: "var(--ax-font-size-small)", fontFamily: "monospace" }}>
										{h.hour}
									</span>
									<div
										style={{
											height: "1.25rem",
											width: `${(h.count / maxHourCount) * 100}%`,
											minWidth: "2px",
											backgroundColor:
												h.count > 5000
													? "var(--ax-bg-danger-moderate)"
													: h.count > 1000
														? "var(--ax-bg-warning-moderate)"
														: "var(--ax-bg-brand-blue-moderate)",
											borderRadius: "var(--ax-radius-4)",
										}}
									/>
									<span style={{ fontSize: "var(--ax-font-size-small)", fontFamily: "monospace" }}>
										{h.count.toLocaleString("nb-NO")}
									</span>
								</div>
							))}
						</div>
					)}
				</VStack>
			</section>

			<section className="admin-maintenance-card">
				<VStack gap="space-4">
					<Heading size="medium" level="3">
						Topp handlinger
					</Heading>
					{byAction.length === 0 ? (
						<BodyLong>Ingen data i perioden.</BodyLong>
					) : (
						// biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1
						<section className="table-scroll" tabIndex={0} aria-label="Audit-logg volum per handling">
							<Table size="small">
								<Table.Header>
									<Table.Row>
										<Table.HeaderCell scope="col">Handling</Table.HeaderCell>
										<Table.HeaderCell scope="col">Utført av</Table.HeaderCell>
										<Table.HeaderCell scope="col" align="right">
											Antall
										</Table.HeaderCell>
										<Table.HeaderCell scope="col" style={{ minWidth: "12rem" }}>
											Andel
										</Table.HeaderCell>
									</Table.Row>
								</Table.Header>
								<Table.Body>
									{byAction.map((row) => (
										<Table.Row key={`${row.action}-${row.performedBy}`}>
											<Table.DataCell>
												<DsLink
													as={Link}
													to={`/admin/audit-logg-volum/detaljer?action=${encodeURIComponent(row.action)}&period=${period}`}
												>
													<code style={{ fontSize: "var(--ax-font-size-small)" }}>{row.action}</code>
												</DsLink>
											</Table.DataCell>
											<Table.DataCell>{row.performedBy}</Table.DataCell>
											<Table.DataCell align="right">{row.count.toLocaleString("nb-NO")}</Table.DataCell>
											<Table.DataCell>
												<div
													style={{
														height: "0.75rem",
														width: `${totalCount > 0 ? (row.count / totalCount) * 100 : 0}%`,
														minWidth: "2px",
														backgroundColor: "var(--ax-bg-brand-blue-moderate)",
														borderRadius: "var(--ax-radius-4)",
													}}
												/>
											</Table.DataCell>
										</Table.Row>
									))}
								</Table.Body>
							</Table>
						</section>
					)}
				</VStack>
			</section>
		</VStack>
	)
}
