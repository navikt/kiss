import { BodyShort, Detail, HStack, Table, Tag, VStack } from "@navikt/ds-react"
import { Link } from "react-router"

type FollowUpPoint = {
	id: string
	reviewId: string
	routineId: string
	routineName: string
	sectionId: string | null
	reviewTitle: string
	reviewedAt: Date | string
	text: string
	description: string | null
	resolution: string | null
	status: "needs_follow_up" | "completed" | "not_relevant"
	createdBy: string
	resolvedAt: Date | string | null
	resolvedBy: string | null
}

const statusOrder: Record<FollowUpPoint["status"], number> = {
	needs_follow_up: 0,
	completed: 1,
	not_relevant: 2,
}

export function OppfolgingspunkterTab({
	followUpPoints,
	sectionSlugMap,
}: {
	followUpPoints: FollowUpPoint[]
	sectionSlugMap: Record<string, string>
}) {
	const sorted = [...followUpPoints].sort((a, b) => {
		const statusDiff = statusOrder[a.status] - statusOrder[b.status]
		if (statusDiff !== 0) return statusDiff
		return new Date(b.reviewedAt).getTime() - new Date(a.reviewedAt).getTime()
	})

	if (sorted.length === 0) {
		return (
			<BodyShort textColor="subtle" size="small" style={{ marginTop: "var(--ax-space-8)" }}>
				Ingen oppfølgingspunkter er registrert fra fullførte gjennomganger.
			</BodyShort>
		)
	}

	return (
		// biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1
		<section className="table-scroll" tabIndex={0} aria-label="Oppfølgingspunkter fra rutinegjennomganger">
			<Table size="small">
				<Table.Header>
					<Table.Row>
						<Table.HeaderCell>Rutine</Table.HeaderCell>
						<Table.HeaderCell>Oppfølgingspunkt</Table.HeaderCell>
						<Table.HeaderCell>Status</Table.HeaderCell>
						<Table.HeaderCell>Gjennomgang</Table.HeaderCell>
						<Table.HeaderCell>Opprettet av</Table.HeaderCell>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{sorted.map((point) => {
						const slug = point.sectionId ? sectionSlugMap[point.sectionId] : null
						const reviewLink = slug
							? `/seksjoner/${slug}/rutiner/${point.routineId}/gjennomgang/${point.reviewId}`
							: null

						return (
							<Table.Row key={point.id}>
								<Table.DataCell>{point.routineName}</Table.DataCell>
								<Table.DataCell>
									<VStack gap="space-1">
										<BodyShort size="small">{point.text}</BodyShort>
										{point.description && <Detail textColor="subtle">{point.description}</Detail>}
										{point.resolution && (
											<Detail textColor="subtle">
												<em>Oppfølging:</em> {point.resolution}
											</Detail>
										)}
									</VStack>
								</Table.DataCell>
								<Table.DataCell>
									{point.status === "needs_follow_up" && (
										<Tag variant="warning" size="xsmall">
											Må følges opp
										</Tag>
									)}
									{point.status === "completed" && (
										<Tag variant="success" size="xsmall">
											Fullført
										</Tag>
									)}
									{point.status === "not_relevant" && (
										<Tag variant="neutral" size="xsmall">
											Ikke relevant
										</Tag>
									)}
								</Table.DataCell>
								<Table.DataCell>
									<HStack gap="space-2" align="center">
										{reviewLink ? <Link to={reviewLink}>{point.reviewTitle}</Link> : <span>{point.reviewTitle}</span>}
										<Detail textColor="subtle">{new Date(point.reviewedAt).toLocaleDateString("nb-NO")}</Detail>
									</HStack>
								</Table.DataCell>
								<Table.DataCell>{point.createdBy}</Table.DataCell>
							</Table.Row>
						)
					})}
				</Table.Body>
			</Table>
		</section>
	)
}
