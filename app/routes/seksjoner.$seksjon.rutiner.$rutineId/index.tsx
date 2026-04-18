import { BodyShort, Box, Button, Detail, Heading, HStack, Label, Table, Tag, VStack } from "@navikt/ds-react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Link, redirect, useFetcher, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import {
	approveRoutine,
	calculateDeadline,
	copyRoutine,
	getAppsRequiringRoutine,
	getLatestReviewForApp,
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
import { canApproveRoutine, isAdmin } from "~/lib/authorization.server"
import { renderMarkdown } from "~/lib/markdown.server"
import type { RoutineFrequency } from "~/lib/routine-frequencies"
import { getFrequencyLabel } from "~/lib/routine-frequencies"

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

	const [reviews, apps] = await Promise.all([getReviewsForRoutine(rutineId), getAppsRequiringRoutine(rutineId)])

	// Fetch screening question text if linked
	let screeningQuestion: { id: string; questionText: string } | null = null
	if (routine.screeningQuestionId) {
		screeningQuestion = await getScreeningQuestion(routine.screeningQuestionId)
	}

	// Calculate deadline info for each app
	const appsWithDeadlines = await Promise.all(
		apps.map(async (app) => {
			const latestReview = await getLatestReviewForApp(rutineId, app.id)
			const lastReviewDate = latestReview?.reviewedAt ?? null
			const deadline = calculateDeadline(lastReviewDate, routine.createdAt, routine.frequency as RoutineFrequency)
			const overdue = isOverdue(deadline)

			return {
				id: app.id,
				name: app.name,
				lastReviewDate,
				deadline,
				overdue,
				neverReviewed: !latestReview,
			}
		}),
	)

	const effectiveRole = routine.responsibleRole || routine.controls.find((c) => c.responsible)?.responsible || null
	const userCanApprove = user ? canApproveRoutine(user, effectiveRole, section.id) : false
	const userCanAdmin = user ? isAdmin(user) : false

	return data({
		section,
		routine,
		reviews,
		appsWithDeadlines,
		screeningQuestion,
		descriptionHtml: renderMarkdown(routine.description),
		userCanApprove,
		userCanAdmin,
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

	const formData = await request.formData()
	const intent = formData.get("intent")

	if (intent === "approve") {
		const effectiveRole = routine.responsibleRole || routine.controls.find((c) => c.responsible)?.responsible || null
		if (!canApproveRoutine(authedUser, effectiveRole, section.id)) {
			throw data({ message: "Du har ikke riktig rolle til å godkjenne denne rutinen" }, { status: 403 })
		}
		await approveRoutine(rutineId, authedUser.navIdent)
		return redirect(`/seksjoner/${seksjon}/rutiner/${rutineId}`)
	}

	if (intent === "copy") {
		if (!isAdmin(authedUser)) {
			throw data({ message: "Kun admin kan kopiere rutiner" }, { status: 403 })
		}
		const copy = await copyRoutine(rutineId, authedUser.navIdent)
		if (!copy) throw data({ message: "Kunne ikke kopiere rutine" }, { status: 500 })
		return redirect(`/seksjoner/${seksjon}/rutiner/${copy.id}/rediger`)
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
		effectiveRole,
	} = useLoaderData<typeof loader>()
	const fetcher = useFetcher()

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
								Utkast
							</Tag>
						)}
						{routine.status === "approved" && (
							<Tag variant="success" size="small">
								Godkjent
							</Tag>
						)}
						{routine.status === "archived" && (
							<Tag variant="neutral" size="small">
								Arkivert
							</Tag>
						)}
					</HStack>
					<HStack gap="space-2">
						{routine.status !== "approved" && (
							<Button as={Link} to="./rediger" variant="secondary" size="small">
								Rediger
							</Button>
						)}
						{routine.status === "approved" && userCanAdmin && (
							<fetcher.Form method="post">
								<input type="hidden" name="intent" value="copy" />
								<Button type="submit" variant="secondary" size="small" loading={fetcher.state !== "idle"}>
									Kopier for endring
								</Button>
							</fetcher.Form>
						)}
						{routine.status === "active" && userCanApprove && (
							<fetcher.Form method="post">
								<input type="hidden" name="intent" value="approve" />
								<Button type="submit" variant="primary" size="small" loading={fetcher.state !== "idle"}>
									Godkjenn
								</Button>
							</fetcher.Form>
						)}
						{(routine.status === "active" || routine.status === "approved") && (
							<Button as={Link} to="./gjennomgang/ny" variant="primary" size="small">
								Ny gjennomgang
							</Button>
						)}
					</HStack>
				</HStack>
				{routine.status === "active" && !userCanApprove && (
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
				{descriptionHtml && (
					<VStack gap="space-2">
						<Label size="small">Beskrivelse</Label>
						{/* biome-ignore lint/security/noDangerouslySetInnerHtml: server-sanitized markdown */}
						<div className="markdown-content" dangerouslySetInnerHTML={{ __html: descriptionHtml }} />
					</VStack>
				)}

				<VStack gap="space-2">
					<Label size="small">Frekvens</Label>
					<HStack>
						<Tag variant="info" size="small">
							{getFrequencyLabel(routine.frequency)}
						</Tag>
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
									<Table.DataCell>{formatDate(app.deadline)}</Table.DataCell>
									<Table.DataCell>
										{app.neverReviewed ? (
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
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
