import { PencilIcon, PlusIcon, TrashIcon } from "@navikt/aksel-icons"
import {
	Link as AkselLink,
	Alert,
	BodyLong,
	BodyShort,
	Button,
	Heading,
	HStack,
	Modal,
	ReadMore,
	Select,
	Table,
	Tabs,
	Tag,
	Textarea,
	TextField,
	VStack,
} from "@navikt/ds-react"
import { useRef, useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, Link, redirect, useLoaderData, useSearchParams } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import {
	getIgnoredAppsForSection,
	getLinkCandidatesForSection,
	getNaisTeamsForSection,
	getUnassignedAppsForSection,
	getUnlinkedNaisTeams,
	ignoreAppForSection,
	linkNaisTeamToSection,
	unignoreAppForSection,
	unlinkNaisTeamFromSection,
} from "~/db/queries/nais.server"
import {
	createTeam,
	deleteTeam,
	getSectionDetail,
	getTeamsForSection,
	updateSection,
	updateTeam,
} from "~/db/queries/sections.server"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { requireAdmin } from "~/lib/authorization.server"

export async function loader({ request, params }: LoaderFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	requireAdmin(authedUser)

	const seksjon = params.seksjon
	if (!seksjon) throw new Response("Mangler seksjon", { status: 400 })

	const result = await getSectionDetail(seksjon)
	if (!result) throw new Response("Seksjon ikke funnet", { status: 404 })

	const sectionId = result.section.id

	const [teams, linkedNaisTeams, unlinkedNaisTeams, unassignedApps, ignoredApps, linkCandidates] = await Promise.all([
		getTeamsForSection(sectionId),
		getNaisTeamsForSection(sectionId),
		getUnlinkedNaisTeams(),
		getUnassignedAppsForSection(sectionId),
		getIgnoredAppsForSection(sectionId),
		getLinkCandidatesForSection(sectionId),
	])

	return data({
		section: {
			id: sectionId,
			name: result.section.name,
			slug: result.section.slug,
			description: result.section.description,
		},
		teams: teams.map((t) => ({ id: t.id, name: t.name, slug: t.slug, description: t.description })),
		linkedNaisTeams: linkedNaisTeams.map((t) => ({
			slug: t.slug,
			displayName: t.displayName,
			devTeamId: t.devTeamId,
		})),
		unlinkedNaisTeams: unlinkedNaisTeams.map((t) => ({
			slug: t.slug,
			displayName: t.displayName,
		})),
		unassignedApps,
		ignoredApps: ignoredApps.map((a) => ({
			appId: a.appId,
			appName: a.appName,
			reason: a.reason,
			ignoredBy: a.ignoredBy,
			ignoredAt: a.ignoredAt?.toISOString() ?? null,
		})),
		linkCandidates: linkCandidates.map((c) => ({
			matchType: c.matchType,
			confidence: c.confidence,
			apps: c.apps,
		})),
		seksjon,
	})
}

function redirectToTab(seksjon: string, tab: string) {
	return redirect(`/seksjoner/${seksjon}/rediger?fane=${tab}`)
}

