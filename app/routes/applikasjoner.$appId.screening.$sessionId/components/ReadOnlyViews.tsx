import { BodyShort, CopyButton, Detail, Heading, HStack, Table, Tag, VStack } from "@navikt/ds-react"
import {
	type DataClassification,
	dataClassificationLabels,
	economySystemTypeLabels,
	type GroupCriticality,
	groupCriticalityLabels,
	persistenceTypeLabels,
} from "~/db/schema/applications"
import type {
	EconomyClassificationData,
	EntraGroupsData,
	OracleRolesData,
	PersistenceEntry,
	RulesetOption,
	ScreeningQuestion,
} from "../shared"
import { persistenceVariants } from "../shared"

export function ReadOnlyAnswer({ question: q }: { question: ScreeningQuestion }) {
	return (
		<VStack gap="space-4">
			<VStack gap="space-2">
				<Detail weight="semibold" textColor="subtle">
					Svar
				</Detail>
				<BodyShort>{q.answer || "Ikke besvart"}</BodyShort>
			</VStack>
			{q.answerComment && (
				<VStack gap="space-2">
					<Detail weight="semibold" textColor="subtle">
						Kommentar
					</Detail>
					<BodyShort>{q.answerComment}</BodyShort>
				</VStack>
			)}
			{q.answerLink && (
				<VStack gap="space-2">
					<Detail weight="semibold" textColor="subtle">
						Lenke
					</Detail>
					<BodyShort>
						{/^https?:\/\//i.test(q.answerLink) ? (
							<a href={q.answerLink} target="_blank" rel="noopener noreferrer">
								{q.answerLink}
							</a>
						) : (
							q.answerLink
						)}
					</BodyShort>
				</VStack>
			)}
		</VStack>
	)
}

export function ReadOnlyRuleset({ question: q, rulesets }: { question: ScreeningQuestion; rulesets: RulesetOption[] }) {
	const selected = rulesets.find((rs) => rs.id === q.answer)
	return (
		<VStack gap="space-2">
			<Detail weight="semibold" textColor="subtle">
				Valgt regelsett
			</Detail>
			<BodyShort>{selected?.name ?? q.answer ?? "Ikke valgt"}</BodyShort>
		</VStack>
	)
}

export function ReadOnlyEconomy({ classification }: { classification: EconomyClassificationData }) {
	if (!classification) {
		return <BodyShort textColor="subtle">Ingen klassifisering registrert.</BodyShort>
	}
	return (
		<VStack gap="space-4">
			<HStack gap="space-4" align="center">
				<Tag variant={classification.isEconomySystem ? "warning" : "neutral"} size="small">
					{classification.isEconomySystem
						? `Økonomisystem${classification.economySystemType ? ` (${economySystemTypeLabels[classification.economySystemType as keyof typeof economySystemTypeLabels]})` : ""}`
						: "Ikke økonomisystem"}
				</Tag>
			</HStack>
			<VStack gap="space-2">
				<Detail weight="semibold" textColor="subtle">
					Begrunnelse
				</Detail>
				<BodyShort>{classification.justification || "Ingen begrunnelse"}</BodyShort>
			</VStack>
		</VStack>
	)
}

export function ReadOnlyPersistence({ entries }: { entries: PersistenceEntry[] }) {
	if (entries.length === 0) {
		return <BodyShort textColor="subtle">Ingen databaser registrert.</BodyShort>
	}
	return (
		<VStack gap="space-4">
			<Heading size="xsmall" level="4">
				Registrerte databaser
			</Heading>
			{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */}
			<section className="table-scroll" tabIndex={0} aria-label="Registrerte databaser">
				<Table size="small">
					<Table.Header>
						<Table.Row>
							<Table.HeaderCell>Type</Table.HeaderCell>
							<Table.HeaderCell>Navn</Table.HeaderCell>
							<Table.HeaderCell>Klassifisering</Table.HeaderCell>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{entries.map((p) => (
							<Table.Row key={p.id}>
								<Table.DataCell>
									<Tag variant={persistenceVariants[p.type] ?? "neutral"} size="xsmall">
										{persistenceTypeLabels[p.type as keyof typeof persistenceTypeLabels] ?? p.type}
									</Tag>
								</Table.DataCell>
								<Table.DataCell>{p.name}</Table.DataCell>
								<Table.DataCell>
									{p.dataClassification
										? dataClassificationLabels[p.dataClassification as DataClassification]
										: "Ikke satt"}
								</Table.DataCell>
							</Table.Row>
						))}
					</Table.Body>
				</Table>
			</section>
		</VStack>
	)
}

