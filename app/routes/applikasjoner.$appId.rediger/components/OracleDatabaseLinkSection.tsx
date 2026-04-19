import { BodyLong, Box, Button, Heading, HStack, Select, Table } from "@navikt/ds-react"
import { Form } from "react-router"

export function OracleDatabaseLinkSection({
	oraclePersistence,
	oracleInstances,
}: {
	oraclePersistence: Array<{ id: string; name: string; oracleInstanceId: string | null }>
	oracleInstances: Array<{ id: string; instanceId: string }>
}) {
	return (
		<Box>
			<Heading size="medium" level="3" spacing>
				Oracle-databasekobling
			</Heading>
			<BodyLong spacing>
				Koble Oracle-databaser oppdaget av Nais til riktig Oracle-instans. Dette sikrer at audit logging-oppsummeringer
				hentes for riktig database.
			</BodyLong>
			<Table size="small">
				<Table.Header>
					<Table.Row>
						<Table.HeaderCell scope="col">Database (oppdaget)</Table.HeaderCell>
						<Table.HeaderCell scope="col">Koblet Oracle-instans</Table.HeaderCell>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{oraclePersistence.map((p) => (
						<Table.Row key={p.id}>
							<Table.DataCell>{p.name}</Table.DataCell>
							<Table.DataCell>
								<Form method="post">
									<input type="hidden" name="intent" value="linkPersistenceToOracle" />
									<input type="hidden" name="persistenceId" value={p.id} />
									<HStack gap="space-2" align="end">
										<Select
											label="Oracle-instans"
											name="oracleInstanceId"
											size="small"
											hideLabel
											defaultValue={p.oracleInstanceId ?? ""}
										>
											<option value="">Bruk databasenavn ({p.name})</option>
											{oracleInstances.map((inst) => (
												<option key={inst.id} value={inst.instanceId}>
													{inst.instanceId.toUpperCase()}
												</option>
											))}
										</Select>
										<Button variant="secondary" size="small" type="submit">
											Lagre
										</Button>
									</HStack>
								</Form>
							</Table.DataCell>
						</Table.Row>
					))}
				</Table.Body>
			</Table>
		</Box>
	)
}
