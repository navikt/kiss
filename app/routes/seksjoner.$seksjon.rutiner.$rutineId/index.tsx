import {
	BodyShort,
	Box,
	Button,
	Detail,
	Heading,
	HStack,
	Label,
	LocalAlert,
	Modal,
	Table,
	Tag,
	VStack,
} from "@navikt/ds-react"
import { useRef } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Link, redirect, useFetcher, useLoaderData } from "react-router"
import { FrequencyDisplay } from "~/components/FrequencyDisplay"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import {
	approveRoutine,
	archiveRoutine,
	calculateDeadline,
	copyRoutine,
	getAppsRequiringRoutine,
	getLatestReviewForApp,
	getLatestSectionReview,
	getReviewsForRoutine,
	getRoutine,
	isOverdue,
} from "~/db/queries/routines.server"
import { getScreeningQuestion } from "~/db/queries/screening.server"
import { getSectionBySlug } from "~/db/queries/sections.server"
import {
	type DataClassification,
	dataClassificationLabels,
	type GroupAccessClassification,
	groupAccessClassificationLabels,
	type PersistenceType,
	persistenceTypeLabels,
} from "~/db/schema/applications"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { canApproveRoutine, hasAnySectionRole, isAdmin, requireAnySectionRole } from "~/lib/authorization.server"
import { renderMarkdown } from "~/lib/markdown.server"
import type { RoutineFrequency } from "~/lib/routine-frequencies"

function formatDate(date: string | Date | null): string {
	if (!date) return "—"
	return new Date(date).toLocaleDateString("nb-NO")
}

function formatDateTime(date: string | Date | null): string {
	if (!date) return "—"
	return new Date(date).toLocaleDateString("nb-NO", {
		day: "numeric",
		month: "short",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	})
}

export async function loader({ request, params }: LoaderFunctionArgs) {
	const { seksjon, rutineId } = params
	if (!seksjon || !rutineId) {
		throw data({ message: "Mangler parametere" }, { status: 400 })
	}

	const user = await getAuthenticatedUser(request)
	const section = await getSectionBySlug(seksjon)
	if (!section) {
		throw data({ message: `Fant ikke seksjon: ${seksjon}` }, { status: 404 })
	}

	const routine = await getRoutine(rutineId)
	if (!routine) {
		throw data({ message: `Fant ikke rutine: ${rutineId}` }, { status: 404 })
	}

	if (routine.sectionId !== section.id) {
		throw data({ message: "Rutinen tilhører ikke denne seksjonen" }, { status: 403 })
	}

	const [reviews, apps] = await Promise.all([getReviewsForRoutine(rutineId), getAppsRequiringRoutine(rutineId)])

	// Fetch screening question text if linked
	let screeningQuestion: { id: string; questionText: string } | null = null
	if (routine.screeningQuestionId) {
		screeningQuestion = await getScreeningQuestion(routine.screeningQuestionId)
	}

	// Calculate deadline info for each app
	// For section routines, use section-level review (applicationId IS NULL) for all apps
	let sectionLevelReview: Awaited<ReturnType<typeof getLatestReviewForApp>> | null = null
	if (routine.isSectionRoutine === 1) {
		sectionLevelReview = await getLatestSectionReview(rutineId)
	}

	const appsWithDeadlines = await Promise.all(
		apps.map(async (app) => {
			const latestReview =
				routine.isSectionRoutine === 1 ? sectionLevelReview : await getLatestReviewForApp(rutineId, app.id)
			const lastReviewDate = latestReview?.reviewedAt ?? null
			const deadline = calculateDeadline(
				lastReviewDate,
				routine.createdAt,
				routine.frequency as RoutineFrequency | null,
			)
			const overdue = isOverdue(deadline)

			return {
				id: app.id,
				name: app.name,
				lastReviewDate,
				deadline,
				overdue,
				neverReviewed: !latestReview && routine.frequency !== null,
			}
		}),
	)

	const effectiveRole = routine.responsibleRole || routine.controls.find((c) => c.responsible)?.responsible || null
	const userCanApprove = user ? canApproveRoutine(user, effectiveRole, section.id) : false
	const userCanAdmin = user ? isAdmin(user) : false
	const userCanEdit = user ? hasAnySectionRole(user, section.id) : false

	return data({
		section,
		routine,
		reviews,
		appsWithDeadlines,
		screeningQuestion,
		descriptionHtml: renderMarkdown(routine.description),
		userCanApprove,
		userCanAdmin,
		userCanEdit,
		effectiveRole,
	})
}

