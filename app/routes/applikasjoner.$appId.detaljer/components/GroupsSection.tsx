import { ExclamationmarkTriangleIcon } from "@navikt/aksel-icons"
import { BodyShort, CopyButton, Detail, Heading, HStack, Table, Tag, VStack } from "@navikt/ds-react"
import { type GroupCriticality, groupCriticalityLabels } from "~/db/schema/applications"
import { criticalityTagColor, criticalityTagVariant, type UnifiedGroup } from "../shared"

export function GroupsSection({
	naisGroupIds,
	manualGroups,
	ghostGroupIds,
	groupNames,
	assessmentsByGroupId,
	authIntegrations,
}: {
	naisGroupIds: string[]
	manualGroups: Array<{ id: string; groupId: string; groupName: string | null; createdBy: string; createdAt: string }>
	ghostGroupIds: string[]
	groupNames: Record<string, string>
	assessmentsByGroupId: Record<string, { criticality: string; updatedBy: string; updatedAt: string }>
	authIntegrations: Array<{ type: string; allowAllUsers: boolean | null; groups: string | null }>
}) {
	const naisGroupIdSet = new Set(naisGroupIds)

	const unifiedGroups: UnifiedGroup[] = []
	for (const gid of naisGroupIds) {
		unifiedGroups.push({ groupId: gid, source: "nais" })
	}
	for (const mg of manualGroups) {
		if (!naisGroupIdSet.has(mg.groupId)) {
			unifiedGroups.push({ groupId: mg.groupId, source: "manual", manualGroupDbId: mg.id, createdBy: mg.createdBy })
		}
	}
	for (const gid of ghostGroupIds) {
		unifiedGroups.push({ groupId: gid, source: "removed" })
	}

	const totalGroupCount = unifiedGroups.length

	const entraAuth = authIntegrations.find((a) => a.type === "entra_id")
	const hasAllUsers = entraAuth?.allowAllUsers ?? false

	return (
		<VStack gap="space-4">
			<VStack gap="space-2">
				<Heading size="xsmall" level="4">
					Entra ID-grupper ({totalGroupCount})
				</Heading>
				<BodyShort size="small" textColor="subtle">
					{hasAllUsers
						? "Alle brukere får utstedt token uavhengig av gruppemedlemskap."
						: naisGroupIds.length > 0
							? "Bruker må være medlem av minst én av gruppene for å få utstedt token. Applikasjonen kan ha ytterligere tilgangskontroll som avgrenser tilgang."
							: "Ingen grupper er konfigurert i Nais-manifestet."}
				</BodyShort>
			</VStack>

			{unifiedGroups.length > 0 && (
				// biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1
				<section className="table-scroll" tabIndex={0} aria-label="Tilgangsgrupper">
					<Table size="small">
						<Table.Header>
							<Table.Row>
								<Table.HeaderCell scope="col">Gruppe</Table.HeaderCell>
								<Table.HeaderCell scope="col">Kilde</Table.HeaderCell>
								<Table.HeaderCell scope="col">Kritikalitet</Table.HeaderCell>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{unifiedGroups.map((ug) => {
								const assessment = assessmentsByGroupId[ug.groupId]
								const displayName =
									groupNames[ug.groupId] ?? manualGroups.find((mg) => mg.groupId === ug.groupId)?.groupName ?? null

								return (
									<Table.Row key={`${ug.source}-${ug.groupId}`}>
										<Table.DataCell>
											<VStack gap="space-1">
												{displayName ?? (
													<BodyShort size="small" textColor="subtle">
														Ukjent
													</BodyShort>
												)}
												<HStack gap="space-1" align="center">
													<Detail textColor="subtle" style={{ fontFamily: "monospace" }}>
														{ug.groupId}
													</Detail>
													<CopyButton copyText={ug.groupId} size="xsmall" />
												</HStack>
											</VStack>
										</Table.DataCell>
										<Table.DataCell>
											{ug.source === "nais" && (
												<Tag variant="info" size="xsmall">
													Nais
												</Tag>
											)}
											{ug.source === "manual" && (
												<Tag variant="neutral" size="xsmall">
													Manuell
												</Tag>
											)}
											{ug.source === "removed" && (
												<Tag variant="error" size="xsmall">
													<ExclamationmarkTriangleIcon aria-hidden fontSize="1rem" /> Borte fra manifest
												</Tag>
											)}
										</Table.DataCell>
										<Table.DataCell>
											{assessment ? (
												<Tag
													variant={criticalityTagVariant[assessment.criticality] ?? "neutral"}
													size="xsmall"
													style={
														assessment.criticality === "high"
															? { backgroundColor: criticalityTagColor.high, borderColor: criticalityTagColor.high }
															: undefined
													}
												>
													{groupCriticalityLabels[assessment.criticality as GroupCriticality] ?? assessment.criticality}
												</Tag>
											) : (
												<BodyShort size="small" textColor="subtle">
													Ikke vurdert
												</BodyShort>
											)}
										</Table.DataCell>
									</Table.Row>
								)
							})}
						</Table.Body>
					</Table>
				</section>
			)}
		</VStack>
	)
}
