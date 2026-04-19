import { BodyLong, BodyShort, HStack, Table, Tag, VStack } from "@navikt/ds-react"
import { GroupsSection } from "../components/GroupsSection"
import { authLabels } from "../shared"

export function AutentiseringTab({
	authIntegrations,
	naisGroupIds,
	manualGroups,
	ghostGroupIds,
	groupNames,
	assessmentsByGroupId,
	canAdmin,
	isOnPrem,
}: {
	authIntegrations: Array<{
		id: string
		type: string
		sidecarEnabled: boolean | null
		allowAllUsers: boolean | null
		groups: string | null
		inboundRules: string | null
		claimsExtra: string | null
	}>
	naisGroupIds: string[]
	manualGroups: Array<{ id: string; groupId: string; groupName: string | null; createdBy: string; createdAt: string }>
	ghostGroupIds: string[]
	groupNames: Record<string, string>
	assessmentsByGroupId: Record<string, { criticality: string; updatedBy: string; updatedAt: string }>
	canAdmin: boolean
	isOnPrem: boolean
}) {
	if (authIntegrations.length === 0) {
		return (
			<VStack gap="space-4">
				<BodyLong>Ingen autentiseringsintegrasjoner funnet.</BodyLong>
				<GroupsSection
					naisGroupIds={naisGroupIds}
					manualGroups={manualGroups}
					ghostGroupIds={ghostGroupIds}
					groupNames={groupNames}
					assessmentsByGroupId={assessmentsByGroupId}
					authIntegrations={authIntegrations}
					canAdmin={canAdmin}
				/>
			</VStack>
		)
	}

	return (
		<VStack gap="space-4">
			{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable table needs keyboard access */}
			<section className="table-scroll" tabIndex={0} aria-label="Autentiseringsintegrasjoner">
				<Table size="small">
					<Table.Header>
						<Table.Row>
							<Table.HeaderCell scope="col">Integrasjon</Table.HeaderCell>
							<Table.HeaderCell scope="col">Login proxy</Table.HeaderCell>
							<Table.HeaderCell scope="col">Brukertilgang</Table.HeaderCell>
							<Table.HeaderCell scope="col">Applikasjonstilgang</Table.HeaderCell>
							<Table.HeaderCell scope="col">Claims</Table.HeaderCell>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{authIntegrations.map((auth) => {
							const claimsExtra = auth.claimsExtra ? (JSON.parse(auth.claimsExtra) as string[]) : null
							const inboundRules = auth.inboundRules
								? (JSON.parse(auth.inboundRules) as Array<{
										application: string
										namespace?: string
										cluster?: string
									}>)
								: null
							const supportsProxy = auth.type === "entra_id" || auth.type === "id_porten"
							return (
								<Table.Row key={auth.id}>
									<Table.DataCell>{authLabels[auth.type] ?? auth.type}</Table.DataCell>
									<Table.DataCell>
										{supportsProxy ? (
											isOnPrem ? (
												<Tag variant="neutral" size="xsmall">
													Ikke tilgjengelig (on-prem)
												</Tag>
											) : auth.sidecarEnabled ? (
												<Tag variant="success" size="xsmall">
													Aktivert
												</Tag>
											) : auth.sidecarEnabled === false ? (
												<Tag variant="neutral" size="xsmall">
													Ikke aktivert
												</Tag>
											) : (
												<BodyShort size="small" textColor="subtle">
													Ukjent
												</BodyShort>
											)
										) : (
											<BodyShort size="small" textColor="subtle">
												—
											</BodyShort>
										)}
									</Table.DataCell>
									<Table.DataCell>
										{auth.type === "entra_id" ? (
											auth.allowAllUsers ? (
												<Tag variant="warning" size="xsmall">
													Alle brukere
												</Tag>
											) : auth.groups ? (
												<Tag variant="info" size="xsmall">
													Gruppebasert
												</Tag>
											) : (
												<Tag variant="neutral" size="xsmall">
													Ikke konfigurert
												</Tag>
											)
										) : auth.type === "id_porten" ? (
											<Tag variant="info" size="xsmall">
												Borgere (ID-porten)
											</Tag>
										) : auth.type === "token_x" ? (
											<Tag variant="info" size="xsmall">
												Via TokenX
											</Tag>
										) : (
											<BodyShort size="small" textColor="subtle">
												—
											</BodyShort>
										)}
									</Table.DataCell>
									<Table.DataCell>
										{auth.type === "entra_id" || auth.type === "maskinporten" ? (
											inboundRules && inboundRules.length > 0 ? (
												<Tag variant="info" size="xsmall">
													{inboundRules.length} {inboundRules.length === 1 ? "applikasjon" : "applikasjoner"}
												</Tag>
											) : (
												<Tag variant="neutral" size="xsmall">
													Ikke konfigurert
												</Tag>
											)
										) : (
											<BodyShort size="small" textColor="subtle">
												—
											</BodyShort>
										)}
									</Table.DataCell>
									<Table.DataCell>
										{claimsExtra && claimsExtra.length > 0 ? (
											<HStack gap="space-1" wrap>
												{claimsExtra.map((claim) => (
													<Tag key={claim} variant="neutral" size="xsmall">
														{claim}
													</Tag>
												))}
											</HStack>
										) : (
											<BodyShort size="small" textColor="subtle">
												—
											</BodyShort>
										)}
									</Table.DataCell>
								</Table.Row>
							)
						})}
					</Table.Body>
				</Table>
			</section>

			<GroupsSection
				naisGroupIds={naisGroupIds}
				manualGroups={manualGroups}
				ghostGroupIds={ghostGroupIds}
				groupNames={groupNames}
				assessmentsByGroupId={assessmentsByGroupId}
				authIntegrations={authIntegrations}
				canAdmin={canAdmin}
			/>
		</VStack>
	)
}