export async function action({ request, params }: ActionFunctionArgs) {
	const { seksjon, rutineId } = params
	if (!seksjon || !rutineId) throw data({ message: "Mangler parametere" }, { status: 400 })

	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)

	const section = await getSectionBySlug(seksjon)
	if (!section) throw data({ message: `Fant ikke seksjon: ${seksjon}` }, { status: 404 })

	const routine = await getRoutine(rutineId)
	if (!routine) throw data({ message: `Fant ikke rutine: ${rutineId}` }, { status: 404 })

	if (routine.sectionId !== section.id) {
		throw data({ message: "Rutinen tilhører ikke denne seksjonen" }, { status: 403 })
	}

	const formData = await request.formData()
	const intent = formData.get("intent")

	// Arkiverte rutiner kan ikke godkjennes eller kopieres — reaktiver først.
	if (routine.archivedAt && (intent === "approve" || intent === "copy")) {
		throw data({ message: "Arkiverte rutiner kan ikke endres. Reaktiver rutinen først." }, { status: 403 })
	}

	if (intent === "approve") {
		const effectiveRole = routine.responsibleRole || routine.controls.find((c) => c.responsible)?.responsible || null
		if (!canApproveRoutine(authedUser, effectiveRole, section.id)) {
			throw data({ message: "Du har ikke riktig rolle til å godkjenne denne rutinen" }, { status: 403 })
		}
		await approveRoutine(rutineId, authedUser.navIdent)
		return redirect(`/seksjoner/${seksjon}/rutiner/${rutineId}`)
	}

	if (intent === "copy") {
		requireAnySectionRole(authedUser, section.id)
		const copy = await copyRoutine(rutineId, authedUser.navIdent)
		if (!copy) throw data({ message: "Kunne ikke kopiere rutine" }, { status: 500 })
		return redirect(`/seksjoner/${seksjon}/rutiner/${copy.id}/rediger`)
	}

	if (intent === "archive") {
		if (routine.archivedAt) {
			throw data({ message: "Rutinen er allerede arkivert." }, { status: 409 })
		}
		if (routine.status !== "approved") {
			throw data({ message: "Kun godkjente rutiner kan arkiveres." }, { status: 400 })
		}
		const effectiveRole = routine.responsibleRole || routine.controls.find((c) => c.responsible)?.responsible || null
		if (!isAdmin(authedUser) && !canApproveRoutine(authedUser, effectiveRole, section.id)) {
			throw data({ message: "Du har ikke rettigheter til å arkivere denne rutinen." }, { status: 403 })
		}
		await archiveRoutine(rutineId, authedUser.navIdent)
		return redirect(`/seksjoner/${seksjon}/rutiner/${rutineId}`)
	}

	throw data({ message: `Ukjent handling: ${intent}` }, { status: 400 })
}

