import { BodyShort, Box, Heading, Table, Tag, VStack } from "@navikt/ds-react"
import type { LoaderFunctionArgs } from "react-router"
import { data, Link, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getCompletedReviewsForSection } from "~/db/queries/routines.server"
import { getSectionBySlug } from "~/db/queries/sections.server"

function formatDate(date: string | Date | null): string {
	if (!date) return "—"
	return new Date(date).toLocaleDateString("nb-NO")
}

export async function loader({ params }: LoaderFunctionArgs) {
	const { seksjon } = params
	if (!seksjon) {
		throw data({ message: "Mangler seksjonsparameter" }, { status: 400 })
	}

	const section = await getSectionBySlug(seksjon)
	if (!section) {
		throw data({ message: `Fant ikke seksjon: ${seksjon}` }, { status: 404 })
	}

	const reviews = await getCompletedReviewsForSection(section.id)

	return data({
		section,
		reviews,
	})
}

export default function GjennomforteRutiner() {
	const { section, reviews } = useLoaderData<typeof loader>()

	return (
		<VStack gap="space-8">
			<div>
				<Link to="..">← Tilbake til rutiner</Link>
				<Heading size="xlarge" level="2" spacing>
					Gjennomførte rutinegjennomganger — {section.name}
				</Heading>
			</div>

			{reviews.length === 0 ? (
				<Box padding="space-6" borderRadius="8" background="sunken">
					<BodyShort>Ingen gjennomganger er registrert for denne seksjonen ennå.</BodyShort>
				</Box>
			) : (
				<Table>
					<Table.Header>
						<Table.Row>
							<Table.HeaderCell>Dato</Table.HeaderCell>
							<Table.HeaderCell>Rutine</Table.HeaderCell>
							<Table.HeaderCell>Applikasjon</Table.HeaderCell>
							<Table.HeaderCell>Tittel</Table.HeaderCell>
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
									<Table.DataCell>{formatDate(review.reviewedAt)}</Table.DataCell>
									<Table.DataCell>
										<Link to={`../${review.routineId}`}>{review.routineName}</Link>
									</Table.DataCell>
									<Table.DataCell>
										{review.applicationId ? (
											<Link to={`/applikasjoner/${review.applicationId}/detaljer`}>{review.applicationName}</Link>
										) : (
											"—"
										)}
									</Table.DataCell>
									<Table.DataCell>{review.title}</Table.DataCell>
									<Table.DataCell>{review.createdBy}</Table.DataCell>
									<Table.DataCell>
										{review.participants.length > 0
											? `${review.participants.length} (${confirmedCount} bekreftet)`
											: "—"}
									</Table.DataCell>
									<Table.DataCell>
										{review.attachments.length > 0 ? (
											<Tag variant="info" size="small">
												{review.attachments.length}
											</Tag>
										) : (
											"0"
										)}
									</Table.DataCell>
								</Table.Row>
							)
						})}
					</Table.Body>
				</Table>
			)}
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
