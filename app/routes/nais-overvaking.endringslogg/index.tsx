import { Heading, HStack, Table, VStack } from "@navikt/ds-react"
import { data, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getRecentAuditLog } from "~/db/queries/audit.server"
import type { Route } from "./+types/index"

export async function loader(_args: Route.LoaderArgs) {
	const auditEntries = await getRecentAuditLog(200)
	const naisAudit = auditEntries.filter((e) => e.entityType === "nais_team" || e.entityType === "nais_sync")
	return data({ auditEntries: naisAudit })
}

export default function NaisEndringslogg() {
	const { auditEntries } = useLoaderData<typeof loader>()

	return (
		<VStack gap="space-6">
			<HStack gap="space-4" align="center">
				<Heading size="xlarge" level="2">
					Endringslogg – Nais-overvåking
				</Heading>
			</HStack>

			{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */}
			<section className="table-scroll" tabIndex={0} aria-label="Endringslogg Nais-overvåking">
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
								<Table.DataCell>{entry.action}</Table.DataCell>
								<Table.DataCell>
									{entry.entityId}
									{entry.newValue ? ` → ${entry.newValue}` : ""}
								</Table.DataCell>
								<Table.DataCell>{entry.performedBy}</Table.DataCell>
							</Table.Row>
						))}
						{auditEntries.length === 0 && (
							<Table.Row>
								<Table.DataCell colSpan={4}>Ingen endringslogg tilgjengelig.</Table.DataCell>
							</Table.Row>
						)}
					</Table.Body>
				</Table>
			</section>
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
