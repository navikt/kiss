import {
	Link as AkselLink,
	Alert,
	Button,
	Checkbox,
	Heading,
	HStack,
	ReadMore,
	Select,
	type SortState,
	Table,
	Tag,
	VStack,
} from "@navikt/ds-react"
import { useState } from "react"
import { Form, Link } from "react-router"
import type { IgnoredApp, TeamItem, UnassignedApp } from "../shared"

export function ApplikasjonerUtenTeamTab({
	unassignedApps,
	ignoredApps,
	teams,
}: {
	unassignedApps: UnassignedApp[]
	ignoredApps: IgnoredApp[]
	teams: TeamItem[]
}) {
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
		<VStack gap="space-8">
			<VStack gap="space-4">
				<Heading size="medium" level="3">
					Applikasjoner uten team ({unassignedApps.length})
				</Heading>

				{unassignedApps.length > 0 ? (
					<>
						<Alert variant="warning" size="small">
							{unassignedApps.length} {unassignedApps.length === 1 ? "applikasjon" : "applikasjoner"} fra seksjonens
							Nais-team er ikke koblet til et utviklingsteam.
						</Alert>
						{teams.length > 0 && selectedApps.length > 0 && (
							<Form method="post">
								<input type="hidden" name="intent" value="bulk-assign-team" />
								{selectedApps.map((id) => (
									<input key={id} type="hidden" name="appId" value={id} />
								))}
								<HStack gap="space-4" align="end">
									<Select label="Utviklingsteam" name="teamId" size="small">
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
										<Table.ColumnHeader sortKey="appName" sortable scope="col">
											Applikasjon
										</Table.ColumnHeader>
										<Table.ColumnHeader sortKey="naisTeamSlug" sortable scope="col">
											Nais-team
										</Table.ColumnHeader>
										<Table.ColumnHeader sortKey="environments" sortable scope="col">
											Miljø
										</Table.ColumnHeader>
										<Table.HeaderCell scope="col" />
									</Table.Row>
								</Table.Header>
								<Table.Body>
									{sortedUnassignedApps.map((app) => (
										<Table.Row key={app.appId}>
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
											<Table.DataCell align="right">
												<Form method="post">
													<input type="hidden" name="intent" value="ignore-app" />
													<input type="hidden" name="applicationId" value={app.appId} />
													<Button type="submit" variant="tertiary-neutral" size="xsmall">
														Ignorer
													</Button>
												</Form>
											</Table.DataCell>
										</Table.Row>
									))}
								</Table.Body>
							</Table>
						</section>
					</>
				) : (
					<Alert variant="success" size="small">
						Alle applikasjoner fra seksjonens Nais-team er tilknyttet et utviklingsteam.
					</Alert>
				)}
			</VStack>

			{ignoredApps.length > 0 && (
				<ReadMore header={`Ignorerte applikasjoner (${ignoredApps.length})`}>
					{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */}
					<section className="table-scroll" tabIndex={0} aria-label="Ignorerte applikasjoner">
						<Table size="small">
							<Table.Header>
								<Table.Row>
									<Table.HeaderCell scope="col">Applikasjon</Table.HeaderCell>
									<Table.HeaderCell scope="col">Begrunnelse</Table.HeaderCell>
									<Table.HeaderCell scope="col">Ignorert av</Table.HeaderCell>
									<Table.HeaderCell scope="col" />
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{ignoredApps.map((app) => (
									<Table.Row key={app.appId}>
										<Table.DataCell>{app.appName}</Table.DataCell>
										<Table.DataCell>{app.reason || "–"}</Table.DataCell>
										<Table.DataCell>{app.ignoredBy}</Table.DataCell>
										<Table.DataCell align="right">
											<Form method="post">
												<input type="hidden" name="intent" value="unignore-app" />
												<input type="hidden" name="applicationId" value={app.appId} />
												<Button type="submit" variant="tertiary-neutral" size="xsmall">
													Gjenopprett
												</Button>
											</Form>
										</Table.DataCell>
									</Table.Row>
								))}
							</Table.Body>
						</Table>
					</section>
				</ReadMore>
			)}
		</VStack>
	)
}
