import { BodyLong, Detail, Heading, HStack, Search, type SortState, Table, Tag, VStack } from "@navikt/ds-react"
import { useMemo, useState } from "react"
import type { LoaderFunctionArgs } from "react-router"
import { data, Link, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getRpaUsersForSection, type RpaUserForSection } from "~/db/queries/rpa.server"
import { getSectionBySlug } from "~/db/queries/sections.server"
import { formatDateTimeOslo } from "~/lib/utils"

export async function loader({ params }: LoaderFunctionArgs) {
	const { seksjon } = params
	if (!seksjon) throw data({ message: "Mangler seksjonsparameter" }, { status: 400 })

	const section = await getSectionBySlug(seksjon)
	if (!section) throw data({ message: `Fant ikke seksjon: ${seksjon}` }, { status: 404 })

	const rpaUsers = await getRpaUsersForSection(section.id)

	return data({
		seksjon,
		seksjonName: section.name,
		rpaUsers: rpaUsers.map((u) => ({
			...u,
			syncedAt: u.syncedAt.toISOString(),
		})),
	})
}

interface SerializedRpaUser extends Omit<RpaUserForSection, "syncedAt"> {
	syncedAt: string
}

export default function RpaBrukere() {
	const { seksjonName, rpaUsers } = useLoaderData<typeof loader>()
	const [search, setSearch] = useState("")
	const [sort, setSort] = useState<SortState | undefined>({ orderBy: "displayName", direction: "ascending" })

	// Deduplicate users across groups — aggregate groups and apps per user
	const aggregatedUsers = useMemo(() => {
		const userMap = new Map<
			string,
			{
				userObjectId: string
				displayName: string | null
				userPrincipalName: string | null
				accountEnabled: boolean | null
				syncedAt: string
				groups: Array<{ rpaGroupName: string | null; entraGroupId: string }>
				applications: Map<string, { applicationId: string; applicationName: string; matchSource: "nais" | "manual" }>
			}
		>()

		for (const user of rpaUsers as SerializedRpaUser[]) {
			const existing = userMap.get(user.userObjectId)
			if (existing) {
				// Add group if not already listed
				if (!existing.groups.some((g) => g.entraGroupId === user.entraGroupId)) {
					existing.groups.push({ rpaGroupName: user.rpaGroupName, entraGroupId: user.entraGroupId })
				}
				// Add apps from this group — prefer "nais" source over "manual"
				for (const app of user.applications) {
					const existingApp = existing.applications.get(app.applicationId)
					if (!existingApp) {
						existing.applications.set(app.applicationId, app)
					} else if (existingApp.matchSource === "manual" && app.matchSource === "nais") {
						existing.applications.set(app.applicationId, app)
					}
				}
				// Prefer most recent sync data
				if (user.syncedAt > existing.syncedAt) {
					existing.displayName = user.displayName
					existing.userPrincipalName = user.userPrincipalName
					existing.accountEnabled = user.accountEnabled
					existing.syncedAt = user.syncedAt
				}
			} else {
				userMap.set(user.userObjectId, {
					userObjectId: user.userObjectId,
					displayName: user.displayName,
					userPrincipalName: user.userPrincipalName,
					accountEnabled: user.accountEnabled,
					syncedAt: user.syncedAt,
					groups: [{ rpaGroupName: user.rpaGroupName, entraGroupId: user.entraGroupId }],
					applications: new Map(user.applications.map((a) => [a.applicationId, a])),
				})
			}
		}

		return [...userMap.values()].map((u) => ({
			...u,
			applications: [...u.applications.values()],
		}))
	}, [rpaUsers])

	const filtered = useMemo(() => {
		const q = search.toLowerCase()
		let result = aggregatedUsers
		if (q) {
			result = result.filter(
				(u) =>
					u.displayName?.toLowerCase().includes(q) ||
					u.userPrincipalName?.toLowerCase().includes(q) ||
					u.groups.some((g) => g.rpaGroupName?.toLowerCase().includes(q)) ||
					u.applications.some((a) => a.applicationName.toLowerCase().includes(q)),
			)
		}
		if (sort) {
			result = [...result].sort((a, b) => {
				const dir = sort.direction === "ascending" ? 1 : -1
				switch (sort.orderBy) {
					case "displayName":
						return dir * (a.displayName ?? "").localeCompare(b.displayName ?? "", "nb")
					case "appCount":
						return dir * (a.applications.length - b.applications.length)
					case "accountEnabled": {
						const av = a.accountEnabled === true ? 1 : 0
						const bv = b.accountEnabled === true ? 1 : 0
						return dir * (av - bv)
					}
					default:
						return 0
				}
			})
		}
		return result
	}, [aggregatedUsers, search, sort])

	const latestSync =
		rpaUsers.length > 0
			? (rpaUsers as SerializedRpaUser[]).reduce(
					(latest, u) => (u.syncedAt > latest ? u.syncedAt : latest),
					(rpaUsers as SerializedRpaUser[])[0].syncedAt,
				)
			: null

	return (
		<VStack gap="space-8">
			<VStack gap="space-4">
				<Heading size="large" level="2">
					RPA-brukere — {seksjonName}
				</Heading>
				<BodyLong>
					Oversikt over RPA-brukere (robotbrukere) som har tilgang til applikasjoner i seksjonen. Tilgang resolves via
					Entra ID-grupper definert i Nais-manifestet eller manuelt lagt til.
				</BodyLong>
			</VStack>

			{aggregatedUsers.length === 0 ? (
				<BodyLong>Ingen RPA-brukere har tilgang til applikasjoner i denne seksjonen.</BodyLong>
			) : (
				<VStack gap="space-4">
					<HStack justify="space-between" align="end" wrap>
						<Search
							label="Søk etter RPA-bruker, gruppe eller applikasjon"
							hideLabel
							placeholder="Søk etter bruker, gruppe eller app…"
							value={search}
							onChange={setSearch}
							onClear={() => setSearch("")}
							size="small"
							style={{ maxWidth: "20rem" }}
						/>
						<HStack gap="space-4" align="center">
							<Detail textColor="subtle">
								{filtered.length} av {aggregatedUsers.length} brukere
							</Detail>
							{latestSync && <Detail textColor="subtle">Sist synkronisert: {formatDateTimeOslo(latestSync)}</Detail>}
						</HStack>
					</HStack>

					{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable table wrapper needs tabIndex for keyboard access */}
					<section className="table-scroll" tabIndex={0} aria-label="RPA-brukere i seksjonen">
						<Table
							size="small"
							sort={sort}
							onSortChange={(sortKey) =>
								setSort(
									sort?.orderBy === sortKey && sort.direction === "descending"
										? undefined
										: {
												orderBy: sortKey ?? "",
												direction:
													sort?.orderBy === sortKey && sort.direction === "ascending" ? "descending" : "ascending",
											},
								)
							}
						>
							<Table.Header>
								<Table.Row>
									<Table.ColumnHeader sortKey="displayName" sortable>
										Navn
									</Table.ColumnHeader>
									<Table.HeaderCell>UPN</Table.HeaderCell>
									<Table.ColumnHeader sortKey="accountEnabled" sortable>
										Status
									</Table.ColumnHeader>
									<Table.HeaderCell>RPA-grupper</Table.HeaderCell>
									<Table.ColumnHeader sortKey="appCount" sortable>
										Applikasjoner
									</Table.ColumnHeader>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{filtered.map((user) => (
									<Table.Row key={user.userObjectId}>
										<Table.DataCell>{user.displayName ?? "Ukjent"}</Table.DataCell>
										<Table.DataCell>{user.userPrincipalName ?? "—"}</Table.DataCell>
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
													<Detail key={g.entraGroupId}>{g.rpaGroupName ?? g.entraGroupId}</Detail>
												))}
											</VStack>
										</Table.DataCell>
										<Table.DataCell>
											<VStack gap="space-1">
												{user.applications.slice(0, 3).map((app) => (
													<HStack key={app.applicationId} gap="space-2" align="center">
														<Link to={`/applikasjoner/${app.applicationId}/detaljer?fane=autentisering`}>
															{app.applicationName}
														</Link>
														<Tag variant={app.matchSource === "nais" ? "info" : "warning"} size="xsmall">
															{app.matchSource === "nais" ? "Nais" : "Manuell"}
														</Tag>
													</HStack>
												))}
												{user.applications.length > 3 && (
													<Detail textColor="subtle">+{user.applications.length - 3} til</Detail>
												)}
											</VStack>
										</Table.DataCell>
									</Table.Row>
								))}
							</Table.Body>
						</Table>
					</section>
				</VStack>
			)}
		</VStack>
	)
}

export const ErrorBoundary = RouteErrorBoundary
export const _testing = { formatDateTimeOslo }
