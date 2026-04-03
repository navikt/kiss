import { PlusIcon, TrashIcon } from "@navikt/aksel-icons"
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
	Textarea,
	TextField,
	VStack,
} from "@navikt/ds-react"
import { useRef } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, Link, redirect, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getAvailableAppsForTeam, linkAppToTeam, unlinkAppFromTeam } from "~/db/queries/applications.server"
import { getNaisTeamsForSection } from "~/db/queries/nais.server"
import {
	deleteTeam,
	getNaisTeamsForDevTeam,
	getSectionBySlug,
	getTeamApps,
	linkNaisTeamToDevTeam,
	unlinkNaisTeamFromDevTeam,
	updateTeam,
} from "~/db/queries/sections.server"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { requireAdmin } from "~/lib/authorization.server"

export async function loader({ params }: LoaderFunctionArgs) {
	const seksjon = params.seksjon
	const team = params.team
	if (!seksjon) throw new Response("Mangler seksjon", { status: 400 })
	if (!team) throw new Response("Mangler team", { status: 400 })

	const result = await getTeamApps(team)
	if (!result) throw new Response("Team ikke funnet", { status: 404 })

	const section = await getSectionBySlug(seksjon)
	if (!section) throw new Response("Seksjon ikke funnet", { status: 404 })

	const [availableApps, linkedNaisTeams, sectionNaisTeams] = await Promise.all([
		getAvailableAppsForTeam(result.team.id),
		getNaisTeamsForDevTeam(result.team.id),
		getNaisTeamsForSection(section.id),
	])

	const availableNaisTeams = sectionNaisTeams.filter((nt) => !linkedNaisTeams.some((linked) => linked.slug === nt.slug))

	return data({
		seksjon,
		teamSlug: team,
		teamId: result.team.id,
		teamName: result.team.name,
		teamDescription: result.team.description,
		apps: result.apps,
		availableApps,
		linkedNaisTeams,
		availableNaisTeams: availableNaisTeams.map((nt) => ({ slug: nt.slug })),
	})
}

export async function action({ request, params }: ActionFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	requireAdmin(authedUser)
	const userId = authedUser.navIdent

	const seksjon = params.seksjon
	const teamSlug = params.team
	if (!seksjon || !teamSlug) throw new Response("Mangler parametere", { status: 400 })

	const formData = await request.formData()
	const intent = formData.get("intent") as string

	if (intent === "update-team") {
		const teamId = formData.get("teamId") as string
		const name = (formData.get("name") as string)?.trim()
		const description = (formData.get("description") as string)?.trim() || null
		if (!teamId || !name) throw new Response("Mangler påkrevde felt", { status: 400 })
		const updated = await updateTeam(teamId, name, description, userId)
		return redirect(`/seksjoner/${seksjon}/team/${updated.slug}/rediger`)
	}

	if (intent === "delete-team") {
		const teamId = formData.get("teamId") as string
		if (!teamId) throw new Response("Mangler team-ID", { status: 400 })
		await deleteTeam(teamId, userId)
		return redirect(`/seksjoner/${seksjon}/rediger?fane=team`)
	}

	if (intent === "link-nais-to-devteam") {
		const devTeamId = formData.get("devTeamId") as string
		const naisTeamSlug = formData.get("naisTeamSlug") as string
		if (!devTeamId || !naisTeamSlug) throw new Response("Mangler påkrevde felt", { status: 400 })
		await linkNaisTeamToDevTeam(naisTeamSlug, devTeamId, userId)
		return redirect(`/seksjoner/${seksjon}/team/${teamSlug}/rediger`)
	}

	if (intent === "unlink-nais-from-devteam") {
		const devTeamId = formData.get("devTeamId") as string
		const naisTeamSlug = formData.get("naisTeamSlug") as string
		if (!devTeamId || !naisTeamSlug) throw new Response("Mangler påkrevde felt", { status: 400 })
		await unlinkNaisTeamFromDevTeam(naisTeamSlug, devTeamId, userId)
		return redirect(`/seksjoner/${seksjon}/team/${teamSlug}/rediger`)
	}

	if (intent === "link-app") {
		const applicationId = formData.get("applicationId") as string
		const teamId = formData.get("teamId") as string
		if (!applicationId || !teamId) throw new Response("Velg en applikasjon", { status: 400 })
		await linkAppToTeam(applicationId, teamId, userId)
		return redirect(`/seksjoner/${seksjon}/team/${teamSlug}/rediger`)
	}

	if (intent === "unlink-app") {
		const applicationId = formData.get("applicationId") as string
		const teamId = formData.get("teamId") as string
		if (!applicationId || !teamId) throw new Response("Mangler påkrevde felt", { status: 400 })
		await unlinkAppFromTeam(applicationId, teamId, userId)
		return redirect(`/seksjoner/${seksjon}/team/${teamSlug}/rediger`)
	}

	throw new Response("Ugyldig handling", { status: 400 })
}

