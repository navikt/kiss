import { BodyShort, Heading, Table, Tag, VStack } from "@navikt/ds-react"

type Control = {
	id: string
	controlId: string
	name: string
	responsible: string | null
	domainSlug: string | null
}

type Props = {
	controls: Control[]
}

export function StepControls({ controls }: Props) {
	return (
		<VStack gap="space-6">
			<div>
				<Heading size="medium" level="3" spacing>
					Krav
				</Heading>
				<BodyShort size="small" textColor="subtle">
					Kontrollene denne rutinen er koblet til i kontrollrammeverket. Gjennomgangen skal verifisere at disse kravene
					etterleves.
				</BodyShort>
			</div>

			{controls.length > 0 ? (
				/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */
				<section className="table-scroll" tabIndex={0} aria-label="Koblede kontroller">
					<Table size="small">
						<Table.Header>
							<Table.Row>
								<Table.HeaderCell scope="col">Kontroll-ID</Table.HeaderCell>
								<Table.HeaderCell scope="col">Navn</Table.HeaderCell>
								<Table.HeaderCell scope="col">Domene</Table.HeaderCell>
								<Table.HeaderCell scope="col">Ansvarlig</Table.HeaderCell>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{controls.map((c) => (
								<Table.Row key={c.id}>
									<Table.DataCell>
										<Tag variant="neutral" size="xsmall">
											{c.controlId}
										</Tag>
									</Table.DataCell>
									<Table.DataCell>{c.name}</Table.DataCell>
									<Table.DataCell>{c.domainSlug ?? "—"}</Table.DataCell>
									<Table.DataCell>{c.responsible ?? "—"}</Table.DataCell>
								</Table.Row>
							))}
						</Table.Body>
					</Table>
				</section>
			) : (
				<BodyShort textColor="subtle">Ingen kontroller er koblet til denne rutinen.</BodyShort>
			)}
		</VStack>
	)
}