export function ReadOnlyEntraGroups({ entraGroupsData }: { entraGroupsData: EntraGroupsData }) {
	const { naisGroupIds, manualGroups, ghostGroupIds, groupNames, assessmentsByGroupId } = entraGroupsData
	const naisGroupIdSet = new Set(naisGroupIds)

	type UnifiedGroup = { groupId: string; source: "nais" | "manual" | "removed" }
	const groups: UnifiedGroup[] = []
	for (const gid of naisGroupIds) groups.push({ groupId: gid, source: "nais" })
	for (const mg of manualGroups) {
		if (!naisGroupIdSet.has(mg.groupId)) groups.push({ groupId: mg.groupId, source: "manual" })
	}
	for (const gid of ghostGroupIds) groups.push({ groupId: gid, source: "removed" })

	if (groups.length === 0) {
		return <BodyShort textColor="subtle">Ingen Entra ID-grupper registrert.</BodyShort>
	}

	return (
		<VStack gap="space-4">
			<Heading size="xsmall" level="4">
				Entra ID-grupper
			</Heading>
			{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */}
			<section className="table-scroll" tabIndex={0} aria-label="Entra ID-grupper">
				<Table size="small">
					<Table.Header>
						<Table.Row>
							<Table.HeaderCell>Gruppe</Table.HeaderCell>
							<Table.HeaderCell>Kilde</Table.HeaderCell>
							<Table.HeaderCell>Kritikalitet</Table.HeaderCell>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{groups.map((ug) => {
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
												Borte fra manifest
											</Tag>
										)}
									</Table.DataCell>
									<Table.DataCell>
										{assessment?.criticality ? (
											<Tag variant="neutral" size="xsmall">
												{groupCriticalityLabels[assessment.criticality as GroupCriticality]}
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
		</VStack>
	)
}

export function ReadOnlyOracleRoles({ oracleRolesData }: { oracleRolesData: OracleRolesData }) {
	const { roles, assessments } = oracleRolesData

	if (roles.length === 0) {
		return <BodyShort textColor="subtle">Ingen Oracle-roller funnet.</BodyShort>
	}

	return (
		<VStack gap="space-4">
			{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */}
			<section className="table-scroll" tabIndex={0} aria-label="Oracle-roller">
				<Table size="small">
					<Table.Header>
						<Table.Row>
							<Table.HeaderCell>Rolle</Table.HeaderCell>
							<Table.HeaderCell>Instans</Table.HeaderCell>
							<Table.HeaderCell>Type</Table.HeaderCell>
							<Table.HeaderCell>Kritikalitet</Table.HeaderCell>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{roles.map((role) => {
							const key = `${role.instanceId}:${role.roleName.toUpperCase().trim()}`
							const assessment = assessments[key]
							return (
								<Table.Row key={key}>
									<Table.DataCell>
										<BodyShort size="small" style={{ fontFamily: "monospace" }}>
											{role.roleName}
										</BodyShort>
									</Table.DataCell>
									<Table.DataCell>
										<BodyShort size="small" textColor="subtle">
											{role.instanceId}
										</BodyShort>
									</Table.DataCell>
									<Table.DataCell>
										<HStack gap="space-1">
											{role.common && (
												<Tag variant="neutral" size="xsmall">
													Common
												</Tag>
											)}
											{role.authType && (
												<Tag variant="info" size="xsmall">
													{role.authType}
												</Tag>
											)}
										</HStack>
									</Table.DataCell>
									<Table.DataCell>
										{assessment?.criticality ? (
											<Tag variant="neutral" size="xsmall">
												{groupCriticalityLabels[assessment.criticality as GroupCriticality]}
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
		</VStack>
	)
}