export default function RedigerTeam() {
	const {
		seksjon,
		teamSlug,
		teamId,
		teamName,
		teamDescription,
		apps,
		availableApps,
		linkedNaisTeams,
		availableNaisTeams,
	} = useLoaderData<typeof loader>()

	const deleteModalRef = useRef<HTMLDialogElement>(null)

	return (
		<VStack gap="space-8">
			<div>
				<Link to={`/seksjoner/${seksjon}/team/${teamSlug}`}>← Tilbake til {teamName}</Link>
				<Heading size="xlarge" level="2" spacing>
					Rediger team: {teamName}
				</Heading>
			</div>

			{/* Edit team details */}
			<VStack gap="space-4">
				<Heading size="medium" level="3">
					Teaminformasjon
				</Heading>
				<Form method="post">
					<input type="hidden" name="intent" value="update-team" />
					<input type="hidden" name="teamId" value={teamId} />
					<VStack gap="space-4">
						<TextField label="Navn" name="name" defaultValue={teamName} size="small" />
						<Textarea label="Beskrivelse" name="description" defaultValue={teamDescription ?? ""} size="small" />
						<HStack gap="space-4">
							<Button type="submit" variant="primary" size="small">
								Lagre
							</Button>
							<Button
								type="button"
								variant="danger"
								size="small"
								icon={<TrashIcon aria-hidden />}
								onClick={() => deleteModalRef.current?.showModal()}
							>
								Slett team
							</Button>
						</HStack>
					</VStack>
				</Form>
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
					Applikasjoner ({apps.length})
				</Heading>

				{apps.length > 0 && (
					/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */
					<section className="table-scroll" tabIndex={0} aria-label="Tilknyttede applikasjoner">
						<Table size="small">
							<Table.Header>
								<Table.Row>
									<Table.HeaderCell scope="col">Applikasjon</Table.HeaderCell>
									<Table.HeaderCell scope="col" />
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{apps.map((app) => (
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

				{availableApps.length > 0 && (
					<Form method="post">
						<input type="hidden" name="intent" value="link-app" />
						<input type="hidden" name="teamId" value={teamId} />
						<HStack gap="space-4" align="end">
							<Select label="Velg applikasjon" name="applicationId" size="small">
								<option value="">Velg …</option>
								{availableApps.map((app) => (
									<option key={app.id} value={app.id}>
										{app.name}
									</option>
								))}
							</Select>
							<Button type="submit" variant="secondary" size="small" icon={<PlusIcon aria-hidden />}>
								Legg til
							</Button>
						</HStack>
					</Form>
				)}

				{availableApps.length === 0 && apps.length === 0 && <BodyLong>Ingen applikasjoner tilgjengelig.</BodyLong>}
			</VStack>

			{/* Delete team modal */}
			<Modal ref={deleteModalRef} header={{ heading: `Slett team: ${teamName}` }}>
				<Modal.Body>
					<BodyLong>Er du sikker på at du vil slette teamet «{teamName}»? Dette kan ikke angres.</BodyLong>
				</Modal.Body>
				<Modal.Footer>
					<Form method="post" onSubmit={() => deleteModalRef.current?.close()}>
						<input type="hidden" name="intent" value="delete-team" />
						<input type="hidden" name="teamId" value={teamId} />
						<HStack gap="space-4">
							<Button type="submit" variant="danger" size="small">
								Slett
							</Button>
							<Button type="button" variant="secondary" size="small" onClick={() => deleteModalRef.current?.close()}>
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
