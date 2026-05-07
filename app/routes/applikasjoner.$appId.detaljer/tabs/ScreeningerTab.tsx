import { BodyShort, Button, Heading, HStack, Modal, Table, Tag, VStack } from "@navikt/ds-react"
import { useRef, useState } from "react"
import { Form, Link } from "react-router"

interface ScreeningSession {
	id: string
	title: string
	status: string
	completedAt: string | null
	completedBy: string | null
	createdAt: string
	createdBy: string
	participants: Array<{ userIdent: string; userName: string | null }>
}

export function ScreeningerTab({
	screeningSessions = [],
	appBasePath,
}: {
	screeningSessions: ScreeningSession[]
	appBasePath: string
}) {
	const [showCreateModal, setShowCreateModal] = useState(false)
	const createModalRef = useRef<HTMLDialogElement>(null)

	const draftSessions = screeningSessions.filter((s) => s.status === "draft")
	const completedSessions = screeningSessions.filter((s) => s.status === "completed")

	return (
		<VStack gap="space-8">
			<HStack justify="space-between" align="center">
				<Heading size="medium" level="3">
					Screeninger
				</Heading>
				<Button variant="primary" size="small" onClick={() => setShowCreateModal(true)}>
					Start ny screening
				</Button>
			</HStack>

			{draftSessions.length > 0 && (
				<VStack gap="space-4">
					<Heading size="small" level="4">
						Påbegynte
					</Heading>
					<SessionTable sessions={draftSessions} appBasePath={appBasePath} />
				</VStack>
			)}

			{completedSessions.length > 0 && (
				<VStack gap="space-4">
					<Heading size="small" level="4">
						Fullførte
					</Heading>
					<SessionTable sessions={completedSessions} appBasePath={appBasePath} />
				</VStack>
			)}

			{screeningSessions.length === 0 && <BodyShort>Ingen screeninger er opprettet ennå.</BodyShort>}

			<Modal
				ref={createModalRef}
				open={showCreateModal}
				onClose={() => setShowCreateModal(false)}
				header={{ heading: "Start ny screening" }}
			>
				<Modal.Body>
					<Form method="post" onSubmit={() => setShowCreateModal(false)}>
						<VStack gap="space-6">
							<input type="hidden" name="intent" value="create-screening-session" />
							<BodyShort>En ny screening opprettes. Du kan legge til deltakere i første steg av screeningen.</BodyShort>
							<Button type="submit" variant="primary">
								Opprett screening
							</Button>
						</VStack>
					</Form>
				</Modal.Body>
			</Modal>
		</VStack>
	)
}

function SessionTable({ sessions, appBasePath }: { sessions: ScreeningSession[]; appBasePath: string }) {
	return (
		// biome-ignore lint/a11y/noNoninteractiveTabindex: Required for keyboard navigation on scrollable table
		<section className="table-scroll" tabIndex={0} aria-label="Screening-oversikt">
			<Table size="small">
				<Table.Header>
					<Table.Row>
						<Table.HeaderCell>Tittel</Table.HeaderCell>
						<Table.HeaderCell>Status</Table.HeaderCell>
						<Table.HeaderCell>Deltakere</Table.HeaderCell>
						<Table.HeaderCell>Opprettet</Table.HeaderCell>
						<Table.HeaderCell>Fullført</Table.HeaderCell>
						<Table.HeaderCell />
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{sessions.map((session) => (
						<Table.Row key={session.id}>
							<Table.DataCell>
								<Link to={`${appBasePath}/screening/${session.id}`}>{session.title}</Link>
							</Table.DataCell>
							<Table.DataCell>
								<Tag variant={session.status === "completed" ? "success" : "info"} size="small">
									{session.status === "completed" ? "Fullført" : "Påbegynt"}
								</Tag>
							</Table.DataCell>
							<Table.DataCell>
								{session.participants.map((p) => p.userName ?? p.userIdent).join(", ") || "—"}
							</Table.DataCell>
							<Table.DataCell>
								{new Date(session.createdAt).toLocaleString("nb-NO", {
									day: "2-digit",
									month: "2-digit",
									year: "numeric",
									hour: "2-digit",
									minute: "2-digit",
								})}
							</Table.DataCell>
							<Table.DataCell>
								{session.completedAt
									? new Date(session.completedAt).toLocaleString("nb-NO", {
											day: "2-digit",
											month: "2-digit",
											year: "numeric",
											hour: "2-digit",
											minute: "2-digit",
										})
									: "—"}
							</Table.DataCell>
							<Table.DataCell>
								<Form method="post">
									<input type="hidden" name="intent" value="archive-screening-session" />
									<input type="hidden" name="sessionId" value={session.id} />
									<Button
										type="submit"
										variant="tertiary-neutral"
										size="xsmall"
										onClick={(e) => {
											if (!confirm("Er du sikker på at du vil fjerne denne screeningen?")) {
												e.preventDefault()
											}
										}}
									>
										Fjern
									</Button>
								</Form>
							</Table.DataCell>
						</Table.Row>
					))}
				</Table.Body>
			</Table>
		</section>
	)
}
