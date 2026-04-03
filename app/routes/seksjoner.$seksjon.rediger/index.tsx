import { PencilIcon, PlusIcon, TrashIcon } from "@navikt/aksel-icons"
import {
	BodyLong,
	BodyShort,
	Button,
	Heading,
	HStack,
	Modal,
	Table,
	Textarea,
	TextField,
	VStack,
} from "@navikt/ds-react"
import { useRef, useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, Link, redirect, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
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

	const teams = await getTeamsForSection(result.section.id)

	return data({
		section: {
			id: result.section.id,
			name: result.section.name,
			slug: result.section.slug,
			description: result.section.description,
		},
		teams: teams.map((t) => ({ id: t.id, name: t.name, slug: t.slug, description: t.description })),
		seksjon,
	})
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

	if (intent === "update-section") {
		const name = (formData.get("name") as string)?.trim()
		const description = (formData.get("description") as string)?.trim() || null
		if (!name) throw new Response("Navn er påkrevd", { status: 400 })
		const updated = await updateSection(result.section.id, name, description, authedUser.navIdent)
		return redirect(`/seksjoner/${updated.slug}/rediger`)
	}

	if (intent === "create-team") {
		const name = (formData.get("name") as string)?.trim()
		const description = (formData.get("description") as string)?.trim() || null
		if (!name) throw new Response("Teamnavn er påkrevd", { status: 400 })
		await createTeam(result.section.id, name, description, authedUser.navIdent)
		return redirect(`/seksjoner/${seksjon}/rediger`)
	}

	if (intent === "update-team") {
		const teamId = formData.get("teamId") as string
		const name = (formData.get("name") as string)?.trim()
		const description = (formData.get("description") as string)?.trim() || null
		if (!teamId || !name) throw new Response("Mangler påkrevde felt", { status: 400 })
		await updateTeam(teamId, name, description, authedUser.navIdent)
		return redirect(`/seksjoner/${seksjon}/rediger`)
	}

	if (intent === "delete-team") {
		const teamId = formData.get("teamId") as string
		if (!teamId) throw new Response("Mangler team-ID", { status: 400 })
		await deleteTeam(teamId, authedUser.navIdent)
		return redirect(`/seksjoner/${seksjon}/rediger`)
	}

	throw new Response("Ugyldig handling", { status: 400 })
}

export default function RedigerSeksjon() {
	const { section, teams, seksjon } = useLoaderData<typeof loader>()
	const teamFormRef = useRef<HTMLFormElement>(null)
	const editTeamModalRef = useRef<HTMLDialogElement>(null)
	const deleteTeamModalRef = useRef<HTMLDialogElement>(null)
	const [editingTeam, setEditingTeam] = useState<(typeof teams)[number] | null>(null)
	const [deletingTeam, setDeletingTeam] = useState<(typeof teams)[number] | null>(null)

	return (
		<VStack gap="space-12">
			<div>
				<Link to={`/seksjoner/${seksjon}`}>← Tilbake til seksjon</Link>
				<Heading size="xlarge" level="2" spacing>
					Rediger seksjon: {section.name}
				</Heading>
			</div>

			{/* Section metadata */}
			<VStack gap="space-6">
				<Heading size="medium" level="3">
					Seksjonsinformasjon
				</Heading>
				<Form method="post">
					<input type="hidden" name="intent" value="update-section" />
					<VStack gap="space-6" style={{ maxWidth: "40rem" }}>
						<TextField label="Navn" name="name" defaultValue={section.name} autoComplete="off" />
						<Textarea label="Beskrivelse" name="description" defaultValue={section.description ?? ""} minRows={3} />
						<div>
							<Button type="submit" variant="primary" size="small" icon={<PencilIcon aria-hidden />}>
								Lagre endringer
							</Button>
						</div>
					</VStack>
				</Form>
			</VStack>

			{/* Team management */}
			<VStack gap="space-6">
				<Heading size="medium" level="3">
					Team ({teams.length})
				</Heading>

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

			{/* Links to related admin pages */}
			<VStack gap="space-4">
				<Heading size="medium" level="3">
					Relatert
				</Heading>
				<HStack gap="space-4">
					<Button as={Link} to={`/seksjoner/${seksjon}/screening`} variant="secondary" size="small">
						Screening-spørsmål
					</Button>
					<Button as={Link} to={`/seksjoner/${seksjon}/nais-team`} variant="secondary" size="small">
						Nais-team
					</Button>
				</HStack>
			</VStack>
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
