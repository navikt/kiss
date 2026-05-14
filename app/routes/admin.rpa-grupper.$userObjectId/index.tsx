import {
	BodyLong,
	BodyShort,
	Detail,
	Heading,
	HStack,
	Search,
	type SortState,
	Table,
	Tag,
	VStack,
} from "@navikt/ds-react"
import { useMemo, useState } from "react"
import type { LoaderFunctionArgs } from "react-router"
import { data, Link, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getRpaMemberByUserObjectId, getRpaUserGroupMemberships } from "~/db/queries/rpa.server"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { requireAdmin } from "~/lib/authorization.server"
import { formatDateTimeOslo } from "~/lib/utils"

export async function loader({ request, params }: LoaderFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	requireAdmin(authedUser)

	const userObjectId = params.userObjectId
	if (!userObjectId) throw new Response("Mangler robotbruker", { status: 400 })

	const [member, memberships] = await Promise.all([
		getRpaMemberByUserObjectId(userObjectId),
		getRpaUserGroupMemberships(userObjectId),
	])

	if (!member) throw new Response("Robotbruker ikke funnet", { status: 404 })

	return data({
		member,
		memberships: memberships.map((membership) => ({
			...membership,
			syncedAt: membership.syncedAt.toISOString(),
		})),
	})
}

type SortKey = "groupName"

export default function AdminRpaRobotDetail() {
	const { member, memberships } = useLoaderData<typeof loader>()
	const [searchValue, setSearchValue] = useState("")
	const [sort, setSort] = useState<SortState>({ orderBy: "groupName", direction: "ascending" })

	const filteredMemberships = useMemo(() => {
		const query = searchValue.trim().toLowerCase()
		const filtered = query
			? memberships.filter(
					(membership) =>
						membership.groupDisplayName?.toLowerCase().includes(query) ||
						membership.groupId.toLowerCase().includes(query),
				)
			: memberships
		const direction = sort.direction === "ascending" ? 1 : -1

		return [...filtered].sort((a, b) => {
			switch (sort.orderBy as SortKey) {
				case "groupName": {
					const nameCompare = (a.groupDisplayName ?? "").localeCompare(b.groupDisplayName ?? "", "nb")
					if (nameCompare !== 0) return nameCompare * direction
					return a.groupId.localeCompare(b.groupId, "nb") * direction
				}
				default:
					return 0
			}
		})
	}, [memberships, searchValue, sort])

	const handleSort = (sortKey: string) => {
		setSort((prev) =>
			prev.orderBy === sortKey
				? { orderBy: sortKey, direction: prev.direction === "ascending" ? "descending" : "ascending" }
				: { orderBy: sortKey, direction: "ascending" },
		)
	}

	return (
		<VStack gap="space-6">
			<HStack justify="space-between" align="center" wrap>
				<div>
					<Heading size="xlarge" level="2">
						Robotbruker
					</Heading>
					<BodyLong>Alle Entra ID-grupper robotbrukeren er medlem av.</BodyLong>
				</div>
				<Link to="/admin/rpa-grupper">← Tilbake til RPA-grupper</Link>
			</HStack>

			<VStack gap="space-4">
				<Heading size="medium" level="3">
					Brukerinfo
				</Heading>
				<VStack gap="space-2">
					<BodyShort weight="semibold">{member.displayName ?? "Ukjent robotbruker"}</BodyShort>
					<Detail style={{ fontFamily: "monospace" }}>{member.userPrincipalName ?? "–"}</Detail>
				</VStack>
				<HStack gap="space-16" wrap>
					<VStack gap="space-2">
						<BodyShort size="small" weight="semibold">
							Status
						</BodyShort>
						<StatusTag accountEnabled={member.accountEnabled} />
					</VStack>
					<VStack gap="space-2">
						<BodyShort size="small" weight="semibold">
							Objekt-ID
						</BodyShort>
						<Detail style={{ fontFamily: "monospace" }}>{member.userObjectId}</Detail>
					</VStack>
				</HStack>
				<VStack gap="space-2">
					<BodyShort size="small" weight="semibold">
						Konfigurert i RPA-grupper
					</BodyShort>
					{member.rpaGroups.length > 0 ? (
						<HStack gap="space-2" wrap>
							{member.rpaGroups.map((group) => (
								<Tag key={group.id} variant="neutral" size="small">
									{group.groupName}
								</Tag>
							))}
						</HStack>
					) : (
						<BodyShort size="small" textColor="subtle">
							Robotbrukeren er ikke konfigurert i noen RPA-grupper.
						</BodyShort>
					)}
				</VStack>
			</VStack>

			<VStack gap="space-4">
				<HStack justify="space-between" align="center" wrap>
					<Heading size="medium" level="3">
						Entra ID-grupper ({memberships.length})
					</Heading>
					<div style={{ maxWidth: "20rem", width: "100%" }}>
						<Search
							label="Søk etter Entra ID-gruppe"
							hideLabel
							value={searchValue}
							onChange={setSearchValue}
							onClear={() => setSearchValue("")}
							size="small"
							placeholder="Søk etter gruppenavn eller gruppe-ID…"
						/>
					</div>
				</HStack>

				{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable container needs keyboard access */}
				<section className="table-scroll" tabIndex={0} aria-label="Entra ID-grupper for robotbruker">
					<Table size="small" sort={sort} onSortChange={handleSort}>
						<Table.Header>
							<Table.Row>
								<Table.ColumnHeader scope="col" sortKey="groupName" sortable>
									Gruppenavn
								</Table.ColumnHeader>
								<Table.HeaderCell>Gruppe-ID</Table.HeaderCell>
								<Table.HeaderCell>Synkronisert</Table.HeaderCell>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{filteredMemberships.map((membership) => (
								<Table.Row key={membership.id}>
									<Table.DataCell>
										<BodyShort size="small" weight="semibold">
											{membership.groupDisplayName ?? "Ukjent gruppenavn"}
										</BodyShort>
									</Table.DataCell>
									<Table.DataCell>
										<Detail style={{ fontFamily: "monospace" }}>{membership.groupId}</Detail>
									</Table.DataCell>
									<Table.DataCell>
										<Detail>{formatDateTimeOslo(membership.syncedAt)}</Detail>
									</Table.DataCell>
								</Table.Row>
							))}
							{filteredMemberships.length === 0 && (
								<Table.Row>
									<Table.DataCell colSpan={3}>
										<BodyShort size="small" textColor="subtle">
											{searchValue.trim()
												? "Ingen Entra ID-grupper matcher søket."
												: "Ingen synkroniserte Entra ID-grupper for denne brukeren."}
										</BodyShort>
									</Table.DataCell>
								</Table.Row>
							)}
						</Table.Body>
					</Table>
				</section>
			</VStack>
		</VStack>
	)
}

function StatusTag({ accountEnabled }: { accountEnabled: boolean | null }) {
	return (
		<Tag variant={accountEnabled === true ? "success" : accountEnabled === false ? "warning" : "neutral"} size="small">
			{accountEnabled === true ? "Aktiv" : accountEnabled === false ? "Deaktivert" : "Ukjent"}
		</Tag>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
