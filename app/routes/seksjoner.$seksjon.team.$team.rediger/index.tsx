import { ArchiveIcon, ArrowCirclepathIcon, PlusIcon } from "@navikt/aksel-icons"
import {
	Link as AkselLink,
	Alert,
	BodyLong,
	Button,
	Heading,
	HStack,
	Modal,
	Select,
	Table,
	Tag,
	Textarea,
	TextField,
	VStack,
} from "@navikt/ds-react"
import { useRef } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, Link, redirect, useLoaderData } from "react-router"
import { AddAppModal } from "~/components/AddAppModal"
import { LeggTilMedlemModal } from "~/components/LeggTilMedlemModal"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getAvailableAppsForTeam, linkAppToTeam, unlinkAppFromTeam } from "~/db/queries/applications.server"
import { getNaisTeamsForSection } from "~/db/queries/nais.server"
import {
	archiveTeam,
	getNaisTeamsForDevTeam,
	getSectionBySlug,
	getTeamApps,
	getTeamBySlug,
	linkNaisTeamToDevTeam,
	unarchiveTeam,
	unlinkNaisTeamFromDevTeam,
	updateTeam,
} from "~/db/queries/sections.server"
import { assignRole, getTeamMemberRoleById, getTeamMemberRoles, removeRole } from "~/db/queries/users.server"
import type { UserRole } from "~/db/schema/organization"
import { userRoleLabels } from "~/db/schema/organization"
import { requireAuthenticatedUser } from "~/lib/auth.server"
import { canManageSection, canManageTeam } from "~/lib/authorization.server"
import { getUserByNavIdent } from "~/lib/graph.server"
import { requireUuid } from "~/lib/utils"

/** Roller som teamledere (produktleder/tech lead) kan administrere på eget team. */
const TEAM_MANAGEABLE_ROLES: UserRole[] = ["developer"]
/** Roller som seksjonsledere, teknologiledere og admin kan administrere. */
const ELEVATED_ROLES: UserRole[] = ["product_owner", "tech_lead"]

export async function loader({ request, params }: LoaderFunctionArgs) {
	const seksjon = params.seksjon
	const team = params.team
	if (!seksjon) throw new Response("Mangler seksjon", { status: 400 })
	if (!team) throw new Response("Mangler team", { status: 400 })

	// Lettvektig oppslag for auth-sjekk – unngår tung getTeamApps for uautoriserte requests
	const teamRecord = await getTeamBySlug(team)
	if (!teamRecord) throw new Response("Team ikke funnet", { status: 404 })

	const authedUser = await requireAuthenticatedUser(request)
	if (!canManageTeam(authedUser, teamRecord.id, teamRecord.sectionId))
		throw new Response("Ikke autorisert", { status: 403 })

	const section = await getSectionBySlug(seksjon)
	if (!section) throw new Response("Seksjon ikke funnet", { status: 404 })
	if (teamRecord.sectionId !== section.id) throw new Response("Team tilhører ikke denne seksjonen", { status: 404 })

	const [result, availableApps, linkedNaisTeams, sectionNaisTeams, teamMembers] = await Promise.all([
		getTeamApps(team),
		getAvailableAppsForTeam(teamRecord.id),
		getNaisTeamsForDevTeam(teamRecord.id),
		getNaisTeamsForSection(section.id),
		getTeamMemberRoles(teamRecord.id),
	])
	if (!result) throw new Response("Team ikke funnet", { status: 404 })

	const availableNaisTeams = sectionNaisTeams.filter((nt) => !linkedNaisTeams.some((linked) => linked.slug === nt.slug))
	const userCanAssignElevatedRoles = canManageSection(authedUser, section.id)

	return data({
		seksjon,
		seksjonName: section.name,
		teamSlug: team,
		teamId: teamRecord.id,
		teamName: result.team.name,
		teamDescription: result.team.description,
		teamArchivedAt: result.team.archivedAt,
		apps: result.apps,
		availableApps,
		linkedNaisTeams,
		availableNaisTeams: availableNaisTeams.map((nt) => ({ slug: nt.slug })),
		teamMembers,
		userCanAssignElevatedRoles,
	})
}

