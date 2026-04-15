import { ChevronRightIcon, DownloadIcon, PencilIcon, PlusIcon } from "@navikt/aksel-icons"
import type { SortState } from "@navikt/ds-react"
import {
	Link as AkselLink,
	Alert,
	BodyLong,
	BodyShort,
	Button,
	Checkbox,
	Detail,
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
import { getApplicationsForSection, linkAppToTeam } from "~/db/queries/applications.server"
import {
	excludeEnvironment,
	getAppsPersistence,
	getDiscoveredEnvironments,
	getExcludedEnvironments,
	getIgnoredAppsForSection,
	getNaisTeamsForSection,
	getUnassignedAppsForSection,
	getUnlinkedNaisTeams,
	ignoreAppForSection,
	includeEnvironment,
	linkNaisTeamToSection,
	unignoreAppForSection,
	unlinkNaisTeamFromSection,
} from "~/db/queries/nais.server"
import { createTeam, getSectionDetail, getTeamsForSection, updateSection } from "~/db/queries/sections.server"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { requireAdmin } from "~/lib/authorization.server"
import { compliancePercent } from "~/lib/utils"

const persistenceLabels: Record<string, string> = {
	cloud_sql_postgres: "PostgreSQL",
	nais_postgres: "Postgres",
	opensearch: "OpenSearch",
	bucket: "Bucket",
	valkey: "Valkey",
	oracle: "Oracle",
	other: "Annet",
}

export async function loader({ request, params }: LoaderFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	requireAdmin(authedUser)

	const seksjon = params.seksjon
	if (!seksjon) throw new Response("Mangler seksjon", { status: 400 })

	const result = await getSectionDetail(seksjon)
	if (!result) throw new Response("Seksjon ikke funnet", { status: 404 })

	const sectionId = result.section.id

	const [
		teams,
		linkedNaisTeams,
		unlinkedNaisTeams,
		unassignedApps,
		ignoredApps,
		sectionApps,
		discoveredEnvironments,
		excludedEnvironments,
	] = await Promise.all([
		getTeamsForSection(sectionId),
		getNaisTeamsForSection(sectionId),
		getUnlinkedNaisTeams(),
		getUnassignedAppsForSection(sectionId),
		getIgnoredAppsForSection(sectionId),
		getApplicationsForSection(sectionId),
		getDiscoveredEnvironments(sectionId),
		getExcludedEnvironments(sectionId),
	])

	const sectionAppIds = sectionApps.map((a) => a.id)
	const persistenceMap = await getAppsPersistence(sectionAppIds)

	return data({
		section: {
			id: sectionId,
			name: result.section.name,
			slug: result.section.slug,
			description: result.section.description,
		},
		teams: teams.map((t) => ({
			id: t.id,
			name: t.name,
			slug: t.slug,
			description: t.description,
			linkedNaisTeams: t.linkedNaisTeams,
		})),
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
		sectionApps,
		persistenceMap: Object.fromEntries(persistenceMap),
		discoveredEnvironments,
		excludedEnvironments: [...excludedEnvironments],
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
		return redirectToTab(seksjon, "applikasjoner")
	}

	if (intent === "unignore-app") {
		const applicationId = formData.get("applicationId") as string
		if (!applicationId) throw new Response("Mangler applikasjon", { status: 400 })
		await unignoreAppForSection(result.section.id, applicationId, userId)
		return redirectToTab(seksjon, "applikasjoner")
	}

	if (intent === "bulk-assign-team") {
		const teamId = formData.get("teamId") as string
		const appIds = formData.getAll("appId") as string[]
		if (!teamId) throw new Response("Mangler team", { status: 400 })
		if (appIds.length === 0) throw new Response("Ingen applikasjoner valgt", { status: 400 })
		for (const appId of appIds) {
			await linkAppToTeam(appId, teamId, userId)
		}
		return redirectToTab(seksjon, "applikasjoner")
	}

	if (intent === "link-team") {
		const applicationId = formData.get("applicationId") as string
		const devTeamId = formData.get("devTeamId") as string
		if (!applicationId || !devTeamId) throw new Response("Velg et team.", { status: 400 })
		await linkAppToTeam(applicationId, devTeamId, userId)
		return redirectToTab(seksjon, "alle-applikasjoner")
	}

	if (intent === "toggle-environment") {
		const cluster = formData.get("cluster") as string
		const enabled = formData.get("enabled") === "true"
		if (!cluster) throw new Response("Mangler cluster", { status: 400 })
		if (enabled) {
			await includeEnvironment(result.section.id, cluster, userId)
		} else {
			await excludeEnvironment(result.section.id, cluster, userId)
		}
		return redirectToTab(seksjon, "nais")
	}

	throw new Response("Ugyldig handling", { status: 400 })
}

export default function RedigerSeksjon() {
	const {
		section,
		teams,
		linkedNaisTeams,
		unlinkedNaisTeams,
		unassignedApps,
		ignoredApps,
		sectionApps,
		persistenceMap,
		discoveredEnvironments,
		excludedEnvironments,
		seksjon,
	} = useLoaderData<typeof loader>()
	const [searchParams, setSearchParams] = useSearchParams()
	const activeTab = searchParams.get("fane") ?? "seksjon"

	const teamFormRef = useRef<HTMLFormElement>(null)
	const unlinkNaisModalRef = useRef<HTMLDialogElement>(null)
	const [unlinkingNaisTeam, setUnlinkingNaisTeam] = useState<(typeof linkedNaisTeams)[number] | null>(null)
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
					Rediger seksjon: {section.name}
				</Heading>
				<Button
					as="a"
					href={`/api/seksjoner/${seksjon}/eksport`}
					variant="tertiary"
					size="small"
					icon={<DownloadIcon aria-hidden />}
				>
					Eksporter alt
				</Button>
			</HStack>

			<Tabs value={activeTab} onChange={(tab) => setSearchParams({ fane: tab }, { replace: true })}>
				<Tabs.List>
					<Tabs.Tab value="seksjon" label="Seksjon" />
					<Tabs.Tab value="team" label={`Utviklingsteam (${teams.length})`} />
					<Tabs.Tab value="nais" label={`Nais-team (${linkedNaisTeams.length})`} />
					<Tabs.Tab
						value="applikasjoner"
						label={`Applikasjoner uten team (${unassignedApps.length})${unassignedApps.length > 0 ? " ⚠" : ""}`}
					/>
					<Tabs.Tab value="alle-applikasjoner" label={`Alle applikasjoner (${sectionApps.length})`} />
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
											<Table.HeaderCell scope="col">Nais-team</Table.HeaderCell>
											<Table.HeaderCell scope="col" />
										</Table.Row>
									</Table.Header>
									<Table.Body>
										{teams.map((team) => (
											<Table.Row key={team.id}>
												<Table.DataCell>
													<AkselLink as={Link} to={`/seksjoner/${seksjon}/team/${team.slug}`}>
														{team.name}
													</AkselLink>
												</Table.DataCell>
												<Table.DataCell>{team.description ?? "–"}</Table.DataCell>
												<Table.DataCell>
													{team.linkedNaisTeams.length > 0 ? (
														<HStack gap="space-2" wrap>
															{team.linkedNaisTeams.map((slug) => (
																<Tag key={slug} variant="info" size="xsmall">
																	{slug}
																</Tag>
															))}
														</HStack>
													) : (
														<BodyShort size="small" style={{ color: "var(--ax-text-subtle)" }}>
															Ingen
														</BodyShort>
													)}
												</Table.DataCell>
												<Table.DataCell align="right">
													<Button
														as={Link}
														to={`/seksjoner/${seksjon}/team/${team.slug}/rediger`}
														variant="tertiary"
														size="xsmall"
													>
														Rediger
													</Button>
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

						{discoveredEnvironments.length > 0 && (
							<VStack gap="space-4">
								<Heading size="medium" level="3">
									Miljøfilter
								</Heading>
								<BodyShort>
									Velg hvilke Nais-miljøer som skal inkluderes. Applikasjoner som kun finnes i deaktiverte miljøer vil
									ikke telle med i team, compliance-oppsummering eller applikasjonslister.
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
											{discoveredEnvironments.map((cluster) => {
												const isExcluded = excludedEnvironments.includes(cluster)
												return (
													<Table.Row key={cluster}>
														<Table.DataCell>{cluster}</Table.DataCell>
														<Table.DataCell>
															{isExcluded ? (
																<Tag variant="neutral" size="small">
																	Deaktivert
																</Tag>
															) : (
																<Tag variant="success" size="small">
																	Aktiv
																</Tag>
															)}
														</Table.DataCell>
														<Table.DataCell align="right">
															<Form method="post">
																<input type="hidden" name="intent" value="toggle-environment" />
																<input type="hidden" name="cluster" value={cluster} />
																<input type="hidden" name="enabled" value={isExcluded ? "true" : "false"} />
																<Button type="submit" variant="tertiary-neutral" size="xsmall">
																	{isExcluded ? "Aktiver" : "Deaktiver"}
																</Button>
															</Form>
														</Table.DataCell>
													</Table.Row>
												)
											})}
										</Table.Body>
									</Table>
								</section>
							</VStack>
						)}
					</VStack>
				</Tabs.Panel>

				{/* Tab: Applikasjoner uten team */}
				<Tabs.Panel value="applikasjoner" style={{ paddingTop: "var(--ax-space-6)" }}>
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
													Koble {selectedApps.length} {selectedApps.length === 1 ? "applikasjon" : "applikasjoner"} til
													team
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
															onChange={(e) =>
																setSelectedApps(e.target.checked ? unassignedApps.map((a) => a.appId) : [])
															}
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
				</Tabs.Panel>

				{/* Tab: Alle applikasjoner */}
				<Tabs.Panel value="alle-applikasjoner" style={{ paddingTop: "var(--ax-space-6)" }}>
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
											const availableTeams = teams.filter((t) => !linkedTeamSlugs.includes(t.slug))
											const appPersistence = persistenceMap[app.id] ?? []
											const uniqueTypes = [...new Set(appPersistence.map((p: { type: string }) => p.type))]
											return (
												<>
													<Table.Row key={app.id}>
														<Table.DataCell>
															<AkselLink as={Link} to={`/applikasjoner/${app.id}/detaljer`}>
																{app.name}
															</AkselLink>
															{app.linkedApps.length > 0 && (
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
																	? uniqueTypes.map((type: string) => (
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
												</>
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
				</Tabs.Panel>
			</Tabs>

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
