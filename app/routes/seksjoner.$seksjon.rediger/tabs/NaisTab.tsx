import { PlusIcon } from "@navikt/aksel-icons"
import {
	Link as AkselLink,
	Alert,
	BodyShort,
	Button,
	Heading,
	HStack,
	Select,
	Table,
	Tag,
	VStack,
} from "@navikt/ds-react"
import { Form, Link } from "react-router"
import type { LinkedNaisTeam, SectionEnvironment, UnlinkedNaisTeam } from "../shared"

export function NaisTab({
	linkedNaisTeams,
	unlinkedNaisTeams,
	sectionEnvironments,
	onRequestUnlink,
}: {
	linkedNaisTeams: LinkedNaisTeam[]
	unlinkedNaisTeams: UnlinkedNaisTeam[]
	sectionEnvironments: SectionEnvironment[]
	onRequestUnlink: (team: LinkedNaisTeam) => void
}) {
	return (
		<VStack gap="space-8">
			<VStack gap="space-4">
				<Heading size="medium" level="3">
					Koblede Nais-team ({linkedNaisTeams.length})
				</Heading>

				{linkedNaisTeams.length > 0 ? (
					/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */
					<section className="table-scroll" tabIndex={0} aria-label="Koblede Nais-team">
						<Table size="small">
							<Table.Header>
								<Table.Row>
									<Table.HeaderCell scope="col">Nais-team</Table.HeaderCell>
									<Table.HeaderCell scope="col">Utviklingsteam</Table.HeaderCell>
									<Table.HeaderCell scope="col" />
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{linkedNaisTeams.map((nt) => (
									<Table.Row key={nt.slug}>
										<Table.DataCell>
											<AkselLink as={Link} to={`/admin/nais-overvaking/${nt.slug}`}>
												{nt.slug}
											</AkselLink>
											{nt.displayName && nt.displayName !== nt.slug && <> ({nt.displayName})</>}
										</Table.DataCell>
										<Table.DataCell>
											{nt.devTeamId ? (
												<Tag variant="success" size="small">
													Tilknyttet
												</Tag>
											) : (
												<Tag variant="warning" size="small">
													Ikke tilknyttet
												</Tag>
											)}
										</Table.DataCell>
										<Table.DataCell align="right">
											<Button variant="tertiary-neutral" size="xsmall" onClick={() => onRequestUnlink(nt)}>
												Fjern fra seksjon
											</Button>
										</Table.DataCell>
									</Table.Row>
								))}
							</Table.Body>
						</Table>
					</section>
				) : (
					<Alert variant="info" size="small">
						Ingen Nais-team er koblet til denne seksjonen ennå.
					</Alert>
				)}

				{unlinkedNaisTeams.length > 0 && (
					<Form method="post">
						<input type="hidden" name="intent" value="link-nais-team" />
						<HStack gap="space-4" align="end">
							<Select label="Legg til Nais-team" name="naisTeamSlug" size="small">
								<option value="">Velg team…</option>
								{unlinkedNaisTeams.map((nt) => (
									<option key={nt.slug} value={nt.slug}>
										{nt.slug}
										{nt.displayName && nt.displayName !== nt.slug ? ` (${nt.displayName})` : ""}
									</option>
								))}
							</Select>
							<Button type="submit" variant="secondary" size="small" icon={<PlusIcon aria-hidden />}>
								Legg til
							</Button>
						</HStack>
					</Form>
				)}
			</VStack>

			<VStack gap="space-4">
				<Heading size="medium" level="3">
					Miljøfilter
				</Heading>
				<BodyShort>
					Velg hvilke Nais-miljøer som skal inkluderes. Applikasjoner som kun finnes i deaktiverte miljøer vil ikke
					telle med i team, compliance-oppsummering eller applikasjonslister.
				</BodyShort>
				{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */}
				<section className="table-scroll" tabIndex={0} aria-label="Miljøfilter">
					<Table size="small">
						<Table.Header>
							<Table.Row>
								<Table.HeaderCell scope="col">Miljø</Table.HeaderCell>
								<Table.HeaderCell scope="col">Status</Table.HeaderCell>
								<Table.HeaderCell scope="col" />
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{sectionEnvironments.length === 0 ? (
								<Table.Row>
									<Table.DataCell colSpan={3}>
										Ingen miljøer registrert ennå. Kjør Nais-sync for å oppdage miljøer.
									</Table.DataCell>
								</Table.Row>
							) : (
								sectionEnvironments.map(({ cluster, included }) => (
									<Table.Row key={cluster}>
										<Table.DataCell>{cluster}</Table.DataCell>
										<Table.DataCell>
											{included ? (
												<Tag variant="success" size="small">
													Aktiv
												</Tag>
											) : (
												<Tag variant="neutral" size="small">
													Deaktivert
												</Tag>
											)}
										</Table.DataCell>
										<Table.DataCell align="right">
											<Form method="post">
												<input type="hidden" name="intent" value="toggle-environment" />
												<input type="hidden" name="cluster" value={cluster} />
												<input type="hidden" name="enabled" value={included ? "false" : "true"} />
												<Button type="submit" variant="tertiary-neutral" size="xsmall">
													{included ? "Deaktiver" : "Aktiver"}
												</Button>
											</Form>
										</Table.DataCell>
									</Table.Row>
								))
							)}
						</Table.Body>
					</Table>
				</section>
			</VStack>
		</VStack>
	)
}