export async function action({ request, params }: ActionFunctionArgs) {
	const authedUser = await requireAuthenticatedUser(request)

	const seksjon = params.seksjon
	const teamSlug = params.team
	if (!seksjon || !teamSlug) throw new Response("Mangler parametere", { status: 400 })

	const teamRecord = await getTeamBySlug(teamSlug)
	if (!teamRecord) throw new Response("Team ikke funnet", { status: 404 })
	if (!canManageTeam(authedUser, teamRecord.id, teamRecord.sectionId))
		throw new Response("Ikke autorisert", { status: 403 })

	const section = await getSectionBySlug(seksjon)
	if (!section || section.id !== teamRecord.sectionId) throw new Response("Seksjon/team mismatch", { status: 404 })

	const userId = authedUser.navIdent

	const formData = await request.formData()
	const intent = formData.get("intent") as string

	if (intent === "update-team") {
		const name = (formData.get("name") as string)?.trim()
		const description = (formData.get("description") as string)?.trim() || null
		if (!name) throw new Response("Mangler påkrevde felt", { status: 400 })
		const updated = await updateTeam(teamRecord.id, name, description, userId)
		return redirect(`/seksjoner/${seksjon}/team/${updated.slug}/rediger`)
	}

	if (intent === "archive-team") {
		await archiveTeam(teamRecord.id, userId)
		return redirect(`/seksjoner/${seksjon}/rediger?fane=team`)
	}

	if (intent === "unarchive-team") {
		await unarchiveTeam(teamRecord.id, userId)
		return redirect(`/seksjoner/${seksjon}/team/${teamSlug}/rediger`)
	}

	if (intent === "link-nais-to-devteam") {
		const naisTeamSlug = formData.get("naisTeamSlug") as string
		if (!naisTeamSlug) throw new Response("Mangler påkrevde felt", { status: 400 })
		const validNaisTeams = await getNaisTeamsForSection(teamRecord.sectionId)
		if (!validNaisTeams.some((nt) => nt.slug === naisTeamSlug)) throw new Response("Ugyldig Nais-team", { status: 400 })
		await linkNaisTeamToDevTeam(naisTeamSlug, teamRecord.id, userId)
		return redirect(`/seksjoner/${seksjon}/team/${teamSlug}/rediger`)
	}

	if (intent === "unlink-nais-from-devteam") {
		const naisTeamSlug = formData.get("naisTeamSlug") as string
		if (!naisTeamSlug) throw new Response("Mangler påkrevde felt", { status: 400 })
		const validNaisTeams = await getNaisTeamsForSection(teamRecord.sectionId)
		if (!validNaisTeams.some((nt) => nt.slug === naisTeamSlug)) throw new Response("Ugyldig Nais-team", { status: 400 })
		await unlinkNaisTeamFromDevTeam(naisTeamSlug, teamRecord.id, userId)
		return redirect(`/seksjoner/${seksjon}/team/${teamSlug}/rediger`)
	}

	if (intent === "link-app") {
		const applicationId = formData.get("applicationId") as string
		if (!applicationId) throw new Response("Velg en applikasjon", { status: 400 })
		await linkAppToTeam(applicationId, teamRecord.id, userId)
		return redirect(`/seksjoner/${seksjon}/team/${teamSlug}/rediger`)
	}

	if (intent === "unlink-app") {
		const applicationId = formData.get("applicationId") as string
		if (!applicationId) throw new Response("Mangler påkrevde felt", { status: 400 })
		await unlinkAppFromTeam(applicationId, teamRecord.id, userId)
		return redirect(`/seksjoner/${seksjon}/team/${teamSlug}/rediger`)
	}

	if (intent === "add-member") {
		if (teamRecord.archivedAt) throw new Response("Teamet er arkivert", { status: 400 })

		const rawPerson = formData.get("person")
		const rawRole = formData.get("role")

		if (typeof rawPerson !== "string" || !rawPerson) {
			throw new Response("Person er påkrevd", { status: 400 })
		}

		let navIdent: string
		try {
			const parsed = JSON.parse(rawPerson) as { navIdent?: unknown; displayName?: unknown }
			const rawIdent = typeof parsed.navIdent === "string" ? parsed.navIdent : ""
			navIdent = rawIdent.trim().toUpperCase()
			if (!navIdent) throw new Error("Mangler navIdent")
		} catch {
			throw new Response("Ugyldig person-data", { status: 400 })
		}

		// Valider rolle og tilgang FØR eksternt kall mot Graph
		const allTeamRoles: UserRole[] = [...TEAM_MANAGEABLE_ROLES, ...ELEVATED_ROLES]
		if (typeof rawRole !== "string" || !allTeamRoles.includes(rawRole as UserRole)) {
			throw new Response("Ugyldig rolle", { status: 400 })
		}
		const role = rawRole as UserRole

		const canAssignElevated = canManageSection(authedUser, teamRecord.sectionId)
		if (ELEVATED_ROLES.includes(role) && !canAssignElevated) {
			throw new Response("Kun seksjonsledere, teknologiledere og admin kan tildele denne rollen", { status: 403 })
		}

		// Slå opp autoritativt navn fra Graph API — stol ikke på klientens displayName.
		// getUserByNavIdent kaster ved Graph-feil slik at "ikke funnet" (null) skilles fra utilgjengelighet.
		const graphUser = await getUserByNavIdent(navIdent)
		if (!graphUser) throw new Response(`Fant ikke brukeren ${navIdent} i Microsoft Graph`, { status: 404 })
		const name = graphUser.displayName.trim() || navIdent

		await assignRole(navIdent, name, role, userId, undefined, teamRecord.id)
		return redirect(`/seksjoner/${seksjon}/team/${teamSlug}/rediger`)
	}

	if (intent === "remove-member") {
		if (teamRecord.archivedAt) throw new Response("Teamet er arkivert", { status: 400 })
		const roleId = requireUuid(formData.get("roleId"), "Rolle-ID")

		// Scope-sjekk: verifiser via målrettet DB-query at rollen tilhører dette teamet
		const target = await getTeamMemberRoleById(roleId, teamRecord.id)
		if (!target) throw new Response("Rolle ikke funnet i dette teamet", { status: 404 })

		// Brukere uten seksjons-admin-tilgang kan kun fjerne roller i TEAM_MANAGEABLE_ROLES (positiv allowlist)
		const canRemoveElevated = canManageSection(authedUser, teamRecord.sectionId)
		if (!canRemoveElevated && !TEAM_MANAGEABLE_ROLES.includes(target.role)) {
			throw new Response("Kun seksjonsledere, teknologiledere og admin kan fjerne denne rollen", { status: 403 })
		}

		await removeRole(roleId, userId)
		return redirect(`/seksjoner/${seksjon}/team/${teamSlug}/rediger`)
	}

	throw new Response("Ugyldig handling", { status: 400 })
}

