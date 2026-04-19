import { BodyLong, Box, Button, Heading, Table, Tag } from "@navikt/ds-react"
import { Form, Link } from "react-router"

export function LinkSuggestionsSection({
	linkSuggestions,
}: {
	linkSuggestions: Array<{ id: string; name: string; cluster: string; isProd: boolean }>
}) {
	return (
		<Box>
			<Heading size="medium" level="3" spacing>
				Foreslåtte koblinger
			</Heading>
			<BodyLong spacing>
				Disse applikasjonene bruker samme Docker image og kan være testdeploymenter av denne applikasjonen.
			</BodyLong>
			<Table size="small">
				<Table.Header>
					<Table.Row>
						<Table.HeaderCell scope="col">Applikasjon</Table.HeaderCell>
						<Table.HeaderCell scope="col">Miljø</Table.HeaderCell>
						<Table.HeaderCell scope="col" />
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{linkSuggestions.map((s) => (
						<Table.Row key={s.id}>
							<Table.DataCell>
								<Link to={`/applikasjoner/${s.id}/detaljer`}>{s.name}</Link>
							</Table.DataCell>
							<Table.DataCell>
								<Tag variant={s.isProd ? "success" : "neutral"} size="xsmall">
									{s.cluster}
								</Tag>
							</Table.DataCell>
							<Table.DataCell>
								<Form method="post">
									<input type="hidden" name="intent" value="link" />
									<input type="hidden" name="linkedId" value={s.id} />
									<Button variant="tertiary" size="xsmall" type="submit">
										Koble hit
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
