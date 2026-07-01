import { BodyShort, Box, Heading, Table, Tag, VStack } from "@navikt/ds-react"
import { data, Link, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getFollowUpReviewsForSection } from "~/db/queries/routines.server"
import { getSectionBySlug } from "~/db/queries/sections.server"
import type { Route } from "./+types/index"

function formatDate(date: string | Date | null): string {
	if (!date) return "—"
	return new Date(date).toLocaleDateString("nb-NO")
}

export async function loader({ params }: Route.LoaderArgs) {
	const { seksjon } = params
	if (!seksjon) {
		throw data({ message: "Mangler seksjonsparameter" }, { status: 400 })
	}

	const section = await getSectionBySlug(seksjon)
	if (!section) {
		throw data({ message: `Fant ikke seksjon: ${seksjon}` }, { status: 404 })
	}

	const reviews = await getFollowUpReviewsForSection(section.id)

	return data({
		section,
		seksjon,
		reviews,
	})
}

export default function RutinerOppfolging() {
	const { section, seksjon, reviews } = useLoaderData<typeof loader>()

	return (
		<VStack gap="space-8">
			<Heading size="xlarge" level="2" spacing>
				Rutiner som krever oppfølging — {section.name}
			</Heading>

			{reviews.length === 0 ? (
				<Box padding="space-6" borderRadius="8" background="sunken">
					<BodyShort>Ingen gjennomganger krever oppfølging for denne seksjonen.</BodyShort>
				</Box>
			) : (
				<>
					{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */}
					<section className="table-scroll" tabIndex={0} aria-label="Rutiner som krever oppfølging">
						<Table>
							<Table.Header>
								<Table.Row>
									<Table.HeaderCell>Dato</Table.HeaderCell>
									<Table.HeaderCell>Rutine</Table.HeaderCell>
									<Table.HeaderCell>Applikasjon</Table.HeaderCell>
									<Table.HeaderCell>Åpne oppfølgingspunkter</Table.HeaderCell>
									<Table.HeaderCell>Opprettet av</Table.HeaderCell>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{reviews.map((review) => (
									<Table.Row key={review.id}>
										<Table.DataCell>{formatDate(review.reviewedAt)}</Table.DataCell>
										<Table.DataCell>
											<Link to={`/seksjoner/${seksjon}/rutiner/${review.routineId}/gjennomgang/${review.id}`}>
												{review.routineName}
											</Link>
										</Table.DataCell>
										<Table.DataCell>
											{review.applicationId ? (
												<Link to={`/applikasjoner/${review.applicationId}/detaljer`}>{review.applicationName}</Link>
											) : (
												"—"
											)}
										</Table.DataCell>
										<Table.DataCell>
											<VStack gap="space-1">
												{review.openFollowUpPoints.length === 0 ? (
													<Tag variant="success" size="small">
														Alle løst
													</Tag>
												) : (
													review.openFollowUpPoints.map((point) => (
														<BodyShort key={point.id} size="small">
															{point.text}
														</BodyShort>
													))
												)}
											</VStack>
										</Table.DataCell>
										<Table.DataCell>
											{review.createdByName ? (
												<>
													<BodyShort size="small">{review.createdByName}</BodyShort>
													<BodyShort size="small" textColor="subtle">
														{review.createdBy}
													</BodyShort>
												</>
											) : (
												review.createdBy
											)}
										</Table.DataCell>
									</Table.Row>
								))}
							</Table.Body>
						</Table>
					</section>
				</>
			)}
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