export default function RedigerTeam() {
	const {
		teamId,
		teamName,
		teamDescription,
		teamArchivedAt,
		apps,
		availableApps,
		linkedNaisTeams,
		availableNaisTeams,
		teamMembers,
		userCanAssignElevatedRoles,
	} = useLoaderData<typeof loader>()

	const archiveModalRef = useRef<HTMLDialogElement>(null)
	const isArchived = teamArchivedAt !== null

	const assignableRoles: UserRole[] = userCanAssignElevatedRoles
		? [...TEAM_MANAGEABLE_ROLES, ...ELEVATED_ROLES]
		: TEAM_MANAGEABLE_ROLES

	return (
		<VStack gap="space-8">
			<HStack gap="space-8" align="center" wrap>
				<Heading size="xlarge" level="2" spacing>
					Rediger team: {teamName}
				</Heading>
				{isArchived && (
					<Tag variant="neutral" size="small">
						Arkivert
					</Tag>
				)}
			</HStack>

			{isArchived && (
				<Alert variant="warning" size="small">
					Teamet er arkivert og er skjult fra brukervendte lister. Reaktiver det for å bruke det igjen.
				</Alert>
			)}

			{/* Edit team details */}
			<VStack gap="space-4">
				<Heading size="medium" level="3">
					Teaminformasjon
				</Heading>
				<Form method="post">
					<input type="hidden" name="intent" value="update-team" />
					<input type="hidden" name="teamId" value={teamId} />
					<VStack gap="space-4">
						<TextField label="Navn" name="name" defaultValue={teamName} size="small" readOnly={isArchived} />
						<Textarea
							label="Beskrivelse"
							name="description"
							defaultValue={teamDescription ?? ""}
							size="small"
							readOnly={isArchived}
						/>
						<HStack gap="space-4">
							{!isArchived && (
								<Button type="submit" variant="primary" size="small">
									Lagre
								</Button>
							)}
							{isArchived ? (
								<Form method="post">
									<input type="hidden" name="intent" value="unarchive-team" />
									<input type="hidden" name="teamId" value={teamId} />
									<Button type="submit" variant="secondary" size="small" icon={<ArrowCirclepathIcon aria-hidden />}>
										Reaktiver team
									</Button>
								</Form>
							) : (
								<Button
									type="button"
									variant="danger"
									size="small"
									icon={<ArchiveIcon aria-hidden />}
									onClick={() => archiveModalRef.current?.showModal()}
								>
									Arkiver team
								</Button>
							)}
						</HStack>
					</VStack>
				</Form>
			</VStack>

			{/* Team members */}
			<VStack gap="space-4">
				<HStack align="center" justify="space-between" wrap>
					<Heading size="medium" level="3">
						Teammedlemmer ({teamMembers.length})
					</Heading>
					{!isArchived && <LeggTilMedlemModal assignableRoles={assignableRoles} />}
				</HStack>
				<BodyLong size="small">
					Teammedlemmer med roller i KISS. Produktledere og tech leads kan legge til utviklere. Kun admin kan tildele
					produktleder- og tech lead-roller.
				</BodyLong>

				{teamMembers.length > 0 && (
					/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */
					<section className="table-scroll" tabIndex={0} aria-label="Teammedlemmer">
						<Table size="small">
							<Table.Header>
								<Table.Row>
									<Table.HeaderCell scope="col">Navn</Table.HeaderCell>
									<Table.HeaderCell scope="col">NAV-ident</Table.HeaderCell>
									<Table.HeaderCell scope="col">Rolle</Table.HeaderCell>
									<Table.HeaderCell scope="col" />
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{teamMembers.map((m) => (
									<Table.Row key={m.roleId}>
										<Table.DataCell>{m.name}</Table.DataCell>
										<Table.DataCell>{m.navIdent}</Table.DataCell>
										<Table.DataCell>{userRoleLabels[m.role]}</Table.DataCell>
										<Table.DataCell align="right">
											{!isArchived && (userCanAssignElevatedRoles || TEAM_MANAGEABLE_ROLES.includes(m.role)) && (
												<Form method="post">
													<input type="hidden" name="intent" value="remove-member" />
													<input type="hidden" name="roleId" value={m.roleId} />
													<Button type="submit" variant="tertiary-neutral" size="xsmall">
														Fjern
													</Button>
												</Form>
											)}
										</Table.DataCell>
									</Table.Row>
								))}
							</Table.Body>
						</Table>
					</section>
				)}
			</VStack>

			{/* Nais team linking */}
			<VStack gap="space-4">
				<Heading size="medium" level="3">
					Koblede Nais-team ({linkedNaisTeams.length})
				</Heading>
				<BodyLong size="small">
					Teamet følger opp alle applikasjoner (som ikke er ignorert) i koblede Nais-team.
				</BodyLong>

				{linkedNaisTeams.length > 0 && (
					/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */
					<section className="table-scroll" tabIndex={0} aria-label="Koblede Nais-team">
						<Table size="small">
							<Table.Header>
								<Table.Row>
									<Table.HeaderCell scope="col">Nais-team</Table.HeaderCell>
									<Table.HeaderCell scope="col" align="right">
										Applikasjoner
									</Table.HeaderCell>
									<Table.HeaderCell scope="col" />
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{linkedNaisTeams.map((nt) => (
									<Table.Row key={nt.slug}>
										<Table.DataCell>{nt.slug}</Table.DataCell>
										<Table.DataCell align="right">{nt.appCount}</Table.DataCell>
										<Table.DataCell align="right">
											<Form method="post">
												<input type="hidden" name="intent" value="unlink-nais-from-devteam" />
												<input type="hidden" name="devTeamId" value={teamId} />
												<input type="hidden" name="naisTeamSlug" value={nt.slug} />
												<Button type="submit" variant="tertiary-neutral" size="xsmall">
													Fjern
												</Button>
											</Form>
										</Table.DataCell>
									</Table.Row>
								))}
							</Table.Body>
						</Table>
					</section>
				)}

				{availableNaisTeams.length > 0 && (
					<Form method="post">
						<input type="hidden" name="intent" value="link-nais-to-devteam" />
						<input type="hidden" name="devTeamId" value={teamId} />
						<HStack gap="space-4" align="end">
							<Select label="Nais-team" name="naisTeamSlug" size="small">
								{availableNaisTeams.map((nt) => (
									<option key={nt.slug} value={nt.slug}>
										{nt.slug}
									</option>
								))}
							</Select>
							<Button type="submit" variant="secondary" size="small" icon={<PlusIcon aria-hidden />}>
								Koble
							</Button>
						</HStack>
					</Form>
				)}

				{availableNaisTeams.length === 0 && linkedNaisTeams.length === 0 && (
					<Alert variant="info" size="small">
						Ingen Nais-team er koblet til seksjonen ennå. Koble Nais-team til seksjonen først.
					</Alert>
				)}
			</VStack>

			{/* App management */}
			<VStack gap="space-4">
				<Heading size="medium" level="3">
					Applikasjoner fra Nais-team ({apps.filter((a) => a.source === "nais-team").length})
				</Heading>
				<BodyLong size="small">Disse applikasjonene kommer automatisk via koblede Nais-team.</BodyLong>

				{apps.filter((a) => a.source === "nais-team").length > 0 ? (
					/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */
					<section className="table-scroll" tabIndex={0} aria-label="Applikasjoner fra Nais-team">
						<Table size="small">
							<Table.Header>
								<Table.Row>
									<Table.HeaderCell scope="col">Applikasjon</Table.HeaderCell>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{apps
									.filter((a) => a.source === "nais-team")
									.map((app) => (
										<Table.Row key={app.appId}>
											<Table.DataCell>
												<AkselLink as={Link} to={`/applikasjoner/${app.appId}/detaljer`}>
													{app.appName}
												</AkselLink>
											</Table.DataCell>
										</Table.Row>
									))}
							</Table.Body>
						</Table>
					</section>
				) : (
					<BodyLong size="small">Ingen applikasjoner fra Nais-team.</BodyLong>
				)}
			</VStack>

			<VStack gap="space-4">
				<HStack align="center" justify="space-between" wrap>
					<Heading size="medium" level="3">
						Direkte tilknyttede applikasjoner ({apps.filter((a) => a.source === "direct").length})
					</Heading>
					{availableApps.length > 0 && <AddAppModal availableApps={availableApps} teamId={teamId} intent="link-app" />}
				</HStack>
				<BodyLong size="small">Disse applikasjonene er manuelt lagt til teamet.</BodyLong>

				{apps.filter((a) => a.source === "direct").length > 0 && (
					/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */
					<section className="table-scroll" tabIndex={0} aria-label="Direkte tilknyttede applikasjoner">
						<Table size="small">
							<Table.Header>
								<Table.Row>
									<Table.HeaderCell scope="col">Applikasjon</Table.HeaderCell>
									<Table.HeaderCell scope="col" />
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{apps
									.filter((a) => a.source === "direct")
									.map((app) => (
										<Table.Row key={app.appId}>
											<Table.DataCell>
												<AkselLink as={Link} to={`/applikasjoner/${app.appId}/detaljer`}>
													{app.appName}
												</AkselLink>
											</Table.DataCell>
											<Table.DataCell align="right">
												<Form method="post">
													<input type="hidden" name="intent" value="unlink-app" />
													<input type="hidden" name="applicationId" value={app.appId} />
													<input type="hidden" name="teamId" value={teamId} />
													<Button type="submit" variant="tertiary-neutral" size="xsmall">
														Fjern
													</Button>
												</Form>
											</Table.DataCell>
										</Table.Row>
									))}
							</Table.Body>
						</Table>
					</section>
				)}

				{availableApps.length === 0 && apps.length === 0 && <BodyLong>Ingen applikasjoner tilgjengelig.</BodyLong>}
			</VStack>

			{/* Archive team modal */}
			<Modal ref={archiveModalRef} header={{ heading: `Arkiver team: ${teamName}` }}>
				<Modal.Body>
					<BodyLong>
						Er du sikker på at du vil arkivere teamet «{teamName}»? Teamet skjules fra brukervendte lister, men all
						historikk og koblinger bevares. Du kan reaktivere teamet senere fra denne siden.
					</BodyLong>
				</Modal.Body>
				<Modal.Footer>
					<Form method="post" onSubmit={() => archiveModalRef.current?.close()}>
						<input type="hidden" name="intent" value="archive-team" />
						<input type="hidden" name="teamId" value={teamId} />
						<HStack gap="space-4">
							<Button type="submit" variant="danger" size="small">
								Arkiver
							</Button>
							<Button type="button" variant="secondary" size="small" onClick={() => archiveModalRef.current?.close()}>
								Avbryt
							</Button>
						</HStack>
					</Form>
				</Modal.Footer>
			</Modal>
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
