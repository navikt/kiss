import { DownloadIcon } from "@navikt/aksel-icons"
import { Alert, BodyShort, Box, Button, Detail, Heading, HStack, Table, Tag, VStack } from "@navikt/ds-react"

export function RevisjonsbevisTab({
	oracleInstanceCount,
	totalOracleInstanceCount,
	instanceSnapshotHistories,
	groupNames,
}: {
	oracleInstanceCount: number
	totalOracleInstanceCount: number
	instanceSnapshotHistories: Array<{
		instanceId: string
		instanceName: string
		instanceType: string | null
		instanceGroup: string | null
		snapshots: Array<{
			id: string
			collectedAt: string
			fetchedAt: string
			fetchedBy: string
			overallStatus: string
		}>
	}>
	groupNames: Record<string, string>
}) {
	return (
		<VStack gap="space-12">
			{totalOracleInstanceCount > oracleInstanceCount && (
				<Alert variant="info" size="small">
					Viser {oracleInstanceCount} av {totalOracleInstanceCount} databaseinstanser. Du har ikke tilgang til alle
					instanser.
				</Alert>
			)}
			{instanceSnapshotHistories.map(({ instanceId, instanceName, instanceType, instanceGroup, snapshots }) => (
				<Box key={instanceId} borderWidth="1" borderColor="neutral-subtle" padding="space-8" borderRadius="8">
					<VStack gap="space-6">
						<VStack gap="space-2">
							<HStack gap="space-8" align="center" wrap={false}>
								<Heading size="small" level="3">
									{instanceName}
								</Heading>
								{instanceType && (
									<Tag variant="neutral" size="xsmall">
										{instanceType}
									</Tag>
								)}
							</HStack>
							{instanceGroup && (
								<Detail>
									<span style={{ color: "var(--ax-text-subtle)" }}>Gruppe: </span>
									{groupNames[instanceGroup] ?? instanceGroup}
								</Detail>
							)}
						</VStack>
						{snapshots.length > 0 ? (
							// biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1
							<section className="table-scroll" tabIndex={0} aria-label={`Bevis for ${instanceName}`}>
								<Table size="small">
									<Table.Header>
										<Table.Row>
											<Table.HeaderCell scope="col">Status</Table.HeaderCell>
											<Table.HeaderCell scope="col">Innsamlet</Table.HeaderCell>
											<Table.HeaderCell scope="col">Hentet</Table.HeaderCell>
											<Table.HeaderCell scope="col">Hentet av</Table.HeaderCell>
											<Table.HeaderCell scope="col" />
										</Table.Row>
									</Table.Header>
									<Table.Body>
										{snapshots.map((s) => (
											<Table.Row key={s.id}>
												<Table.DataCell>
													<Tag
														variant={
															s.overallStatus === "OK" ? "success" : s.overallStatus === "PARTIAL" ? "warning" : "error"
														}
														size="xsmall"
													>
														{s.overallStatus}
													</Tag>
												</Table.DataCell>
												<Table.DataCell>{new Date(s.collectedAt).toLocaleString("nb-NO")}</Table.DataCell>
												<Table.DataCell>{new Date(s.fetchedAt).toLocaleString("nb-NO")}</Table.DataCell>
												<Table.DataCell>{s.fetchedBy}</Table.DataCell>
												<Table.DataCell>
													<a href={`/api/revisjonsbevis/${s.id}/excel`}>
														<Button variant="tertiary" size="xsmall" as="span" icon={<DownloadIcon aria-hidden />}>
															Excel
														</Button>
													</a>
												</Table.DataCell>
											</Table.Row>
										))}
									</Table.Body>
								</Table>
							</section>
						) : (
							<BodyShort>Ingen revisjonsbevis er hentet ennå.</BodyShort>
						)}
					</VStack>
				</Box>
			))}
		</VStack>
	)
}
