import { BodyShort, Box, Button, Detail, Heading, HStack, Label, Table, Tag, VStack } from "@navikt/ds-react"
import type { LoaderFunctionArgs } from "react-router"
import { data, Link, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import {
	calculateDeadline,
	getAppsRequiringRoutine,
	getLatestReviewForApp,
	getReviewsForRoutine,
	getRoutine,
	isOverdue,
} from "~/db/queries/routines.server"
import { getScreeningQuestion } from "~/db/queries/screening.server"
import { getSectionBySlug } from "~/db/queries/sections.server"
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

export async function loader({ params }: LoaderFunctionArgs) {
	const { seksjon, rutineId } = params
	if (!seksjon || !rutineId) {
		throw data({ message: "Mangler parametere" }, { status: 400 })
	}

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

	return data({
		section,
		routine,
		reviews,
		appsWithDeadlines,
		screeningQuestion,
		descriptionHtml: renderMarkdown(routine.description),
	})
}

export default function RutineDetaljer() {
	const { section, routine, reviews, appsWithDeadlines, screeningQuestion, descriptionHtml } =
		useLoaderData<typeof loader>()

	return (
		<VStack gap="space-12">
			<VStack gap="space-2">
				<Detail>
					<Link to="..">{section.name} / Rutiner</Link>
				</Detail>
				<HStack gap="space-4" align="center" justify="space-between">
					<Heading size="xlarge" level="2">
						{routine.name}
					</Heading>
					<HStack gap="space-2">
						<Button as={Link} to="./rediger" variant="secondary" size="small">
							Rediger
						</Button>
						<Button as={Link} to="./gjennomgang/ny" variant="primary" size="small">
							Ny gjennomgang
						</Button>
					</HStack>
				</HStack>
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