export async function action({ request, params }: ActionFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	requireAdmin(authedUser)

	const seksjon = params.seksjon
	if (!seksjon) throw new Response("Mangler seksjon", { status: 400 })

	const result = await getSectionDetail(seksjon)
	if (!result) throw new Response("Seksjon ikke funnet", { status: 404 })

	const formData = await request.formData()
	const intent = formData.get("intent") as string
	const userId = authedUser.navIdent

	if (intent === "update-section") {
		const name = (formData.get("name") as string)?.trim()
		const description = (formData.get("description") as string)?.trim() || null
		if (!name) throw new Response("Navn er påkrevd", { status: 400 })
		const updated = await updateSection(result.section.id, name, description, userId)
		return redirectToTab(updated.slug, "seksjon")
	}

	if (intent === "create-team") {
		const name = (formData.get("name") as string)?.trim()
		const description = (formData.get("description") as string)?.trim() || null
		if (!name) throw new Response("Teamnavn er påkrevd", { status: 400 })
		await createTeam(result.section.id, name, description, userId)
		return redirectToTab(seksjon, "team")
	}

	if (intent === "update-team") {
		const teamId = formData.get("teamId") as string
		const name = (formData.get("name") as string)?.trim()
		const description = (formData.get("description") as string)?.trim() || null
		if (!teamId || !name) throw new Response("Mangler påkrevde felt", { status: 400 })
		await updateTeam(teamId, name, description, userId)
		return redirectToTab(seksjon, "team")
	}

	if (intent === "delete-team") {
		const teamId = formData.get("teamId") as string
		if (!teamId) throw new Response("Mangler team-ID", { status: 400 })
		await deleteTeam(teamId, userId)
		return redirectToTab(seksjon, "team")
	}

	if (intent === "link-nais-team") {
		const naisTeamSlug = formData.get("naisTeamSlug") as string
		if (!naisTeamSlug) throw new Response("Mangler Nais-team", { status: 400 })
		await linkNaisTeamToSection(naisTeamSlug, result.section.id, userId)
		return redirectToTab(seksjon, "nais")
	}

	if (intent === "unlink-nais-team") {
		const naisTeamSlug = formData.get("naisTeamSlug") as string
		if (!naisTeamSlug) throw new Response("Mangler Nais-team", { status: 400 })
		await unlinkNaisTeamFromSection(naisTeamSlug, userId)
		return redirectToTab(seksjon, "nais")
	}

	if (intent === "ignore-app") {
		const applicationId = formData.get("applicationId") as string
		if (!applicationId) throw new Response("Mangler applikasjon", { status: 400 })
		const reason = formData.get("reason")
		await ignoreAppForSection(result.section.id, applicationId, userId, typeof reason === "string" ? reason : undefined)
		return redirectToTab(seksjon, "apper")
	}

	if (intent === "unignore-app") {
		const applicationId = formData.get("applicationId") as string
		if (!applicationId) throw new Response("Mangler applikasjon", { status: 400 })
		await unignoreAppForSection(result.section.id, applicationId, userId)
		return redirectToTab(seksjon, "apper")
	}

	throw new Response("Ugyldig handling", { status: 400 })
}

