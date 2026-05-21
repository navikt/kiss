import {
	Link as AkselLink,
	Alert,
	Button,
	Checkbox,
	Heading,
	HStack,
	Select,
	type SortState,
	Table,
	Tag,
	VStack,
} from "@navikt/ds-react"
import { useState } from "react"
import { Form, Link, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import type { loader } from "./loader.server"

export { action } from "./action.server"
export { loader } from "./loader.server"
export { RouteErrorBoundary as ErrorBoundary }

export default function ApplikasjonerUtenTeam() {
	const { sectionName, unassignedApps, teams, canManageAny } = useLoaderData<typeof loader>()
	const [selectedApps, setSelectedApps] = useState<string[]>([])
	const [appSort, setAppSort] = useState<SortState | undefined>({ orderBy: "appName", direction: "ascending" })

	const sortedUnassignedApps = [...unassignedApps].sort((a, b) => {
		if (!appSort) return 0
		const dir = appSort.direction === "ascending" ? 1 : -1
		const key = appSort.orderBy
		const valA = key === "environments" ? a.environments.join(", ") : String((a as Record<string, unknown>)[key] ?? "")
		const valB = key === "environments" ? b.environments.join(", ") : String((b as Record<string, unknown>)[key] ?? "")
		return valA.localeCompare(valB, "nb") * dir
	})

	return (
		<VStack gap="space-6">
			<HStack align="center" justify="space-between" wrap>
				<Heading size="xlarge" level="2" spacing>
					Applikasjoner uten team – {sectionName}
				</Heading>
			</HStack>

			{unassignedApps.length > 0 ? (
				<VStack gap="space-4">
					<Alert variant="warning" size="small">
						{unassignedApps.length} {unassignedApps.length === 1 ? "applikasjon" : "applikasjoner"} fra seksjonens
						Nais-team er ikke koblet til et utviklingsteam.
					</Alert>

					{canManageAny && teams.length > 0 && selectedApps.length > 0 && (
						<Form method="post">
							<input type="hidden" name="intent" value="bulk-assign-team" />
							{selectedApps.map((id) => (
								<input key={id} type="hidden" name="appId" value={id} />
							))}
							<HStack gap="space-4" align="end">
								<Select label="Utviklingsteam" name="teamId" size="small">
									<option value="">Velg team…</option>
									{teams.map((t) => (
										<option key={t.id} value={t.id}>
											{t.name}
										</option>
									))}
								</Select>
								<Button type="submit" variant="primary" size="small">
									Koble {selectedApps.length} {selectedApps.length === 1 ? "applikasjon" : "applikasjoner"} til team
								</Button>
							</HStack>
						</Form>
					)}

					{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */}
					<section className="table-scroll" tabIndex={0} aria-label="Applikasjoner uten team">
						<Table
							size="small"
							sort={appSort}
							onSortChange={(sortKey) =>
								setAppSort((prev) =>
									prev?.orderBy === sortKey && prev.direction === "ascending"
										? { orderBy: sortKey, direction: "descending" }
										: { orderBy: sortKey, direction: "ascending" },
								)
							}
						>
							<Table.Header>
								<Table.Row>
									{canManageAny && (
										<Table.HeaderCell scope="col">
											<Checkbox
												size="small"
												checked={selectedApps.length === unassignedApps.length && unassignedApps.length > 0}
												indeterminate={selectedApps.length > 0 && selectedApps.length < unassignedApps.length}
												onChange={(e) => setSelectedApps(e.target.checked ? unassignedApps.map((a) => a.appId) : [])}
												aria-label="Velg alle"
												hideLabel
											>
												Velg alle
											</Checkbox>
										</Table.HeaderCell>
									)}
									<Table.ColumnHeader sortKey="appName" sortable scope="col">
										Applikasjon
									</Table.ColumnHeader>
									<Table.ColumnHeader sortKey="naisTeamSlug" sortable scope="col">
										Nais-team
									</Table.ColumnHeader>
									<Table.ColumnHeader sortKey="environments" sortable scope="col">
										Miljø
									</Table.ColumnHeader>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{sortedUnassignedApps.map((app) => (
									<Table.Row key={app.appId}>
										{canManageAny && (
											<Table.DataCell>
												<Checkbox
													size="small"
													checked={selectedApps.includes(app.appId)}
													onChange={(e) =>
														setSelectedApps((prev) =>
															e.target.checked ? [...prev, app.appId] : prev.filter((id) => id !== app.appId),
														)
													}
													aria-label={`Velg ${app.appName}`}
													hideLabel
												>
													{app.appName}
												</Checkbox>
											</Table.DataCell>
										)}
										<Table.DataCell>
											<AkselLink as={Link} to={`/applikasjoner/${app.appId}/detaljer`}>
												{app.appName}
											</AkselLink>
										</Table.DataCell>
										<Table.DataCell>
											<Tag variant="info" size="small">
												{app.naisTeamSlug}
											</Tag>
										</Table.DataCell>
										<Table.DataCell>{app.environments.join(", ")}</Table.DataCell>
									</Table.Row>
								))}
							</Table.Body>
						</Table>
					</section>
				</VStack>
			) : (
				<Alert variant="success" size="small">
					Alle applikasjoner fra seksjonens Nais-team er tilknyttet et utviklingsteam.
				</Alert>
			)}
		</VStack>
	)
}
