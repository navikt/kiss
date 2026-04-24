import { ChevronRightIcon } from "@navikt/aksel-icons"
import {
	Link as AkselLink,
	Alert,
	BodyLong,
	BodyShort,
	Button,
	Detail,
	Heading,
	HStack,
	Select,
	Table,
	Tag,
	VStack,
} from "@navikt/ds-react"
import { Fragment } from "react"
import { Form, Link } from "react-router"
import { compliancePercent } from "~/lib/utils"
import { persistenceLabels, type TeamItem } from "../shared"

type SectionApp = {
	id: string
	name: string
	teams: string[]
	controlsImplemented: number
	controlsPartial: number
	controlsTotal: number
	linkedApps: Array<{ id: string; name: string }>
}

export function AlleApplikasjonerTab({
	sectionApps,
	teams,
	persistenceMap,
}: {
	sectionApps: SectionApp[]
	teams: TeamItem[]
	persistenceMap: Record<string, Array<{ type: string }>>
}) {
	return (
		<VStack gap="space-6">
			<Heading size="medium" level="3">
				Alle applikasjoner ({sectionApps.length})
			</Heading>
			<BodyLong>
				Oversikt over alle overvåkede applikasjoner i seksjonens Nais-team og deres compliance-status.
			</BodyLong>

			{sectionApps.length > 0 ? (
				/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */
				<section className="table-scroll" tabIndex={0} aria-label="Alle applikasjoner i seksjonen">
					<Table size="small">
						<Table.Header>
							<Table.Row>
								<Table.HeaderCell scope="col">Applikasjon</Table.HeaderCell>
								<Table.HeaderCell scope="col">Team</Table.HeaderCell>
								<Table.HeaderCell scope="col">Persistens</Table.HeaderCell>
								<Table.HeaderCell scope="col">Implementert</Table.HeaderCell>
								<Table.HeaderCell scope="col">Delvis</Table.HeaderCell>
								<Table.HeaderCell scope="col">Compliance</Table.HeaderCell>
								<Table.HeaderCell scope="col">Handling</Table.HeaderCell>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{sectionApps.map((app) => {
								const pct = compliancePercent(app.controlsImplemented, app.controlsPartial, app.controlsTotal)
								const linkedTeamSlugs = app.teams
								const availableTeams = teams.filter((t) => !t.archivedAt && !linkedTeamSlugs.includes(t.slug))
								const appPersistence = persistenceMap[app.id] ?? []
								const uniqueTypes = [...new Set(appPersistence.map((p) => p.type))]
								return (
									<Fragment key={app.id}>
										<Table.Row>
											<Table.DataCell>
												<AkselLink as={Link} to={`/applikasjoner/${app.id}/detaljer`}>
													{app.name}
												</AkselLink>
												{app.linkedApps.length > 0 && (
													/* TODO: flytt inline style til CSS module */
													<Detail as="span" style={{ marginLeft: "var(--ax-space-4)" }}>
														({app.linkedApps.length} koblet
														{app.linkedApps.length > 1 ? "e" : ""})
													</Detail>
												)}
											</Table.DataCell>
											<Table.DataCell>
												<HStack gap="space-2" wrap>
													{app.teams.map((teamSlug) => (
														<Tag key={teamSlug} variant="info" size="xsmall">
															{teamSlug}
														</Tag>
													))}
													{app.teams.length === 0 && "–"}
												</HStack>
											</Table.DataCell>
											<Table.DataCell>
												<HStack gap="space-1" wrap>
													{uniqueTypes.length > 0
														? uniqueTypes.map((type) => (
																<Tag key={type} variant="neutral" size="xsmall">
																	{persistenceLabels[type] ?? type}
																</Tag>
															))
														: "–"}
												</HStack>
											</Table.DataCell>
											<Table.DataCell>
												{app.controlsImplemented} / {app.controlsTotal}
											</Table.DataCell>
											<Table.DataCell>{app.controlsPartial}</Table.DataCell>
											<Table.DataCell>
												<Tag variant={pct >= 80 ? "success" : pct >= 50 ? "warning" : "error"} size="small">
													{pct}%
												</Tag>
											</Table.DataCell>
											<Table.DataCell>
												<HStack gap="space-2" align="center">
													<AkselLink as={Link} to={`/applikasjoner/${app.id}/compliance`}>
														Vurder
													</AkselLink>
													{availableTeams.length > 0 && (
														<Form method="post">
															<input type="hidden" name="intent" value="link-team" />
															<input type="hidden" name="applicationId" value={app.id} />
															<HStack gap="space-2" align="end">
																<Select label="Team" name="devTeamId" size="small" hideLabel>
																	<option value="">Velg …</option>
																	{availableTeams.map((t) => (
																		<option key={t.id} value={t.id}>
																			{t.name}
																		</option>
																	))}
																</Select>
																<Button type="submit" variant="secondary" size="xsmall">
																	Legg til team
																</Button>
															</HStack>
														</Form>
													)}
												</HStack>
											</Table.DataCell>
										</Table.Row>
										{app.linkedApps.map((child) => (
											<Table.Row key={child.id}>
												<Table.DataCell>
													{/* TODO: flytt inline style til CSS module */}
													<HStack gap="space-2" align="center" style={{ paddingLeft: "var(--ax-space-8)" }}>
														<ChevronRightIcon aria-hidden fontSize="1rem" />
														<AkselLink as={Link} to={`/applikasjoner/${child.id}/detaljer`}>
															<BodyShort size="small">{child.name}</BodyShort>
														</AkselLink>
													</HStack>
												</Table.DataCell>
												<Table.DataCell />
												<Table.DataCell />
												<Table.DataCell colSpan={3}>
													<Detail>Arver compliance fra {app.name}</Detail>
												</Table.DataCell>
												<Table.DataCell />
											</Table.Row>
										))}
									</Fragment>
								)
							})}
						</Table.Body>
					</Table>
				</section>
			) : (
				<Alert variant="info" size="small">
					Ingen applikasjoner funnet for seksjonens Nais-team.
				</Alert>
			)}
		</VStack>
	)
}
