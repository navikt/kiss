import { Heading, Table, VStack } from "@navikt/ds-react"
import type { loader } from "../loader.server"
import { formatAction, formatDetails } from "../shared"

type LoaderData = Awaited<ReturnType<typeof loader>>["data"]
type AuditEntry = LoaderData["auditEntries"][number]

interface AuditLogProps {
	entries: AuditEntry[]
}

export function AuditLog({ entries }: AuditLogProps) {
	if (entries.length === 0) return null
	return (
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
						{entries.map((entry) => (
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
	)
}
