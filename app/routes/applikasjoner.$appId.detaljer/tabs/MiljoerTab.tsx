import { BodyLong, Table, Tag } from "@navikt/ds-react"

export function MiljoerTab({
	environments,
}: {
	environments: Array<{
		id: string
		cluster: string | null
		namespace: string
		naisTeamSlug: string | null
		imageName: string | null
		discoveredAt: Date | string
	}>
}) {
	if (environments.length === 0) {
		return <BodyLong>Ingen kjente miljøer.</BodyLong>
	}

	return (
		/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable table needs keyboard access */
		<section className="table-scroll" tabIndex={0} aria-label="Miljøer">
			<Table size="small">
				<Table.Header>
					<Table.Row>
						<Table.HeaderCell scope="col">Klynge</Table.HeaderCell>
						<Table.HeaderCell scope="col">Namespace</Table.HeaderCell>
						<Table.HeaderCell scope="col">Nais-team</Table.HeaderCell>
						<Table.HeaderCell scope="col">Image</Table.HeaderCell>
						<Table.HeaderCell scope="col">Oppdaget</Table.HeaderCell>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{environments.map((env) => (
						<Table.Row key={env.id}>
							<Table.DataCell>
								{env.cluster ? (
									<Tag variant="neutral" size="xsmall">
										{env.cluster}
									</Tag>
								) : (
									"–"
								)}
							</Table.DataCell>
							<Table.DataCell>{env.namespace}</Table.DataCell>
							<Table.DataCell>{env.naisTeamSlug ?? "–"}</Table.DataCell>
							<Table.DataCell
								style={{
									wordBreak: "break-all",
									maxWidth: "300px",
									fontSize: "var(--ax-font-size-small)",
								}}
							>
								{env.imageName ?? "–"}
							</Table.DataCell>
							<Table.DataCell>{new Date(env.discoveredAt).toLocaleDateString("nb-NO")}</Table.DataCell>
						</Table.Row>
					))}
				</Table.Body>
			</Table>
		</section>
	)
}
