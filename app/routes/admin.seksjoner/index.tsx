import {
	Alert,
	BodyLong,
	Button,
	Heading,
	HStack,
	Modal,
	Table,
	Tag,
	Textarea,
	TextField,
	VStack,
} from "@navikt/ds-react"
import { useRef, useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, Link, useActionData, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getRecentAuditLog } from "~/db/queries/audit.server"
import {
	createSection,
	deleteSection,
	getSections,
	getTeamsForSection,
	updateSection,
} from "~/db/queries/sections.server"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { requireAdmin } from "~/lib/authorization.server"

interface SectionWithTeams {
	id: string
	name: string
	slug: string
	description: string | null
	teams: {
		id: string
		name: string
		slug: string
		description: string | null
	}[]
}

export async function loader({ request }: LoaderFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	requireAdmin(authedUser)

	const allSections = await getSections()
	const sectionsWithTeams: SectionWithTeams[] = await Promise.all(
		allSections.map(async (section) => {
			const teams = await getTeamsForSection(section.id)
			return {
				id: section.id,
				name: section.name,
				slug: section.slug,
				description: section.description,
				teams: teams.map((t) => ({
					id: t.id,
					name: t.name,
					slug: t.slug,
					description: t.description,
				})),
			}
		}),
	)

	const allAuditEntries = await getRecentAuditLog(100)
	const auditEntries = allAuditEntries.filter((e) => e.entityType === "section" || e.entityType === "team")

	return data({ sections: sectionsWithTeams, auditEntries })
}

type ActionResult = { success: true; message: string } | { success: false; error: string }

export async function action({ request }: ActionFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	requireAdmin(authedUser)
	const userId = authedUser.navIdent

	const formData = await request.formData()
	const intent = formData.get("intent")

	switch (intent) {
		case "create-section": {
			const name = formData.get("name")
			const description = formData.get("description")
			if (typeof name !== "string" || !name.trim()) {
				return data<ActionResult>({ success: false, error: "Navn er påkrevd." })
			}
			await createSection(name.trim(), typeof description === "string" ? description.trim() || null : null, userId)
			return data<ActionResult>({ success: true, message: `Seksjon «${name.trim()}» opprettet.` })
		}

		case "update-section": {
			const id = formData.get("id")
			const name = formData.get("name")
			const description = formData.get("description")
			if (typeof id !== "string" || typeof name !== "string" || !name.trim()) {
				return data<ActionResult>({ success: false, error: "Mangler påkrevde felt." })
			}
			await updateSection(id, name.trim(), typeof description === "string" ? description.trim() || null : null, userId)
			return data<ActionResult>({ success: true, message: `Seksjon «${name.trim()}» oppdatert.` })
		}

		case "delete-section": {
			const id = formData.get("id")
			if (typeof id !== "string") {
				return data<ActionResult>({ success: false, error: "Mangler seksjon-ID." })
			}
			await deleteSection(id, userId)
			return data<ActionResult>({ success: true, message: "Seksjon slettet." })
		}

		default:
			return data<ActionResult>({ success: false, error: "Ugyldig handling." })
	}
}

function EditSectionModal({
	section,
	open,
	onClose,
}: {
	section: SectionWithTeams
	open: boolean
	onClose: () => void
}) {
	return (
		<Modal open={open} onClose={onClose} header={{ heading: `Rediger seksjon: ${section.name}` }}>
			<Modal.Body>
				<Form method="post" onSubmit={onClose}>
					<input type="hidden" name="intent" value="update-section" />
					<input type="hidden" name="id" value={section.id} />
					<VStack gap="space-6">
						<TextField label="Navn" name="name" defaultValue={section.name} required />
						<Textarea label="Beskrivelse" name="description" defaultValue={section.description ?? ""} />
						<HStack gap="space-4">
							<Button type="submit" variant="primary">
								Lagre
							</Button>
							<Button type="button" variant="tertiary" onClick={onClose}>
								Avbryt
							</Button>
						</HStack>
					</VStack>
				</Form>
			</Modal.Body>
		</Modal>
	)
}

function DeleteConfirmModal({
	open,
	onClose,
	title,
	message,
	formData,
}: {
	open: boolean
	onClose: () => void
	title: string
	message: string
	formData: Record<string, string>
}) {
	return (
		<Modal open={open} onClose={onClose} header={{ heading: title }}>
			<Modal.Body>
				<BodyLong>{message}</BodyLong>
			</Modal.Body>
			<Modal.Footer>
				<Form method="post" onSubmit={onClose}>
					{Object.entries(formData).map(([key, value]) => (
						<input key={key} type="hidden" name={key} value={value} />
					))}
					<HStack gap="space-4">
						<Button type="submit" variant="danger">
							Slett
						</Button>
						<Button type="button" variant="tertiary" onClick={onClose}>
							Avbryt
						</Button>
					</HStack>
				</Form>
			</Modal.Footer>
		</Modal>
	)
}

