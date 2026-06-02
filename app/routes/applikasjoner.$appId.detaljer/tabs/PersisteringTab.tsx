import { Alert, BodyLong, List, Table, VStack } from "@navikt/ds-react"
import { AddPersistenceForm } from "../components/AddPersistenceForm"
import { type OracleRoleDisplay, OracleRolesSection } from "../components/OracleRolesSection"
import { PersistenceRow } from "../components/PersistenceRow"

export function PersisteringTab({
	persistence,
	oracleAuditSummaries,
	oracleRoles,
	canAdmin,
	canManagePersistence,
	inaccessibleOracleGroups,
}: {
	persistence: Array<{
		id: string
		type: string
		name: string
		version: string | null
		tier: string | null
		highAvailability: boolean | null
		auditLogging: boolean | null
		auditLogUrl: string | null
		oracleInstanceId: string | null
		dataClassification: string | null
		manuallyAdded: boolean
		lastSeenInNaisAt: Date | string | null
	}>
	oracleAuditSummaries: Record<
		string,
		{
			conclusion: string
			reason: string
			findings: Array<{ severity: string; message: string }>
		}
	>
	oracleRoles: OracleRoleDisplay[]
	canAdmin: boolean
	canManagePersistence: boolean
	inaccessibleOracleGroups?: Array<{ id: string; name: string }>
}) {
	const groups = inaccessibleOracleGroups ?? []
	return (
		<VStack gap="space-8">
			<AddPersistenceForm />

			{persistence.length > 0 ? (
				// biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1
				<section className="table-scroll" tabIndex={0} aria-label="Databaser og lagring">
					<Table size="small">
						<Table.Header>
							<Table.Row>
								<Table.HeaderCell scope="col">Type</Table.HeaderCell>
								<Table.HeaderCell scope="col">Navn</Table.HeaderCell>
								<Table.HeaderCell scope="col">Klassifisering</Table.HeaderCell>
								<Table.HeaderCell scope="col">Versjon</Table.HeaderCell>
								<Table.HeaderCell scope="col">Tier</Table.HeaderCell>
								<Table.HeaderCell scope="col">HA</Table.HeaderCell>
								<Table.HeaderCell scope="col">Audit logging</Table.HeaderCell>
								<Table.HeaderCell scope="col" />
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{persistence.map((p) => (
								<PersistenceRow
									key={p.id}
									p={p}
									oracleAuditSummaries={oracleAuditSummaries}
									canManagePersistence={canManagePersistence}
								/>
							))}
						</Table.Body>
					</Table>
				</section>
			) : (
				<BodyLong>Ingen kjent persistens. Legg til en database manuelt ovenfor.</BodyLong>
			)}

			<OracleRolesSection roles={oracleRoles} canAdmin={canAdmin} />

			{groups.length > 0 && (
				<Alert variant="info" size="small">
					Du mangler tilgang til å se Oracle-roller for noen databaseinstanser. For å få tilgang, be om medlemskap i
					følgende Entra ID-gruppe{groups.length > 1 ? "r" : ""}:
					<List>
						{groups.map((g) => (
							<List.Item key={g.id}>{g.name}</List.Item>
						))}
					</List>
				</Alert>
			)}
		</VStack>
	)
}