export default function RedigerSeksjon() {
	const { section, teams, linkedNaisTeams, unlinkedNaisTeams, unassignedApps, ignoredApps, linkCandidates, seksjon } =
		useLoaderData<typeof loader>()
	const [searchParams, setSearchParams] = useSearchParams()
	const activeTab = searchParams.get("fane") ?? "seksjon"

	const teamFormRef = useRef<HTMLFormElement>(null)
	const editTeamModalRef = useRef<HTMLDialogElement>(null)
	const deleteTeamModalRef = useRef<HTMLDialogElement>(null)
	const unlinkNaisModalRef = useRef<HTMLDialogElement>(null)
	const [editingTeam, setEditingTeam] = useState<(typeof teams)[number] | null>(null)
	const [deletingTeam, setDeletingTeam] = useState<(typeof teams)[number] | null>(null)
	const [unlinkingNaisTeam, setUnlinkingNaisTeam] = useState<(typeof linkedNaisTeams)[number] | null>(null)

	return (
		<VStack gap="space-6">
			<div>
				<Link to={`/seksjoner/${seksjon}`}>← Tilbake til seksjon</Link>
				<Heading size="xlarge" level="2" spacing>
					Rediger seksjon: {section.name}
				</Heading>
			</div>

			<Tabs value={activeTab} onChange={(tab) => setSearchParams({ fane: tab }, { replace: true })}>
				<Tabs.List>
					<Tabs.Tab value="seksjon" label="Seksjon" />
					<Tabs.Tab value="team" label={`Utviklingsteam (${teams.length})`} />
					<Tabs.Tab value="nais" label={`Nais-team (${linkedNaisTeams.length})`} />
					<Tabs.Tab
						value="apper"
						label={`Apper uten team (${unassignedApps.length})${unassignedApps.length > 0 ? " ⚠" : ""}`}
					/>
					<Tabs.Tab
						value="kobling"
						label={`Koblingsforslag (${linkCandidates.length})${linkCandidates.length > 0 ? " 🔗" : ""}`}
					/>
				</Tabs.List>

				{/* Tab: Seksjon */}
				<Tabs.Panel value="seksjon" style={{ paddingTop: "var(--ax-space-6)" }}>
					<VStack gap="space-8">
						<VStack gap="space-6">
							<Heading size="medium" level="3">
								Seksjonsinformasjon
							</Heading>
							<Form method="post">
								<input type="hidden" name="intent" value="update-section" />
								<VStack gap="space-6" style={{ maxWidth: "40rem" }}>
									<TextField label="Navn" name="name" defaultValue={section.name} autoComplete="off" />
									<Textarea
										label="Beskrivelse"
										name="description"
										defaultValue={section.description ?? ""}
										minRows={3}
									/>
									<div>
										<Button type="submit" variant="primary" size="small" icon={<PencilIcon aria-hidden />}>
											Lagre endringer
										</Button>
									</div>
								</VStack>
							</Form>
						</VStack>

						<VStack gap="space-4">
							<Heading size="medium" level="3">
								Relatert
							</Heading>
							<HStack gap="space-4">
								<Button as={Link} to={`/seksjoner/${seksjon}/screening`} variant="secondary" size="small">
									Screening-spørsmål
								</Button>
							</HStack>
						</VStack>
					</VStack>
				</Tabs.Panel>

				{/* Tab: Utviklingsteam */}
				<Tabs.Panel value="team" style={{ paddingTop: "var(--ax-space-6)" }}>
					<VStack gap="space-6">
						{teams.length > 0 && (
							/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */
							<section className="table-scroll" tabIndex={0} aria-label={`Team i ${section.name}`}>
								<Table size="small">
									<Table.Header>
										<Table.Row>
											<Table.HeaderCell scope="col">Team</Table.HeaderCell>
											<Table.HeaderCell scope="col">Beskrivelse</Table.HeaderCell>
											<Table.HeaderCell scope="col" />
										</Table.Row>
									</Table.Header>
									<Table.Body>
										{teams.map((team) => (
											<Table.Row key={team.id}>
												<Table.DataCell>{team.name}</Table.DataCell>
												<Table.DataCell>{team.description ?? "–"}</Table.DataCell>
												<Table.DataCell align="right">
													<HStack gap="space-2" justify="end">
														<Button
															variant="tertiary"
															size="xsmall"
															onClick={() => {
																setEditingTeam(team)
																editTeamModalRef.current?.showModal()
															}}
														>
															Rediger
														</Button>
														<Button
															variant="tertiary-neutral"
															size="xsmall"
															onClick={() => {
																setDeletingTeam(team)
																deleteTeamModalRef.current?.showModal()
															}}
														>
															Slett
														</Button>
													</HStack>
												</Table.DataCell>
											</Table.Row>
										))}
									</Table.Body>
								</Table>
							</section>
						)}

						{teams.length === 0 && <BodyLong>Ingen team er opprettet i denne seksjonen.</BodyLong>}

						<Form
							method="post"
							ref={teamFormRef}
							onSubmit={() => {
								setTimeout(() => teamFormRef.current?.reset(), 0)
							}}
						>
							<input type="hidden" name="intent" value="create-team" />
							<VStack gap="space-4">
								<Heading size="small" level="4">
									Legg til team
								</Heading>
								<HStack gap="space-4" align="end">
									<TextField label="Teamnavn" name="name" size="small" autoComplete="off" />
									<TextField label="Beskrivelse" name="description" size="small" autoComplete="off" />
									<Button type="submit" variant="secondary" size="small" icon={<PlusIcon aria-hidden />}>
										Legg til
									</Button>
								</HStack>
							</VStack>
						</Form>
					</VStack>
				</Tabs.Panel>

				{/* Tab: Nais-team */}
				<Tabs.Panel value="nais" style={{ paddingTop: "var(--ax-space-6)" }}>
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
														<AkselLink as={Link} to={`/nais-overvaking/${nt.slug}`}>
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
														<Button
															variant="tertiary-neutral"
															size="xsmall"
															onClick={() => {
																setUnlinkingNaisTeam(nt)
																unlinkNaisModalRef.current?.showModal()
															}}
														>
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
					</VStack>
				</Tabs.Panel>

				{/* Tab: Apper uten team */}
				<Tabs.Panel value="apper" style={{ paddingTop: "var(--ax-space-6)" }}>
					<VStack gap="space-8">
						<VStack gap="space-4">
							<Heading size="medium" level="3">
								Applikasjoner uten team ({unassignedApps.length})
							</Heading>

							{unassignedApps.length > 0 ? (
								<>
									<Alert variant="warning" size="small">
										{unassignedApps.length} {unassignedApps.length === 1 ? "applikasjon" : "applikasjoner"} fra
										seksjonens Nais-team er ikke koblet til et utviklingsteam.
									</Alert>
									{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */}
									<section className="table-scroll" tabIndex={0} aria-label="Applikasjoner uten team">
										<Table size="small">
											<Table.Header>
												<Table.Row>
													<Table.HeaderCell scope="col">Applikasjon</Table.HeaderCell>
													<Table.HeaderCell scope="col">Nais-team</Table.HeaderCell>
													<Table.HeaderCell scope="col">Miljø</Table.HeaderCell>
													<Table.HeaderCell scope="col" />
												</Table.Row>
											</Table.Header>
											<Table.Body>
												{unassignedApps.map((app) => (
													<Table.Row key={app.appId}>
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
				</Tabs.Panel>

				{/* Tab: Koblingsforslag */}
				<Tabs.Panel value="kobling" style={{ paddingTop: "var(--ax-space-6)" }}>
					<VStack gap="space-6">
						<Heading size="medium" level="3">
							Koblingsforslag ({linkCandidates.length})
						</Heading>

						{linkCandidates.length > 0 ? (
							<>
								<Alert variant="info" size="small">
									Disse applikasjonene har blitt identifisert som mulige paraply-koblinger basert på felles Docker-image
									eller navnemønster.
								</Alert>
								<VStack gap="space-4">
									{linkCandidates.map((candidate) => {
										const prodApp = candidate.apps.find((a) => a.isProd) ?? candidate.apps[0]
										const otherApps = candidate.apps.filter((a) => a.id !== prodApp.id)
										return (
											<div
												key={candidate.apps.map((a) => a.id).join(",")}
												style={{
													border: "1px solid var(--ax-border-default)",
													borderRadius: "var(--ax-border-radius-medium)",
													padding: "var(--ax-space-4)",
												}}
											>
												<VStack gap="space-2">
													<HStack gap="space-4" align="center">
														<Heading size="small" level="4">
															<AkselLink as={Link} to={`/applikasjoner/${prodApp.id}/detaljer`}>
																{prodApp.name}
															</AkselLink>
														</Heading>
														<Tag
															variant={
																candidate.matchType === "both"
																	? "success"
																	: candidate.matchType === "image_match"
																		? "info"
																		: "warning"
															}
															size="xsmall"
														>
															{candidate.matchType === "both"
																? "Image + navnemønster"
																: candidate.matchType === "image_match"
																	? "Felles image"
																	: "Navnemønster"}
														</Tag>
														<Tag variant="neutral" size="xsmall">
															{Math.round(candidate.confidence * 100)}% sannsynlighet
														</Tag>
													</HStack>
													<BodyShort size="small">Mulige koblinger ({otherApps.length}):</BodyShort>
													{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */}
													<section className="table-scroll" tabIndex={0} aria-label="Koblingsforslag">
														<Table size="small">
															<Table.Header>
																<Table.Row>
																	<Table.HeaderCell scope="col">Applikasjon</Table.HeaderCell>
																	<Table.HeaderCell scope="col">Miljø</Table.HeaderCell>
																	<Table.HeaderCell scope="col">Status</Table.HeaderCell>
																</Table.Row>
															</Table.Header>
															<Table.Body>
																{otherApps.map((app) => (
																	<Table.Row key={app.id}>
																		<Table.DataCell>
																			<AkselLink as={Link} to={`/applikasjoner/${app.id}/detaljer`}>
																				{app.name}
																			</AkselLink>
																		</Table.DataCell>
																		<Table.DataCell>
																			<Tag variant="info" size="xsmall">
																				{app.cluster}
																			</Tag>
																		</Table.DataCell>
																		<Table.DataCell>
																			{app.alreadyLinked ? (
																				<Tag variant="success" size="xsmall">
																					Allerede koblet
																				</Tag>
																			) : (
																				<Tag variant="warning" size="xsmall">
																					Ikke koblet
																				</Tag>
																			)}
																		</Table.DataCell>
																	</Table.Row>
																))}
															</Table.Body>
														</Table>
													</section>
												</VStack>
											</div>
										)
									})}
								</VStack>
							</>
						) : (
							<Alert variant="success" size="small">
								Ingen koblingsforslag funnet for denne seksjonens applikasjoner.
							</Alert>
						)}
					</VStack>
				</Tabs.Panel>
			</Tabs>

			{/* Edit team modal */}
			<Modal ref={editTeamModalRef} header={{ heading: `Rediger team: ${editingTeam?.name ?? ""}` }}>
				<Modal.Body>
					<Form method="post" onSubmit={() => editTeamModalRef.current?.close()}>
						<input type="hidden" name="intent" value="update-team" />
						<input type="hidden" name="teamId" value={editingTeam?.id ?? ""} />
						<VStack gap="space-6">
							<TextField label="Navn" name="name" defaultValue={editingTeam?.name ?? ""} key={editingTeam?.id} />
							<Textarea
								label="Beskrivelse"
								name="description"
								defaultValue={editingTeam?.description ?? ""}
								key={`desc-${editingTeam?.id}`}
							/>
							<HStack gap="space-4">
								<Button type="submit" variant="primary" size="small">
									Lagre
								</Button>
								<Button
									type="button"
									variant="secondary"
									size="small"
									onClick={() => editTeamModalRef.current?.close()}
								>
									Avbryt
								</Button>
							</HStack>
						</VStack>
					</Form>
				</Modal.Body>
			</Modal>

			{/* Delete team modal */}
			<Modal ref={deleteTeamModalRef} header={{ heading: "Slett team" }}>
				<Modal.Body>
					<BodyShort>
						Er du sikker på at du vil slette teamet <strong>{deletingTeam?.name}</strong>?
					</BodyShort>
				</Modal.Body>
				<Modal.Footer>
					<Form method="post" onSubmit={() => deleteTeamModalRef.current?.close()}>
						<input type="hidden" name="intent" value="delete-team" />
						<input type="hidden" name="teamId" value={deletingTeam?.id ?? ""} />
						<HStack gap="space-4">
							<Button
								type="button"
								variant="secondary"
								size="small"
								onClick={() => deleteTeamModalRef.current?.close()}
							>
								Avbryt
							</Button>
							<Button type="submit" variant="danger" size="small" icon={<TrashIcon aria-hidden />}>
								Slett team
							</Button>
						</HStack>
					</Form>
				</Modal.Footer>
			</Modal>

			{/* Unlink Nais-team modal */}
			<Modal ref={unlinkNaisModalRef} header={{ heading: "Fjern Nais-team fra seksjon" }}>
				<Modal.Body>
					<BodyShort>
						Er du sikker på at du vil fjerne <strong>{unlinkingNaisTeam?.slug}</strong> fra seksjonen?
					</BodyShort>
				</Modal.Body>
				<Modal.Footer>
					<Form method="post" onSubmit={() => unlinkNaisModalRef.current?.close()}>
						<input type="hidden" name="intent" value="unlink-nais-team" />
						<input type="hidden" name="naisTeamSlug" value={unlinkingNaisTeam?.slug ?? ""} />
						<HStack gap="space-4">
							<Button
								type="button"
								variant="secondary"
								size="small"
								onClick={() => unlinkNaisModalRef.current?.close()}
							>
								Avbryt
							</Button>
							<Button type="submit" variant="danger" size="small">
								Fjern
							</Button>
						</HStack>
					</Form>
				</Modal.Footer>
			</Modal>
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
