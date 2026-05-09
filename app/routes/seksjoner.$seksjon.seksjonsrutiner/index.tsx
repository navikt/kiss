import type { SortState } from "@navikt/ds-react"
import { BodyShort, Button, Heading, HStack, Search, Table, Tag, VStack } from "@navikt/ds-react"
import { useState } from "react"
import type { LoaderFunctionArgs } from "react-router"
import { data, Link, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getSectionRoutinesForSection } from "~/db/queries/routines.server"
import { getSectionBySlug } from "~/db/queries/sections.server"
import { getAuthenticatedUser } from "~/lib/auth.server"
import { getFrequencyLabel } from "~/lib/routine-frequencies"

export async function loader({ request, params }: LoaderFunctionArgs) {
	const { seksjon } = params
	if (!seksjon) {
		throw data({ message: "Mangler seksjonsparameter" }, { status: 400 })
	}

	await getAuthenticatedUser(request)

	const section = await getSectionBySlug(seksjon)
	if (!section) {
		throw data({ message: `Fant ikke seksjon: ${seksjon}` }, { status: 404 })
	}

	const sectionRoutines = await getSectionRoutinesForSection(section.id)

	return data({
		section,
		seksjon,
		sectionRoutines,
	})
}

export default function Seksjonsrutiner() {
	const { sectionRoutines, seksjon } = useLoaderData<typeof loader>()
	const [search, setSearch] = useState("")
	const [sort, setSort] = useState<SortState>({ orderBy: "status", direction: "descending" })

	const filtered = sectionRoutines.filter((sr) => {
		if (!search) return true
		const q = search.toLowerCase()
		return (
			sr.routine.name.toLowerCase().includes(q) || (sr.routine.sectionRoutineOwnerRole ?? "").toLowerCase().includes(q)
		)
	})

	const sorted = [...filtered].sort((a, b) => {
		const dir = sort.direction === "ascending" ? 1 : -1
		if (sort.orderBy === "name") {
			return a.routine.name.localeCompare(b.routine.name, "nb") * dir
		}
		if (sort.orderBy === "ownerRole") {
			return (
				(a.routine.sectionRoutineOwnerRole ?? "").localeCompare(b.routine.sectionRoutineOwnerRole ?? "", "nb") * dir
			)
		}
		if (sort.orderBy === "frequency") {
			return getFrequencyLabel(a.routine.frequency).localeCompare(getFrequencyLabel(b.routine.frequency), "nb") * dir
		}
		if (sort.orderBy === "lastReview" || sort.orderBy === "deadline") {
			const aDate = sort.orderBy === "lastReview" ? a.lastReviewDate : a.deadline
			const bDate = sort.orderBy === "lastReview" ? b.lastReviewDate : b.deadline
			const aTime = aDate ? new Date(aDate).getTime() : Number.NEGATIVE_INFINITY
			const bTime = bDate ? new Date(bDate).getTime() : Number.NEGATIVE_INFINITY
			return (aTime - bTime) * dir
		}
		if (sort.orderBy === "status") {
			const order = { overdue: "0", never: "1", ok: "2" }
			const aKey = a.overdue ? "overdue" : a.lastReviewDate ? "ok" : "never"
			const bKey = b.overdue ? "overdue" : b.lastReviewDate ? "ok" : "never"
			return (order[aKey] ?? "9").localeCompare(order[bKey] ?? "9") * dir
		}
		return 0
	})

	const formatDate = (d: Date | string | null) => {
		if (!d) return "–"
		return new Date(d).toLocaleDateString("nb-NO")
	}

	return (
		<VStack gap="space-8">
			<HStack justify="space-between" align="center" wrap>
				<Heading size="large" level="2">
					Seksjonsrutiner
				</Heading>
				<Button as={Link} to={`/seksjoner/${seksjon}/rutiner`} variant="tertiary" size="small">
					Tilbake til alle rutiner
				</Button>
			</HStack>

			<BodyShort>
				Seksjonsrutiner gjennomgås på seksjonsnivå av eier/utførende rolle. Gjennomgangen gjelder for alle applikasjoner
				i seksjonen.
			</BodyShort>

			{sectionRoutines.length === 0 ? (
				<BodyShort>Ingen seksjonsrutiner er opprettet for denne seksjonen.</BodyShort>
			) : (
				<VStack gap="space-4">
					<div style={{ maxWidth: "300px" }}>
						<Search
							label="Søk i seksjonsrutiner"
							size="small"
							value={search}
							onChange={setSearch}
							onClear={() => setSearch("")}
						/>
					</div>

					{sorted.length === 0 ? (
						<BodyShort>Ingen seksjonsrutiner matcher søket.</BodyShort>
					) : (
						// biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable table
						<section className="table-scroll" aria-label="Seksjonsrutiner" tabIndex={0}>
							<Table
								size="small"
								sort={sort}
								onSortChange={(sortKey) =>
									setSort((prev) =>
										sortKey
											? {
													orderBy: sortKey,
													direction:
														prev.orderBy === sortKey && prev.direction === "ascending" ? "descending" : "ascending",
												}
											: prev,
									)
								}
							>
								<Table.Header>
									<Table.Row>
										<Table.ColumnHeader sortKey="name" sortable>
											Rutine
										</Table.ColumnHeader>
										<Table.ColumnHeader sortKey="ownerRole" sortable>
											Eier / Utførende
										</Table.ColumnHeader>
										<Table.ColumnHeader sortKey="frequency" sortable>
											Frekvens
										</Table.ColumnHeader>
										<Table.ColumnHeader sortKey="lastReview" sortable>
											Siste gjennomgang
										</Table.ColumnHeader>
										<Table.ColumnHeader sortKey="deadline" sortable>
											Frist
										</Table.ColumnHeader>
										<Table.ColumnHeader sortKey="status" sortable>
											Status
										</Table.ColumnHeader>
										<Table.HeaderCell />
									</Table.Row>
								</Table.Header>
								<Table.Body>
									{sorted.map((sr) => {
										const statusKey = sr.overdue ? "overdue" : sr.lastReviewDate ? "ok" : "never"
										return (
											<Table.Row key={sr.routine.id}>
												<Table.DataCell>
													<Link to={`/seksjoner/${seksjon}/rutiner/${sr.routine.id}`}>{sr.routine.name}</Link>
												</Table.DataCell>
												<Table.DataCell>{sr.routine.sectionRoutineOwnerRole ?? "–"}</Table.DataCell>
												<Table.DataCell>{getFrequencyLabel(sr.routine.frequency)}</Table.DataCell>
												<Table.DataCell>{formatDate(sr.lastReviewDate)}</Table.DataCell>
												<Table.DataCell>{formatDate(sr.deadline)}</Table.DataCell>
												<Table.DataCell>
													{statusKey === "overdue" && (
														<Tag variant="error" size="xsmall">
															Over frist
														</Tag>
													)}
													{statusKey === "ok" && (
														<Tag variant="success" size="xsmall">
															OK
														</Tag>
													)}
													{statusKey === "never" && (
														<Tag variant="warning" size="xsmall">
															Ikke gjennomført
														</Tag>
													)}
												</Table.DataCell>
												<Table.DataCell>
													{sr.routine.status === "approved" && (
														<Button
															as={Link}
															to={`/seksjoner/${seksjon}/rutiner/${sr.routine.id}/gjennomgang/ny`}
															variant="tertiary"
															size="xsmall"
														>
															Ny gjennomgang
														</Button>
													)}
												</Table.DataCell>
											</Table.Row>
										)
									})}
								</Table.Body>
							</Table>
						</section>
					)}
				</VStack>
			)}
		</VStack>
	)
}

export function ErrorBoundary() {
	return <RouteErrorBoundary />
}
