import {
	Alert,
	BodyShort,
	Button,
	Detail,
	Heading,
	HStack,
	Modal,
	Table,
	Tag,
	Textarea,
	VStack,
} from "@navikt/ds-react"
import { useRef, useState } from "react"
import { Form, Link, useFetcher } from "react-router"

interface ScreeningSession {
	id: string
	title: string
	status: string
	completedAt: string | null
	completedBy: string | null
	createdAt: string
	createdBy: string
	archivedAt: string | null
	archivedBy: string | null
	archiveReason: string | null
	participants: Array<{ userIdent: string; userName: string | null }>
}

export function ScreeningerTab({
	screeningSessions = [],
	appBasePath,
	canAdmin,
}: {
	screeningSessions: ScreeningSession[]
	appBasePath: string
	canAdmin: boolean
}) {
	const [showCreateModal, setShowCreateModal] = useState(false)
	const createModalRef = useRef<HTMLDialogElement>(null)

	const activeSessions = screeningSessions.filter((s) => !s.archivedAt)
	const archivedSessions = screeningSessions.filter((s) => s.archivedAt)
	const draftSessions = activeSessions.filter((s) => s.status === "draft")
	const completedSessions = activeSessions.filter((s) => s.status === "completed")

	return (
		<VStack gap="space-8">
			<HStack justify="space-between" align="center">
				<Heading size="medium" level="3">
					Screeninger
				</Heading>
				<Button
					variant="primary"
					size="small"
					onClick={() => setShowCreateModal(true)}
					disabled={draftSessions.length > 0}
				>
					Start ny screening
				</Button>
			</HStack>

			{draftSessions.length > 0 && (
				<>
					<Alert variant="info" size="small">
						Det finnes allerede en påbegynt screening. Fullfør eller fjern den før du starter en ny.
					</Alert>
					<VStack gap="space-4">
						<Heading size="small" level="4">
							Påbegynte
						</Heading>
						<SessionTable sessions={draftSessions} appBasePath={appBasePath} canAdmin={canAdmin} />
					</VStack>
				</>
			)}

			{completedSessions.length > 0 && (
				<VStack gap="space-4">
					<Heading size="small" level="4">
						Fullførte
					</Heading>
					<SessionTable sessions={completedSessions} appBasePath={appBasePath} canAdmin={canAdmin} />
				</VStack>
			)}

			{activeSessions.length === 0 && <BodyShort>Ingen screeninger er opprettet ennå.</BodyShort>}

			{canAdmin && archivedSessions.length > 0 && (
				<VStack gap="space-4">
					<Heading size="small" level="4">
						Fjernede
					</Heading>
					<ArchivedSessionTable sessions={archivedSessions} />
				</VStack>
			)}

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

function SessionTable({
	sessions,
	appBasePath,
	canAdmin,
}: {
	sessions: ScreeningSession[]
	appBasePath: string
	canAdmin: boolean
}) {
	const [archiveSessionId, setArchiveSessionId] = useState<string | null>(null)
	const [reason, setReason] = useState("")
	const [reasonError, setReasonError] = useState<string | null>(null)
	const archiveModalRef = useRef<HTMLDialogElement>(null)
	const fetcher = useFetcher()

	const handleArchiveSubmit = () => {
		const trimmedReason = reason.trim()
		if (!trimmedReason) {
			setReasonError("Du må oppgi en begrunnelse")
			return
		}
		fetcher.submit(
			{
				intent: "archive-screening-session",
				sessionId: archiveSessionId ?? "",
				reason: trimmedReason,
			},
			{ method: "post" },
		)
		setArchiveSessionId(null)
		setReason("")
		setReasonError(null)
	}

	return (
		<>
			{/* biome-ignore lint/a11y/noNoninteractiveTabindex: Required for keyboard navigation on scrollable table */}
			<section className="table-scroll" tabIndex={0} aria-label="Screening-oversikt">
				<Table size="small">
					<Table.Header>
						<Table.Row>
							<Table.HeaderCell>Tittel</Table.HeaderCell>
							<Table.HeaderCell>Status</Table.HeaderCell>
							<Table.HeaderCell>Deltakere</Table.HeaderCell>
							<Table.HeaderCell>Opprettet</Table.HeaderCell>
							<Table.HeaderCell>Fullført</Table.HeaderCell>
							{canAdmin && <Table.HeaderCell />}
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
								<Table.DataCell>{formatTimestamp(session.createdAt)}</Table.DataCell>
								<Table.DataCell>{session.completedAt ? formatTimestamp(session.completedAt) : "—"}</Table.DataCell>
								{canAdmin && (
									<Table.DataCell>
										<Button
											type="button"
											variant="tertiary-neutral"
											size="xsmall"
											onClick={() => {
												setReason("")
												setReasonError(null)
												setArchiveSessionId(session.id)
											}}
										>
											Fjern
										</Button>
									</Table.DataCell>
								)}
							</Table.Row>
						))}
					</Table.Body>
				</Table>
			</section>

			<Modal
				ref={archiveModalRef}
				open={archiveSessionId !== null}
				onClose={() => {
					setArchiveSessionId(null)
					setReason("")
					setReasonError(null)
				}}
				header={{ heading: "Fjern screening" }}
			>
				<Modal.Body>
					<VStack gap="space-6">
						<BodyShort>Screeningen fjernes fra oversikten. Den kan gjenopprettes senere av en administrator.</BodyShort>
						<Textarea
							label="Begrunnelse"
							value={reason}
							onChange={(e) => setReason(e.target.value)}
							minRows={2}
							error={reasonError ?? undefined}
						/>
						<HStack gap="space-4" justify="end">
							<Button
								type="button"
								variant="secondary"
								size="small"
								onClick={() => {
									setArchiveSessionId(null)
									setReason("")
									setReasonError(null)
								}}
							>
								Avbryt
							</Button>
							<Button type="button" variant="danger" size="small" onClick={handleArchiveSubmit}>
								Fjern screening
							</Button>
						</HStack>
					</VStack>
				</Modal.Body>
			</Modal>
		</>
	)
}