export default function RutineDetaljer() {
	const {
		section,
		routine,
		reviews,
		appsWithDeadlines,
		screeningQuestion,
		descriptionHtml,
		userCanApprove,
		userCanAdmin,
		userCanEdit,
		effectiveRole,
	} = useLoaderData<typeof loader>()
	const fetcher = useFetcher()
	const archiveFetcher = useFetcher()
	const archiveModalRef = useRef<HTMLDialogElement>(null)
	const userCanArchive = !routine.archivedAt && routine.status === "approved" && (userCanAdmin || userCanApprove)

	return (
		<VStack gap="space-12">
			<VStack gap="space-2">
				<Detail>
					<Link to="..">{section.name} / Rutiner</Link>
				</Detail>
				<HStack gap="space-4" align="center" justify="space-between">
					<HStack gap="space-4" align="center">
						<Heading size="xlarge" level="2">
							{routine.name}
						</Heading>
						{routine.status === "draft" && (
							<Tag variant="warning" size="small">
								Kladd
							</Tag>
						)}
						{routine.status === "ready" && (
							<Tag variant="info" size="small">
								Ferdig
							</Tag>
						)}
						{routine.status === "approved" && (
							<Tag variant="success" size="small">
								Godkjent
							</Tag>
						)}
						{routine.archivedAt ? (
							<Tag variant="neutral" size="small">
								Arkivert
							</Tag>
						) : (
							routine.status === "archived" && (
								<Tag variant="neutral" size="small">
									Arkivert
								</Tag>
							)
						)}
						{routine.isSectionRoutine === 1 && (
							<Tag variant="alt1" size="small">
								Seksjonsrutine
							</Tag>
						)}
					</HStack>
					<HStack gap="space-2">
						{(routine.status !== "approved" || routine.archivedAt) && (
							<Button as={Link} to="./rediger" variant="secondary" size="small">
								Rediger
							</Button>
						)}
						{!routine.archivedAt && routine.status === "approved" && userCanEdit && (
							<fetcher.Form method="post">
								<input type="hidden" name="intent" value="copy" />
								<Button type="submit" variant="secondary" size="small" loading={fetcher.state !== "idle"}>
									Kopier for endring
								</Button>
							</fetcher.Form>
						)}
						{!routine.archivedAt && routine.status === "ready" && userCanApprove && (
							<fetcher.Form method="post">
								<input type="hidden" name="intent" value="approve" />
								<Button type="submit" variant="primary" size="small" loading={fetcher.state !== "idle"}>
									Godkjenn
								</Button>
							</fetcher.Form>
						)}
						{userCanArchive && (
							<Button variant="tertiary" size="small" onClick={() => archiveModalRef.current?.showModal()}>
								Arkiver
							</Button>
						)}
					</HStack>
				</HStack>
				{routine.archivedAt && (
					<LocalAlert status="warning">
						<LocalAlert.Header>
							<LocalAlert.Title>Rutinen er arkivert</LocalAlert.Title>
						</LocalAlert.Header>
						<LocalAlert.Content>
							<BodyShort size="small">
								Arkivert {new Date(routine.archivedAt).toLocaleString("nb-NO")}
								{routine.archivedBy ? ` av ${routine.archivedBy}` : ""}. Godkjenning, kopiering og nye gjennomganger er
								deaktivert til rutinen reaktiveres. Bruk «Rediger» for å reaktivere.
							</BodyShort>
						</LocalAlert.Content>
					</LocalAlert>
				)}
				{routine.status === "ready" && !userCanApprove && (
					<BodyShort size="small" textColor="subtle">
						Godkjenning krever rollen{" "}
						{effectiveRole ? (
							<>
								<strong>{effectiveRole}</strong> for seksjonen «{section.name}»
							</>
						) : (
							<>
								<strong>Admin</strong> (ingen ansvarlig rolle er satt)
							</>
						)}
						. Roller tildeles av administrator.
					</BodyShort>
				)}
			</VStack>

			{/* Info section */}
			<VStack gap="space-6">
				{routine.isSectionRoutine === 1 && (
					<VStack gap="space-2">
						<Label size="small">Eier / Utførende rolle</Label>
						<BodyShort>{routine.sectionRoutineOwnerRole ?? "Ikke satt"}</BodyShort>
						<BodyShort size="small" textColor="subtle">
							Denne rutinen gjennomgås på seksjonsnivå og gjelder alle applikasjoner i seksjonen.
						</BodyShort>
					</VStack>
				)}
				{descriptionHtml && (
					<VStack gap="space-2">
						<Label size="small">Beskrivelse</Label>
						{/* biome-ignore lint/security/noDangerouslySetInnerHtml: server-sanitized markdown */}
						<div className="markdown-content" dangerouslySetInnerHTML={{ __html: descriptionHtml }} />
					</VStack>
				)}

				<VStack gap="space-2">
					<Label size="small">Frekvens</Label>
					<HStack gap="space-2" align="center">
						<FrequencyDisplay frequency={routine.frequency} eventFrequency={routine.eventFrequency} />
					</HStack>
				</VStack>

				{routine.technologyElements.length > 0 && (
					<VStack gap="space-2">
						<Label size="small">Teknologielementer</Label>
						<HStack gap="space-2" wrap>
							{routine.technologyElements.map((te) => (
								<Tag key={te.id} variant="neutral" size="small">
									{te.name}
								</Tag>
							))}
						</HStack>
					</VStack>
				)}

				{routine.persistenceLinks.length > 0 && (
					<VStack gap="space-2">
						<Label size="small">Database og klassifisering</Label>
						{routine.persistenceLinks.map((pl) => (
							<HStack key={pl.id} gap="space-2" wrap>
								{pl.persistenceType && (
									<Tag variant="info" size="small">
										{persistenceTypeLabels[pl.persistenceType as PersistenceType] ?? pl.persistenceType}
									</Tag>
								)}
								{pl.dataClassification && (
									<Tag variant="warning" size="small">
										{dataClassificationLabels[pl.dataClassification as DataClassification] ?? pl.dataClassification}
									</Tag>
								)}
							</HStack>
						))}
					</VStack>
				)}

				{routine.groupClassifications.length > 0 && (
					<VStack gap="space-2">
						<Label size="small">Tilgangsklassifisering for Entra ID-grupper</Label>
						<HStack gap="space-2" wrap>
							{routine.groupClassifications.map((gc) => (
								<Tag key={gc.id} variant="info" size="small">
									{groupAccessClassificationLabels[gc.classification as GroupAccessClassification] ?? gc.classification}
								</Tag>
							))}
						</HStack>
					</VStack>
				)}

				{(() => {
					const effectiveRole = routine.responsibleRole || routine.controls.find((c) => c.responsible)?.responsible
					if (!effectiveRole) return null
					const isInherited = !routine.responsibleRole
					return (
						<VStack gap="space-2">
							<Label size="small">Ansvarlig rolle</Label>
							<HStack gap="space-2" align="center">
								<Tag variant="alt1" size="small">
									{effectiveRole}
								</Tag>
								{isInherited && (
									<BodyShort size="small" textColor="subtle">
										(arvet fra krav)
									</BodyShort>
								)}
							</HStack>
						</VStack>
					)
				})()}

				{routine.controls.length > 0 && (
					<VStack gap="space-2">
						<Label size="small">Tilknyttede krav</Label>
						<HStack gap="space-2" wrap>
							{routine.controls.map((ctrl) => (
								<Tag key={ctrl.id} variant="info" size="small">
									<Link to={`/kontrollrammeverk/${ctrl.domainSlug}/${ctrl.controlId}`}>
										{ctrl.controlId} – {ctrl.name}
									</Link>
								</Tag>
							))}
						</HStack>
					</VStack>
				)}

				{screeningQuestion && (
					<VStack gap="space-2">
						<Label size="small">Innledende spørsmål</Label>
						<BodyShort>
							{screeningQuestion.questionText}
							{routine.screeningChoiceValue && (
								<>
									{" "}
									— påkrevd svar:{" "}
									<Tag variant="alt1" size="small">
										{routine.screeningChoiceValue}
									</Tag>
								</>
							)}
						</BodyShort>
					</VStack>
				)}
			</VStack>

			{/* Approval info */}
			{routine.status === "approved" && routine.approvedBy && (
				<VStack gap="space-2">
					<Label size="small">Godkjenning</Label>
					<BodyShort size="small">
						Godkjent av {routine.approvedBy}
						{routine.approvedAt && <> den {formatDateTime(routine.approvedAt)}</>}
					</BodyShort>
				</VStack>
			)}

			{/* Source routine link */}
			{routine.sourceRoutineId && (
				<VStack gap="space-2">
					<Label size="small">Opphav</Label>
					<BodyShort size="small">
						<Link to={`/seksjoner/${section.slug}/rutiner/${routine.sourceRoutineId}`}>Vis opprinnelig rutine</Link>
					</BodyShort>
				</VStack>
			)}

			{/* Replaced-by link */}
			{routine.replacedByRoutineId && (
				<VStack gap="space-2">
					<Label size="small">Erstattet av</Label>
					<BodyShort size="small">
						<Link to={`/seksjoner/${section.slug}/rutiner/${routine.replacedByRoutineId}`}>Vis erstattende rutine</Link>
					</BodyShort>
				</VStack>
			)}

			{/* Apps requiring this routine */}
			<VStack gap="space-4">
				<Heading size="medium" level="3">
					Applikasjoner som krever denne rutinen
				</Heading>
				{appsWithDeadlines.length === 0 ? (
					<Box padding="space-6" borderRadius="8" background="sunken">
						<BodyShort>Ingen applikasjoner krever denne rutinen.</BodyShort>
					</Box>
				) : (
					<Table>
						<Table.Header>
							<Table.Row>
								<Table.HeaderCell>Applikasjon</Table.HeaderCell>
								<Table.HeaderCell>Siste gjennomgang</Table.HeaderCell>
								<Table.HeaderCell>Frist</Table.HeaderCell>
								<Table.HeaderCell>Status</Table.HeaderCell>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{appsWithDeadlines.map((app) => (
								<Table.Row key={app.id}>
									<Table.DataCell>
										<Link to={`/applikasjoner/${app.id}/detaljer`}>{app.name}</Link>
									</Table.DataCell>
									<Table.DataCell>{formatDate(app.lastReviewDate)}</Table.DataCell>
									<Table.DataCell>{app.deadline ? formatDate(app.deadline) : "Ingen frist"}</Table.DataCell>
									<Table.DataCell>
										{!routine.frequency ? (
											<Tag variant="info" size="small">
												{routine.eventFrequency ?? "Ved behov"}
											</Tag>
										) : app.neverReviewed ? (
											<Tag variant="warning" size="small">
												Ikke gjennomført
											</Tag>
										) : app.overdue ? (
											<Tag variant="error" size="small">
												Over frist
											</Tag>
										) : (
											<Tag variant="success" size="small">
												OK
											</Tag>
										)}
									</Table.DataCell>
								</Table.Row>
							))}
						</Table.Body>
					</Table>
				)}
			</VStack>

			{/* Review history */}
			<VStack gap="space-4">
				<Heading size="medium" level="3">
					Gjennomganger
				</Heading>
				{reviews.length === 0 ? (
					<Box padding="space-6" borderRadius="8" background="sunken">
						<BodyShort>Ingen gjennomganger er registrert ennå.</BodyShort>
					</Box>
				) : (
					<Table>
						<Table.Header>
							<Table.Row>
								<Table.HeaderCell>Dato</Table.HeaderCell>
								<Table.HeaderCell>Applikasjon</Table.HeaderCell>
								<Table.HeaderCell>Tittel</Table.HeaderCell>
								<Table.HeaderCell>Status</Table.HeaderCell>
								<Table.HeaderCell>Opprettet av</Table.HeaderCell>
								<Table.HeaderCell>Deltakere</Table.HeaderCell>
								<Table.HeaderCell>Vedlegg</Table.HeaderCell>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{reviews.map((review) => {
								const confirmedCount = review.participants.filter((p) => p.confirmedAt).length
								return (
									<Table.Row key={review.id}>
										<Table.DataCell>{formatDateTime(review.reviewedAt)}</Table.DataCell>
										<Table.DataCell>
											{review.applicationId ? (
												<Link to={`/applikasjoner/${review.applicationId}/detaljer`}>
													{review.applicationName ?? "Ukjent"}
												</Link>
											) : (
												"—"
											)}
										</Table.DataCell>
										<Table.DataCell>
											<Link to={`./gjennomgang/${review.id}`}>{review.title}</Link>
										</Table.DataCell>
										<Table.DataCell>
											{review.status === "completed" ? (
												<Tag variant="success" size="xsmall">
													Fullført
												</Tag>
											) : (
												<Tag variant="warning" size="xsmall">
													Utkast
												</Tag>
											)}
										</Table.DataCell>
										<Table.DataCell>{review.createdBy}</Table.DataCell>
										<Table.DataCell>
											{review.participants.length > 0
												? `${confirmedCount}/${review.participants.length} bekreftet`
												: "—"}
										</Table.DataCell>
										<Table.DataCell>{review.attachments.length}</Table.DataCell>
									</Table.Row>
								)
							})}
						</Table.Body>
					</Table>
				)}
			</VStack>

			<Modal ref={archiveModalRef} header={{ heading: "Arkiver rutine" }}>
				<Modal.Body>
					<BodyShort>
						Er du sikker på at du vil arkivere rutinen «{routine.name}»? Rutinen vil bli skjult fra oversikter, men all
						konfigurasjon, gjennomganger og audit-logg bevares. Du kan reaktivere rutinen senere.
					</BodyShort>
				</Modal.Body>
				<Modal.Footer>
					<archiveFetcher.Form method="post" onSubmit={() => archiveModalRef.current?.close()}>
						<input type="hidden" name="intent" value="archive" />
						<Button type="submit" variant="danger" loading={archiveFetcher.state !== "idle"}>
							Arkiver
						</Button>
					</archiveFetcher.Form>
					<Button variant="secondary" onClick={() => archiveModalRef.current?.close()}>
						Avbryt
					</Button>
				</Modal.Footer>
			</Modal>
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
