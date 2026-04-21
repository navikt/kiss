import { BodyLong, Box, Button, Heading, Table } from "@navikt/ds-react"
import { Form, Link } from "react-router"

export function LinkedAppsSection({ linkedApps }: { linkedApps: Array<{ id: string; name: string }> }) {
	return (
		<Box>
			<Heading size="medium" level="3" spacing>
				Lenkede applikasjoner
			</Heading>
			<BodyLong spacing>
				Disse applikasjonene er testdeploymenter eller varianter som arver compliance-vurderinger fra denne
				applikasjonen.
			</BodyLong>
			<Table size="small">
				<Table.Header>
					<Table.Row>
						<Table.HeaderCell scope="col">Applikasjon</Table.HeaderCell>
						<Table.HeaderCell scope="col" />
						<Table.HeaderCell scope="col" />
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{linkedApps.map((la) => (
						<Table.Row key={la.id}>
							<Table.DataCell>
								<Link to={`/applikasjoner/${la.id}/detaljer`}>{la.name}</Link>
							</Table.DataCell>
							<Table.DataCell>
								<Form method="post">
									<input type="hidden" name="intent" value="promoteToPrimary" />
									<input type="hidden" name="newPrimaryId" value={la.id} />
									<Button variant="tertiary" size="xsmall" type="submit">
										Gjør til hovedapplikasjon
									</Button>
								</Form>
							</Table.DataCell>
							<Table.DataCell>
								<Form method="post">
									<input type="hidden" name="intent" value="unlink" />
									<input type="hidden" name="unlinkId" value={la.id} />
									<Button variant="tertiary-neutral" size="xsmall" type="submit">
										Fjern kobling
									</Button>
								</Form>
							</Table.DataCell>
						</Table.Row>
					))}
				</Table.Body>
			</Table>
		</Box>
	)
}
