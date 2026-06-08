import { Alert, BodyLong, Button, Heading, HStack, Modal, Table, Tag, VStack } from "@navikt/ds-react"
import { useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, Link, useActionData, useLoaderData } from "react-router"
import { OpprettSeksjonModal } from "~/components/OpprettSeksjonModal"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getRecentAuditLog } from "~/db/queries/audit.server"
import {
	archiveSection,
	createSection,
	getSections,
	getTeamsForSection,
	unarchiveSection,
} from "~/db/queries/sections.server"
import { requireAuthenticatedUser } from "~/lib/auth.server"
import { requireAdmin } from "~/lib/authorization.server"

interface SectionWithTeams {
	id: string
	name: string
	slug: string
	description: string | null
	archivedAt: Date | null
	archivedBy: string | null
	teams: {
		id: string
		name: string
		slug: string
		description: string | null
	}[]
}

export async function loader({ request }: LoaderFunctionArgs) {
	const authedUser = await requireAuthenticatedUser(request)
	requireAdmin(authedUser)

	const allSections = await getSections({ includeArchived: true })
	const sectionsWithTeams: SectionWithTeams[] = await Promise.all(
		allSections.map(async (section) => {
			const teams = await getTeamsForSection(section.id)
			return {
				id: section.id,
				name: section.name,
				slug: section.slug,
				description: section.description,
				archivedAt: section.archivedAt,
				archivedBy: section.archivedBy,
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
	const authedUser = await requireAuthenticatedUser(request)
	requireAdmin(authedUser)
	const userId = authedUser.navIdent

	const formData = await request.formData()
	const intent = formData.get("intent")

	switch (intent) {
		case "create-section-with-leaders": {
			const name = formData.get("name")
			const description = formData.get("description")
			const sectionLeaderRaw = formData.get("sectionLeader")
			const techLeadRaw = formData.get("techLead")

			if (typeof name !== "string" || !name.trim()) {
				return data<ActionResult>({ success: false, error: "Navn er påkrevd." })
			}
			if (typeof sectionLeaderRaw !== "string" || !sectionLeaderRaw.trim()) {
				return data<ActionResult>({ success: false, error: "Seksjonsleder er påkrevd." })
			}
			if (typeof techLeadRaw !== "string" || !techLeadRaw.trim()) {
				return data<ActionResult>({ success: false, error: "Teknologileder er påkrevd." })
			}

			const isPersonRef = (v: unknown): v is { navIdent: string; displayName: string } =>
				typeof v === "object" &&
				v !== null &&
				!Array.isArray(v) &&
				typeof (v as Record<string, unknown>).navIdent === "string" &&
				typeof (v as Record<string, unknown>).displayName === "string" &&
				((v as Record<string, unknown>).navIdent as string).trim().length > 0 &&
				((v as Record<string, unknown>).displayName as string).trim().length > 0

			let sectionLeaderParsed: unknown
			let techLeadParsed: unknown
			try {
				sectionLeaderParsed = JSON.parse(sectionLeaderRaw)
				techLeadParsed = JSON.parse(techLeadRaw)
			} catch {
				return data<ActionResult>({ success: false, error: "Ugyldig persondata. Last siden på nytt og prøv igjen." })
			}

			if (!isPersonRef(sectionLeaderParsed)) {
				return data<ActionResult>({ success: false, error: "Seksjonsleder er påkrevd." })
			}
			if (!isPersonRef(techLeadParsed)) {
				return data<ActionResult>({ success: false, error: "Teknologileder er påkrevd." })
			}

			const sectionLeader = {
				navIdent: sectionLeaderParsed.navIdent.trim().toUpperCase(),
				displayName: sectionLeaderParsed.displayName.trim(),
			}
			const techLead = {
				navIdent: techLeadParsed.navIdent.trim().toUpperCase(),
				displayName: techLeadParsed.displayName.trim(),
			}

			const result = await createSection({
				name: name.trim(),
				description: typeof description === "string" ? description.trim() || null : null,
				sectionLeader,
				techLead,
				createdBy: userId,
			})

			if (result.conflict) {
				return data<ActionResult>({
					success: false,
					error: `En seksjon med identisk navn eller URL-segment finnes allerede. Velg et annet navn.`,
				})
			}

			return data<ActionResult>({ success: true, message: `Seksjon «${name.trim()}» opprettet.` })
		}

		case "archive-section": {
			const id = formData.get("id")
			if (typeof id !== "string") {
				return data<ActionResult>({ success: false, error: "Mangler seksjon-ID." })
			}
			await archiveSection(id, userId)
			return data<ActionResult>({ success: true, message: "Seksjon arkivert." })
		}

		case "unarchive-section": {
			const id = formData.get("id")
			if (typeof id !== "string") {
				return data<ActionResult>({ success: false, error: "Mangler seksjon-ID." })
			}
			await unarchiveSection(id, userId)
			return data<ActionResult>({ success: true, message: "Seksjon reaktivert." })
		}

		default:
			return data<ActionResult>({ success: false, error: "Ugyldig handling." })
	}
}

function ConfirmModal({
	open,
	onClose,
	title,
	message,
	confirmLabel,
	confirmVariant,
	formData,
}: {
	open: boolean
	onClose: () => void
	title: string
	message: string
	confirmLabel: string
	confirmVariant: "danger" | "primary"
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
						<Button type="submit" variant={confirmVariant}>
							{confirmLabel}
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
	const [archiveOpen, setArchiveOpen] = useState(false)
	const isArchived = section.archivedAt !== null

	return (
		<VStack gap="space-4" className="admin-card" key={section.id}>
			<HStack gap="space-4" align="center" justify="space-between">
				<VStack gap="space-2">
					<HStack gap="space-2" align="center">
						<Heading size="medium" level="3">
							{section.name}
						</Heading>
						{isArchived && (
							<Tag variant="warning" size="small">
								Arkivert
							</Tag>
						)}
					</HStack>
					{section.description && <BodyLong size="small">{section.description}</BodyLong>}
					<Tag variant="neutral" size="small">
						{section.teams.length} team
					</Tag>
				</VStack>
				<HStack gap="space-2">
					<Button as={Link} to={`/seksjoner/${section.slug}/rediger`} variant="secondary" size="small">
						Rediger
					</Button>
					{isArchived ? (
						<Button variant="primary" size="small" onClick={() => setArchiveOpen(true)}>
							Reaktiver
						</Button>
					) : (
						<Button variant="danger" size="small" onClick={() => setArchiveOpen(true)}>
							Arkiver
						</Button>
					)}
				</HStack>
			</HStack>

			<ConfirmModal
				open={archiveOpen}
				onClose={() => setArchiveOpen(false)}
				title={isArchived ? `Reaktiver seksjon: ${section.name}` : `Arkiver seksjon: ${section.name}`}
				message={
					isArchived
						? `Vil du reaktivere seksjonen «${section.name}»? Den blir igjen synlig i seksjonslisten.`
						: `Vil du arkivere seksjonen «${section.name}»? Seksjonen blir skjult fra seksjonslisten, men data og historikk beholdes. Du kan reaktivere den senere.`
				}
				confirmLabel={isArchived ? "Reaktiver" : "Arkiver"}
				confirmVariant={isArchived ? "primary" : "danger"}
				formData={{ intent: isArchived ? "unarchive-section" : "archive-section", id: section.id }}
			/>
		</VStack>
	)
}

const actionLabels: Record<string, string> = {
	section_created: "Seksjon opprettet",
	section_updated: "Seksjon oppdatert",
	section_deleted: "Seksjon slettet",
	section_archived: "Seksjon arkivert",
	section_unarchived: "Seksjon reaktivert",
	team_created: "Team opprettet",
	team_updated: "Team oppdatert",
	team_deleted: "Team slettet",
	team_archived: "Team arkivert",
	team_unarchived: "Team reaktivert",
}

export default function AdminSeksjoner() {
	const { sections, auditEntries } = useLoaderData<typeof loader>()
	const actionData = useActionData<typeof action>()
	const [opprettOpen, setOpprettOpen] = useState(false)

	return (
		<VStack gap="space-6">
			<HStack justify="space-between" align="center">
				<Heading size="xlarge" level="2">
					Administrer seksjoner
				</Heading>
				<Button variant="primary" onClick={() => setOpprettOpen(true)}>
					Opprett seksjon
				</Button>
			</HStack>
			<BodyLong>Rediger og arkiver seksjoner og utviklingsteam.</BodyLong>

			{opprettOpen && <OpprettSeksjonModal open onClose={() => setOpprettOpen(false)} />}

			{actionData && "success" in actionData && actionData.success && (
				<Alert variant="success">{actionData.message}</Alert>
			)}
			{actionData && "success" in actionData && !actionData.success && (
				<Alert variant="error">{actionData.error}</Alert>
			)}

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

			{sections.length === 0 && <BodyLong>Ingen seksjoner funnet.</BodyLong>}

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
													entry.action.includes("unarchived")
														? "success"
														: entry.action.includes("deleted") || entry.action.includes("archived")
															? "warning"
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
