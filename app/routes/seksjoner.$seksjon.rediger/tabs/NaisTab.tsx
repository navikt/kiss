import { PlusIcon } from "@navikt/aksel-icons"
import {
	Link as AkselLink,
	Alert,
	BodyShort,
	Button,
	Heading,
	HStack,
	Modal,
	Search,
	Table,
	Tag,
	VStack,
} from "@navikt/ds-react"
import { useRef, useState } from "react"
import { Form, Link } from "react-router"
import type { LinkedNaisTeam, SectionEnvironment, UnlinkedNaisTeam } from "../shared"

export function NaisTab({
	linkedNaisTeams,
	unlinkedNaisTeams,
	sectionEnvironments,
	allKnownClusters,
	onRequestUnlink,
}: {
	linkedNaisTeams: LinkedNaisTeam[]
	unlinkedNaisTeams: UnlinkedNaisTeam[]
	sectionEnvironments: SectionEnvironment[]
	allKnownClusters: string[]
	onRequestUnlink: (team: LinkedNaisTeam) => void
}) {
	const addTeamModalRef = useRef<HTMLDialogElement>(null)
	const addEnvModalRef = useRef<HTMLDialogElement>(null)
	const [search, setSearch] = useState("")
	const [selectedSlug, setSelectedSlug] = useState<string | null>(null)

	const filteredTeams = unlinkedNaisTeams.filter((t) => {
		const q = search.toLowerCase()
		return t.slug.toLowerCase().includes(q) || t.displayName?.toLowerCase().includes(q)
	})

	const registeredClusters = new Map(sectionEnvironments.map((e) => [e.cluster, e.included]))

	const activeClusters = sectionEnvironments.filter((e) => e.included)
	const inactiveClusters = allKnownClusters
		.filter((c) => !registeredClusters.get(c))
		.sort((a, b) => a.localeCompare(b, "nb"))

	function openAddTeamModal() {
		setSearch("")
		setSelectedSlug(null)
		addTeamModalRef.current?.showModal()
	}

	return (
		<VStack gap="space-8">
			<VStack gap="space-4">
				<HStack justify="space-between" align="center">
					<Heading size="medium" level="3">
						Nais-miljø
					</Heading>
					{inactiveClusters.length > 0 && (
						<Button
							variant="secondary"
							size="small"
							icon={<PlusIcon aria-hidden />}
							onClick={() => addEnvModalRef.current?.showModal()}
						>
							Legg til Nais-miljø
						</Button>
					)}
				</HStack>

				{activeClusters.length === 0 ? (
					allKnownClusters.length === 0 ? (
						<Alert variant="info" size="small">
							Ingen miljøer er registrert i systemet ennå. Kjør Nais-sync for å oppdage miljøer.
						</Alert>
					) : (
						<Alert variant="info" size="small">
							Ingen miljøer er aktive. Aktiver minst ett produksjonsmiljø for at applikasjoner skal vises og telles med
							i compliance og rapporter.
						</Alert>
					)
				) : (
					/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */
					<section className="table-scroll" tabIndex={0} aria-label="Aktive Nais-miljøer">
						<Table size="small">
							<Table.Header>
								<Table.Row>
									<Table.HeaderCell scope="col">Miljø</Table.HeaderCell>
									<Table.HeaderCell scope="col" />
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{activeClusters.map((env) => (
									<Table.Row key={env.cluster}>
										<Table.DataCell>{env.cluster}</Table.DataCell>
										<Table.DataCell align="right">
											<Form method="post">
												<input type="hidden" name="intent" value="toggle-environment" />
												<input type="hidden" name="cluster" value={env.cluster} />
												<input type="hidden" name="enabled" value="false" />
												<Button type="submit" variant="tertiary-neutral" size="xsmall">
													Deaktiver
												</Button>
											</Form>
										</Table.DataCell>
									</Table.Row>
								))}
							</Table.Body>
						</Table>
					</section>
				)}
			</VStack>

			<VStack gap="space-4">
				<HStack justify="space-between" align="center">
					<Heading size="medium" level="3">
						Nais-team
					</Heading>
					{unlinkedNaisTeams.length > 0 && (
						<Button variant="secondary" size="small" icon={<PlusIcon aria-hidden />} onClick={openAddTeamModal}>
							Legg til Nais-team
						</Button>
					)}
				</HStack>

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
			</VStack>

			<Modal ref={addEnvModalRef} header={{ heading: "Legg til Nais-miljø" }} width="medium">
				<Modal.Body>
					<VStack gap="space-4">
						<BodyShort>
							Applikasjoner som kun finnes i deaktiverte miljøer vil ikke telle med i team, compliance-oppsummering
							eller applikasjonslister.
						</BodyShort>
						<Alert variant="warning" size="small">
							Krav i KISS er foreløpig kun knyttet til produksjonsmiljøer. Vi anbefaler at du kun aktiverer{" "}
							<strong>prod-gcp</strong> og eventuelt <strong>prod-fss</strong>.
						</Alert>
						{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */}
						<section className="table-scroll table-scroll-modal" tabIndex={0} aria-label="Tilgjengelige Nais-miljøer">
							<Table size="small">
								<Table.Header>
									<Table.Row>
										<Table.HeaderCell scope="col">Miljø</Table.HeaderCell>
										<Table.HeaderCell scope="col" />
									</Table.Row>
								</Table.Header>
								<Table.Body>
									{inactiveClusters.map((cluster) => (
										<Table.Row key={cluster}>
											<Table.DataCell>{cluster}</Table.DataCell>
											<Table.DataCell align="right">
												<Form method="post" onSubmit={() => addEnvModalRef.current?.close()}>
													<input type="hidden" name="intent" value="toggle-environment" />
													<input type="hidden" name="cluster" value={cluster} />
													<input type="hidden" name="enabled" value="true" />
													<Button type="submit" variant="primary" size="xsmall" icon={<PlusIcon aria-hidden />}>
														Aktiver
													</Button>
												</Form>
											</Table.DataCell>
										</Table.Row>
									))}
								</Table.Body>
							</Table>
						</section>
					</VStack>
				</Modal.Body>
				<Modal.Footer>
					<Button type="button" variant="secondary" size="small" onClick={() => addEnvModalRef.current?.close()}>
						Lukk
					</Button>
				</Modal.Footer>
			</Modal>

			<Modal ref={addTeamModalRef} header={{ heading: "Legg til Nais-team" }} width="medium">
				<Modal.Body>
					<VStack gap="space-4">
						<Search
							label="Søk etter team"
							size="small"
							value={search}
							onChange={(value) => {
								setSearch(value)
								if (selectedSlug) {
									const q = value.toLowerCase()
									const stillVisible = unlinkedNaisTeams.some(
										(t) =>
											t.slug === selectedSlug &&
											(t.slug.toLowerCase().includes(q) || t.displayName?.toLowerCase().includes(q)),
									)
									if (!stillVisible) setSelectedSlug(null)
								}
							}}
							onClear={() => {
								setSearch("")
							}}
						/>
						<BodyShort size="small" style={{ color: "var(--ax-text-subtle)" }}>
							{filteredTeams.length} av {unlinkedNaisTeams.length} team
						</BodyShort>
						{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */}
						<section className="table-scroll table-scroll-modal" tabIndex={0} aria-label="Tilgjengelige Nais-team">
							<Table size="small">
								<Table.Header>
									<Table.Row>
										<Table.HeaderCell scope="col">Team</Table.HeaderCell>
										<Table.HeaderCell scope="col">Beskrivelse</Table.HeaderCell>
									</Table.Row>
								</Table.Header>
								<Table.Body>
									{filteredTeams.length === 0 ? (
										<Table.Row>
											<Table.DataCell colSpan={2}>Ingen team matcher søket.</Table.DataCell>
										</Table.Row>
									) : (
										filteredTeams.map((nt) => (
											<Table.Row
												key={nt.slug}
												selected={selectedSlug === nt.slug}
												onClick={() => setSelectedSlug(nt.slug)}
												style={{ cursor: "pointer" }}
											>
												<Table.DataCell>{nt.slug}</Table.DataCell>
												<Table.DataCell>
													{nt.displayName && nt.displayName !== nt.slug ? nt.displayName : ""}
												</Table.DataCell>
											</Table.Row>
										))
									)}
								</Table.Body>
							</Table>
						</section>
					</VStack>
				</Modal.Body>
				<Modal.Footer>
					<Form method="post" onSubmit={() => addTeamModalRef.current?.close()}>
						<input type="hidden" name="intent" value="link-nais-team" />
						<input type="hidden" name="naisTeamSlug" value={selectedSlug ?? ""} />
						<HStack gap="space-4">
							<Button type="button" variant="secondary" size="small" onClick={() => addTeamModalRef.current?.close()}>
								Avbryt
							</Button>
							<Button
								type="submit"
								variant="primary"
								size="small"
								disabled={!selectedSlug}
								icon={<PlusIcon aria-hidden />}
							>
								Legg til
							</Button>
						</HStack>
					</Form>
				</Modal.Footer>
			</Modal>
		</VStack>
	)
}