function SectionCard({ section }: { section: SectionWithTeams }) {
	const [editSectionOpen, setEditSectionOpen] = useState(false)
	const [deleteSectionOpen, setDeleteSectionOpen] = useState(false)

	return (
		<VStack gap="space-4" className="admin-card" key={section.id}>
			<HStack gap="space-4" align="center" justify="space-between">
				<VStack gap="space-2">
					<Heading size="medium" level="3">
						{section.name}
					</Heading>
					{section.description && <BodyLong size="small">{section.description}</BodyLong>}
					<Tag variant="neutral" size="small">
						{section.teams.length} team
					</Tag>
				</VStack>
				<HStack gap="space-2">
					<Button as={Link} to={`/seksjoner/${section.slug}/rediger`} variant="secondary" size="small">
						Rediger
					</Button>
					<Button variant="danger" size="small" onClick={() => setDeleteSectionOpen(true)}>
						Slett
					</Button>
				</HStack>
			</HStack>

			<EditSectionModal section={section} open={editSectionOpen} onClose={() => setEditSectionOpen(false)} />

			<DeleteConfirmModal
				open={deleteSectionOpen}
				onClose={() => setDeleteSectionOpen(false)}
				title={`Slett seksjon: ${section.name}`}
				message={`Er du sikker på at du vil slette seksjonen «${section.name}»? Alle ${section.teams.length} team i seksjonen vil også bli slettet.`}
				formData={{ intent: "delete-section", id: section.id }}
			/>
		</VStack>
	)
}

const actionLabels: Record<string, string> = {
	section_created: "Seksjon opprettet",
	section_updated: "Seksjon oppdatert",
	section_deleted: "Seksjon slettet",
	team_created: "Team opprettet",
	team_updated: "Team oppdatert",
	team_deleted: "Team slettet",
}

export default function AdminSeksjoner() {
	const { sections, auditEntries } = useLoaderData<typeof loader>()
	const actionData = useActionData<typeof action>()
	const sectionFormRef = useRef<HTMLFormElement>(null)

	return (
		<VStack gap="space-6">
			<Heading size="xlarge" level="2">
				Administrer seksjoner
			</Heading>
			<BodyLong>Opprett, rediger og slett seksjoner og utviklingsteam.</BodyLong>

			{actionData && "success" in actionData && actionData.success && (
				<Alert variant="success">{actionData.message}</Alert>
			)}
			{actionData && "success" in actionData && !actionData.success && (
				<Alert variant="error">{actionData.error}</Alert>
			)}

			<VStack gap="space-4">
				<Heading size="medium" level="3">
					Opprett ny seksjon
				</Heading>
				<Form
					method="post"
					ref={sectionFormRef}
					onSubmit={() => {
						setTimeout(() => sectionFormRef.current?.reset(), 0)
					}}
				>
					<input type="hidden" name="intent" value="create-section" />
					<VStack gap="space-4">
						<TextField label="Seksjonsnavn" name="name" required />
						<Textarea label="Beskrivelse" name="description" />
						<div>
							<Button type="submit" variant="primary">
								Opprett seksjon
							</Button>
						</div>
					</VStack>
				</Form>
			</VStack>

			{sections.length > 0 && (
				<VStack gap="space-6">
					<Heading size="medium" level="3">
						Eksisterende seksjoner
					</Heading>
					{sections.map((section) => (
						<SectionCard key={section.id} section={section} />
					))}
				</VStack>
			)}

			{sections.length === 0 && <BodyLong>Ingen seksjoner funnet. Opprett en ny seksjon ovenfor.</BodyLong>}

			{auditEntries.length > 0 && (
				<VStack gap="space-4">
					<Heading size="medium" level="3">
						Endringslogg
					</Heading>
					{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */}
					<section className="table-scroll" tabIndex={0} aria-label="Endringslogg for seksjoner og team">
						<Table size="small">
							<Table.Header>
								<Table.Row>
									<Table.HeaderCell scope="col">Tidspunkt</Table.HeaderCell>
									<Table.HeaderCell scope="col">Handling</Table.HeaderCell>
									<Table.HeaderCell scope="col">Detaljer</Table.HeaderCell>
									<Table.HeaderCell scope="col">Utført av</Table.HeaderCell>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{auditEntries.map((entry) => (
									<Table.Row key={entry.id}>
										<Table.DataCell>{new Date(entry.performedAt).toLocaleString("nb-NO")}</Table.DataCell>
										<Table.DataCell>
											<Tag
												variant={
													entry.action.includes("deleted")
														? "error"
														: entry.action.includes("created")
															? "success"
															: "info"
												}
												size="xsmall"
											>
												{actionLabels[entry.action] ?? entry.action}
											</Tag>
										</Table.DataCell>
										<Table.DataCell>
											{entry.previousValue && entry.newValue
												? `«${entry.previousValue}» → «${entry.newValue}»`
												: entry.newValue
													? `«${entry.newValue}»`
													: entry.previousValue
														? `«${entry.previousValue}»`
														: "–"}
										</Table.DataCell>
										<Table.DataCell>{entry.performedBy}</Table.DataCell>
									</Table.Row>
								))}
							</Table.Body>
						</Table>
					</section>
				</VStack>
			)}
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
