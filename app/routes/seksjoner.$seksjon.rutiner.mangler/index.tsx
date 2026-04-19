import { BodyShort, Box, Heading, Table, Tag, VStack } from "@navikt/ds-react"
import type { LoaderFunctionArgs } from "react-router"
import { data, Link, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import type { RoutineDeadlineInfo } from "~/db/queries/routines.server"
import { getRoutineDeadlinesForSection } from "~/db/queries/routines.server"
import { getSectionBySlug } from "~/db/queries/sections.server"
import { getFrequencyLabel } from "~/lib/routine-frequencies"

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

	const deadlines = await getRoutineDeadlinesForSection(section.id)

	return data({
		section,
		deadlines,
	})
}

function DeadlineTable({ items }: { items: RoutineDeadlineInfo[] }) {
	if (items.length === 0) {
		return (
			<Box padding="space-6" borderRadius="8" background="sunken">
				<BodyShort>Ingen rutiner å vise.</BodyShort>
			</Box>
		)
	}

	return (
		/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable table needs keyboard access */
		<section className="table-scroll" tabIndex={0} aria-label="Manglende rutiner">
			<Table>
				<Table.Header>
					<Table.Row>
						<Table.HeaderCell>Rutine</Table.HeaderCell>
						<Table.HeaderCell>Applikasjon</Table.HeaderCell>
						<Table.HeaderCell>Frekvens</Table.HeaderCell>
						<Table.HeaderCell>Siste gjennomgang</Table.HeaderCell>
						<Table.HeaderCell>Frist</Table.HeaderCell>
						<Table.HeaderCell>Status</Table.HeaderCell>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{items.map((item, index) => (
						<Table.Row key={`${item.routine?.id ?? index}-${item.applicationId}`}>
							<Table.DataCell>
								{item.routine ? <Link to={`../${item.routine.id}`}>{item.routine.name}</Link> : "—"}
							</Table.DataCell>
							<Table.DataCell>
								<Link to={`/applikasjoner/${item.applicationId}/detaljer`}>{item.applicationName}</Link>
							</Table.DataCell>
							<Table.DataCell>
								{item.routine?.frequency ? getFrequencyLabel(item.routine.frequency) : "—"}
							</Table.DataCell>
							<Table.DataCell>{formatDate(item.lastReviewDate)}</Table.DataCell>
							<Table.DataCell>{formatDate(item.deadline)}</Table.DataCell>
							<Table.DataCell>
								{!item.lastReviewDate ? (
									<Tag variant="neutral" size="small">
										Ikke gjennomført
									</Tag>
								) : item.overdue ? (
									<Tag variant="error" size="small">
										Over frist
									</Tag>
								) : (
									<Tag variant="warning" size="small">
										Kommende
									</Tag>
								)}
							</Table.DataCell>
						</Table.Row>
					))}
				</Table.Body>
			</Table>
		</section>
	)
}

export default function ManglendeRutiner() {
	const { section, deadlines } = useLoaderData<typeof loader>()

	const overdue = deadlines.filter((d) => d.overdue)
	const upcoming = deadlines
		.filter((d) => !d.overdue)
		.sort((a, b) => {
			if (!a.deadline) return 1
			if (!b.deadline) return -1
			return new Date(a.deadline).getTime() - new Date(b.deadline).getTime()
		})

	return (
		<VStack gap="space-8">
			<Heading size="xlarge" level="2" spacing>
				Manglende rutinegjennomganger — {section.name}
			</Heading>

			<VStack gap="space-4">
				<Heading size="medium" level="3">
					Over frist ({overdue.length})
				</Heading>
				<DeadlineTable items={overdue} />
			</VStack>

			<VStack gap="space-4">
				<Heading size="medium" level="3">
					Kommende ({upcoming.length})
				</Heading>
				<DeadlineTable items={upcoming} />
			</VStack>
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
