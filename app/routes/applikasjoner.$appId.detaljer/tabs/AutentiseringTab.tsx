import { BodyLong, BodyShort, CopyButton, Detail, Heading, HStack, Table, Tag, VStack } from "@navikt/ds-react"
import { formatDateTimeOslo } from "~/lib/utils"
import { GroupsSection } from "../components/GroupsSection"
import { authLabels } from "../shared"

interface RpaUser {
	rpaGroupId: string
	rpaGroupName: string | null
	entraGroupId: string
	matchSource: "nais" | "manual"
	matchedGroupId: string
	matchedGroupName: string | null
	userObjectId: string
	displayName: string | null
	userPrincipalName: string | null
	accountEnabled: boolean | null
	syncedAt: string
}

export function AutentiseringTab({
	authIntegrations,
	naisGroupIds,
	manualGroups,
	ghostGroupIds,
	groupNames,
	assessmentsByGroupId,
	canAdmin,
	isOnPrem,
	rpaUsers,
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
	rpaUsers: RpaUser[]
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
				<RpaUsersSection rpaUsers={rpaUsers} />
			</VStack>
		)
	}

	return (
		<VStack gap="space-4">
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

			<GroupsSection
				naisGroupIds={naisGroupIds}
				manualGroups={manualGroups}
				ghostGroupIds={ghostGroupIds}
				groupNames={groupNames}
				assessmentsByGroupId={assessmentsByGroupId}
				authIntegrations={authIntegrations}
				canAdmin={canAdmin}
			/>
			<RpaUsersSection rpaUsers={rpaUsers} />
		</VStack>
	)
}

// ─── RPA Users Section ────────────────────────────────────────────────────────

function RpaUsersSection({ rpaUsers }: { rpaUsers: RpaUser[] }) {
	if (rpaUsers.length === 0) return null

	// Deduplicate users (same user can appear via multiple groups)
	// Prefer the most recently synced data for display fields
	const uniqueUsers = new Map<string, RpaUser & { groups: Array<{ name: string | null; source: "nais" | "manual" }> }>()
	for (const user of rpaUsers) {
		const existing = uniqueUsers.get(user.userObjectId)
		if (existing) {
			existing.groups.push({ name: user.rpaGroupName, source: user.matchSource })
			// Update display fields if this row has more recent sync data
			if (user.syncedAt > existing.syncedAt) {
				existing.displayName = user.displayName
				existing.userPrincipalName = user.userPrincipalName
				existing.accountEnabled = user.accountEnabled
				existing.syncedAt = user.syncedAt
			}
		} else {
			uniqueUsers.set(user.userObjectId, {
				...user,
				groups: [{ name: user.rpaGroupName, source: user.matchSource }],
			})
		}
	}

	const users = [...uniqueUsers.values()]
	const latestSync = rpaUsers.reduce((latest, u) => (u.syncedAt > latest ? u.syncedAt : latest), rpaUsers[0].syncedAt)

	return (
		<VStack gap="space-4">
			<HStack justify="space-between" align="center">
				<Heading size="small" level="3">
					RPA-brukere ({users.length})
				</Heading>
				<Detail textColor="subtle">Sist synkronisert: {formatDateTimeOslo(latestSync)}</Detail>
			</HStack>

			{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable container needs keyboard access */}
			<section className="table-scroll" tabIndex={0} aria-label="RPA-brukere">
				<Table size="small">
					<Table.Header>
						<Table.Row>
							<Table.HeaderCell scope="col">Navn</Table.HeaderCell>
							<Table.HeaderCell scope="col">UPN / E-post</Table.HeaderCell>
							<Table.HeaderCell scope="col">Status</Table.HeaderCell>
							<Table.HeaderCell scope="col">RPA-gruppe</Table.HeaderCell>
							<Table.HeaderCell scope="col">Kilde</Table.HeaderCell>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{users.map((user) => (
							<Table.Row key={user.userObjectId}>
								<Table.DataCell>
									<HStack gap="space-1" align="center">
										<BodyShort size="small">{user.displayName ?? "Ukjent"}</BodyShort>
										<CopyButton copyText={user.userObjectId} size="xsmall" />
									</HStack>
								</Table.DataCell>
								<Table.DataCell>
									<Detail style={{ fontFamily: "monospace" }}>{user.userPrincipalName ?? "—"}</Detail>
								</Table.DataCell>
								<Table.DataCell>
									{user.accountEnabled === true ? (
										<Tag variant="success" size="xsmall">
											Aktiv
										</Tag>
									) : user.accountEnabled === false ? (
										<Tag variant="error" size="xsmall">
											Deaktivert
										</Tag>
									) : (
										<Tag variant="neutral" size="xsmall">
											Ukjent
										</Tag>
									)}
								</Table.DataCell>
								<Table.DataCell>
									<VStack gap="space-1">
										{user.groups.map((g) => (
											<BodyShort key={`${user.userObjectId}-${g.name}-${g.source}`} size="small">
												{g.name ?? "Ukjent"}
											</BodyShort>
										))}
									</VStack>
								</Table.DataCell>
								<Table.DataCell>
									<VStack gap="space-1">
										{user.groups.map((g) => (
											<Tag
												key={`${user.userObjectId}-src-${g.name}-${g.source}`}
												variant={g.source === "nais" ? "info" : "neutral"}
												size="xsmall"
											>
												{g.source === "nais" ? "Nais" : "Manuell"}
											</Tag>
										))}
									</VStack>
								</Table.DataCell>
							</Table.Row>
						))}
					</Table.Body>
				</Table>
			</section>
		</VStack>
	)
}

export const _testing = { formatDateTimeOslo }