function ArchivedSessionTable({ sessions }: { sessions: ScreeningSession[] }) {
	return (
		// biome-ignore lint/a11y/noNoninteractiveTabindex: Required for keyboard navigation on scrollable table
		<section className="table-scroll" tabIndex={0} aria-label="Fjernede screeninger">
			<Table size="small">
				<Table.Header>
					<Table.Row>
						<Table.HeaderCell>Tittel</Table.HeaderCell>
						<Table.HeaderCell>Status</Table.HeaderCell>
						<Table.HeaderCell>Fjernet</Table.HeaderCell>
						<Table.HeaderCell>Begrunnelse</Table.HeaderCell>
						<Table.HeaderCell />
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{sessions.map((session) => (
						<Table.Row key={session.id} className="archived-row">
							<Table.DataCell>
								<BodyShort textColor="subtle">{session.title}</BodyShort>
							</Table.DataCell>
							<Table.DataCell>
								<Tag variant="neutral" size="small">
									Fjernet
								</Tag>
							</Table.DataCell>
							<Table.DataCell>
								<VStack>
									<BodyShort size="small" textColor="subtle">
										{session.archivedAt ? formatTimestamp(session.archivedAt) : "—"}
									</BodyShort>
									{session.archivedBy && <Detail textColor="subtle">{session.archivedBy}</Detail>}
								</VStack>
							</Table.DataCell>
							<Table.DataCell>
								<BodyShort size="small" textColor="subtle">
									{session.archiveReason || "—"}
								</BodyShort>
							</Table.DataCell>
							<Table.DataCell>
								<Form method="post">
									<input type="hidden" name="intent" value="restore-screening-session" />
									<input type="hidden" name="sessionId" value={session.id} />
									<Button type="submit" variant="tertiary" size="xsmall">
										Angre
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

function formatTimestamp(dateStr: string) {
	return new Date(dateStr).toLocaleString("nb-NO", {
		day: "2-digit",
		month: "2-digit",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	})
}
