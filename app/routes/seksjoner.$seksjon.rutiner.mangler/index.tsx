import { BodyShort, Box, Heading, HStack, Select, Table, Tag, VStack } from "@navikt/ds-react"
import { useMemo, useState } from "react"
import type { LoaderFunctionArgs } from "react-router"
import { data, Link, useLoaderData } from "react-router"
import { FrequencyDisplay } from "~/components/FrequencyDisplay"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getSectionBySlug, getSectionIncompleteRoutines, getTeamNamesForApps } from "~/db/queries/sections.server"

function formatDate(date: string | Date | null): string {
	if (!date) return "—"
	return new Date(date).toLocaleDateString("nb-NO")
}

type SortKey = "name" | "app" | "team" | "frequency" | "lastReview" | "deadline" | "status"
type SectionSortKey = "name" | "frequency" | "lastReview" | "deadline" | "status" | "appCount"
type SortDirection = "ascending" | "descending"

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100]

export async function loader({ params }: LoaderFunctionArgs) {
	const { seksjon } = params
	if (!seksjon) {
		throw data({ message: "Mangler seksjonsparameter" }, { status: 400 })
	}

	const section = await getSectionBySlug(seksjon)
	if (!section) {
		throw data({ message: `Fant ikke seksjon: ${seksjon}` }, { status: 404 })
	}

	const deadlines = await getSectionIncompleteRoutines(section.id)

	// Split into app routines and section routines using the derived boolean on the deadline object
	const appDeadlines = deadlines.filter((d) => !d.isSectionRoutine)
	const sectionDeadlines = deadlines.filter((d) => d.isSectionRoutine)

	// Group section routines by routineId and count app hits
	const sectionRoutineMap = new Map<
		string,
		{
			routineId: string
			routineName: string | null
			frequency: string | null
			eventFrequency: string | null
			lastReviewDate: string | null
			deadline: string | null
			appCount: number
		}
	>()
	for (const d of sectionDeadlines) {
		const id = d.routine?.id
		if (!id) continue
		const existing = sectionRoutineMap.get(id)
		if (existing) {
			existing.appCount++
		} else {
			sectionRoutineMap.set(id, {
				routineId: id,
				routineName: d.routine?.name ?? null,
				frequency: d.routine?.frequency ?? null,
				eventFrequency: d.routine?.eventFrequency ?? null,
				lastReviewDate: d.lastReviewDate ? d.lastReviewDate.toISOString() : null,
				deadline: d.deadline ? d.deadline.toISOString() : null,
				appCount: 1,
			})
		}
	}
	const sectionRows = [...sectionRoutineMap.values()]

	// Batch-fetch team names for all app routines
	const uniqueAppIds = [...new Set(appDeadlines.map((d) => d.applicationId))]
	const teamNamesByApp = await getTeamNamesForApps(uniqueAppIds, section.id)

	const appRows = appDeadlines.map((d) => ({
		routineId: d.routine?.id ?? null,
		routineName: d.routine?.name ?? null,
		applicationId: d.applicationId,
		applicationName: d.applicationName,
		frequency: d.routine?.frequency ?? null,
		eventFrequency: d.routine?.eventFrequency ?? null,
		lastReviewDate: d.lastReviewDate ? d.lastReviewDate.toISOString() : null,
		deadline: d.deadline ? d.deadline.toISOString() : null,
		teamNames: teamNamesByApp.get(d.applicationId) ?? [],
	}))

	return data({ seksjon, sectionName: section.name, appRows, sectionRows })
}

function statusKey(row: { lastReviewDate: string | null }) {
	return !row.lastReviewDate ? "never" : "overdue"
}

function Pagination({
	totalPages,
	currentPage,
	setPage,
}: {
	totalPages: number
	currentPage: number
	setPage: (p: number) => void
}) {
	if (totalPages <= 1) return null
	return (
		<HStack gap="space-2" justify="center" wrap>
			<button
				type="button"
				onClick={() => setPage(Math.max(1, currentPage - 1))}
				disabled={currentPage === 1}
				style={{ padding: "var(--ax-space-4) var(--ax-space-8)", cursor: currentPage === 1 ? "default" : "pointer" }}
			>
				Forrige
			</button>
			{Array.from({ length: totalPages }, (_, i) => i + 1)
				.filter((p) => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 2)
				.reduce<(number | "…")[]>((acc, p, i, arr) => {
					if (i > 0 && p - (arr[i - 1] as number) > 1) acc.push("…")
					acc.push(p)
					return acc
				}, [])
				.map((p, i) =>
					p === "…" ? (
						// biome-ignore lint/suspicious/noArrayIndexKey: ellipsis spacers have no meaningful identity
						<span key={`ellipsis-${i}`} style={{ padding: "var(--ax-space-4) var(--ax-space-4)" }}>
							…
						</span>
					) : (
						<button
							key={p}
							type="button"
							onClick={() => setPage(p)}
							aria-current={p === currentPage ? "page" : undefined}
							style={{
								padding: "var(--ax-space-4) var(--ax-space-8)",
								fontWeight: p === currentPage ? "bold" : undefined,
								cursor: p === currentPage ? "default" : "pointer",
							}}
						>
							{p}
						</button>
					),
				)}
			<button
				type="button"
				onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
				disabled={currentPage === totalPages}
				style={{
					padding: "var(--ax-space-4) var(--ax-space-8)",
					cursor: currentPage === totalPages ? "default" : "pointer",
				}}
			>
				Neste
			</button>
		</HStack>
	)
}

export default function IkkeGjennomforteRutiner() {
	const { seksjon, sectionName, appRows, sectionRows } = useLoaderData<typeof loader>()

	const [appSort, setAppSort] = useState<{ orderBy: SortKey; direction: SortDirection }>({
		orderBy: "deadline",
		direction: "ascending",
	})
	const [appPage, setAppPage] = useState(1)
	const [appPageSize, setAppPageSize] = useState(25)

	const [sectionSort, setSectionSort] = useState<{ orderBy: SectionSortKey; direction: SortDirection }>({
		orderBy: "deadline",
		direction: "ascending",
	})
	const [sectionPage, setSectionPage] = useState(1)
	const [sectionPageSize, setSectionPageSize] = useState(25)

	function handleAppSort(key: string | undefined) {
		if (!key) return
		setAppSort((prev) =>
			prev.orderBy === key
				? { orderBy: key as SortKey, direction: prev.direction === "ascending" ? "descending" : "ascending" }
				: { orderBy: key as SortKey, direction: "ascending" },
		)
		setAppPage(1)
	}

	function handleSectionSort(key: string | undefined) {
		if (!key) return
		setSectionSort((prev) =>
			prev.orderBy === key
				? {
						orderBy: key as SectionSortKey,
						direction: prev.direction === "ascending" ? "descending" : "ascending",
					}
				: { orderBy: key as SectionSortKey, direction: "ascending" },
		)
		setSectionPage(1)
	}

	const sortedAppRows = useMemo(() => {
		const dir = appSort.direction === "ascending" ? 1 : -1
		return [...appRows].sort((a, b) => {
			switch (appSort.orderBy) {
				case "name":
					return (a.routineName ?? "").localeCompare(b.routineName ?? "", "nb") * dir
				case "app":
					return (a.applicationName ?? "").localeCompare(b.applicationName ?? "", "nb") * dir
				case "team":
					return a.teamNames.join(", ").localeCompare(b.teamNames.join(", "), "nb") * dir
				case "frequency":
					return (a.frequency ?? "").localeCompare(b.frequency ?? "", "nb") * dir
				case "lastReview": {
					const aTime = a.lastReviewDate ? new Date(a.lastReviewDate).getTime() : Number.NEGATIVE_INFINITY
					const bTime = b.lastReviewDate ? new Date(b.lastReviewDate).getTime() : Number.NEGATIVE_INFINITY
					return (aTime - bTime) * dir
				}
				case "deadline": {
					const aTime = a.deadline ? new Date(a.deadline).getTime() : Number.NEGATIVE_INFINITY
					const bTime = b.deadline ? new Date(b.deadline).getTime() : Number.NEGATIVE_INFINITY
					return (aTime - bTime) * dir
				}
				case "status": {
					const order = { overdue: 0, never: 1 }
					return (
						((order[statusKey(a) as keyof typeof order] ?? 9) - (order[statusKey(b) as keyof typeof order] ?? 9)) * dir
					)
				}
				default:
					return 0
			}
		})
	}, [appRows, appSort])

	const sortedSectionRows = useMemo(() => {
		const dir = sectionSort.direction === "ascending" ? 1 : -1
		return [...sectionRows].sort((a, b) => {
			switch (sectionSort.orderBy) {
				case "name":
					return (a.routineName ?? "").localeCompare(b.routineName ?? "", "nb") * dir
				case "frequency":
					return (a.frequency ?? "").localeCompare(b.frequency ?? "", "nb") * dir
				case "lastReview": {
					const aTime = a.lastReviewDate ? new Date(a.lastReviewDate).getTime() : Number.NEGATIVE_INFINITY
					const bTime = b.lastReviewDate ? new Date(b.lastReviewDate).getTime() : Number.NEGATIVE_INFINITY
					return (aTime - bTime) * dir
				}
				case "deadline": {
					const aTime = a.deadline ? new Date(a.deadline).getTime() : Number.NEGATIVE_INFINITY
					const bTime = b.deadline ? new Date(b.deadline).getTime() : Number.NEGATIVE_INFINITY
					return (aTime - bTime) * dir
				}
				case "status": {
					const order = { overdue: 0, never: 1 }
					return (
						((order[statusKey(a) as keyof typeof order] ?? 9) - (order[statusKey(b) as keyof typeof order] ?? 9)) * dir
					)
				}
				case "appCount":
					return (a.appCount - b.appCount) * dir
				default:
					return 0
			}
		})
	}, [sectionRows, sectionSort])

	const appTotalPages = Math.max(1, Math.ceil(sortedAppRows.length / appPageSize))
	const appCurrentPage = Math.min(appPage, appTotalPages)
	const pagedAppRows = sortedAppRows.slice((appCurrentPage - 1) * appPageSize, appCurrentPage * appPageSize)

	const sectionTotalPages = Math.max(1, Math.ceil(sortedSectionRows.length / sectionPageSize))
	const sectionCurrentPage = Math.min(sectionPage, sectionTotalPages)
	const pagedSectionRows = sortedSectionRows.slice(
		(sectionCurrentPage - 1) * sectionPageSize,
		sectionCurrentPage * sectionPageSize,
	)

	const totalSectionHits = sectionRows.reduce((sum, r) => sum + r.appCount, 0)
	const hasAny = appRows.length > 0 || sectionRows.length > 0

	return (
		<VStack gap="space-8">
			<Heading size="xlarge" level="2" spacing>
				Rutiner ikke gjennomført — {sectionName}
			</Heading>

			{!hasAny ? (
				<Box padding="space-6" borderRadius="8" background="sunken">
					<BodyShort>Alle rutiner er gjennomført. Bra jobbet!</BodyShort>
				</Box>
			) : (
				<VStack gap="space-12">
					{appRows.length > 0 && (
						<VStack gap="space-4">
							<HStack align="center" justify="space-between">
								<Heading size="medium" level="3">
									Applikasjonsrutiner
								</Heading>
								<HStack align="center" gap="space-4">
									<BodyShort size="small" textColor="subtle">
										{sortedAppRows.length} rutiner ikke gjennomført
									</BodyShort>
									<Select
										label="Rader per side"
										size="small"
										hideLabel
										value={String(appPageSize)}
										onChange={(e) => {
											setAppPageSize(Number(e.target.value))
											setAppPage(1)
										}}
									>
										{PAGE_SIZE_OPTIONS.map((n) => (
											<option key={n} value={n}>
												{n} per side
											</option>
										))}
									</Select>
								</HStack>
							</HStack>

							{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */}
							<section className="table-scroll" tabIndex={0} aria-label="Applikasjonsrutiner ikke gjennomført">
								<Table sort={appSort} onSortChange={handleAppSort}>
									<Table.Header>
										<Table.Row>
											<Table.ColumnHeader sortKey="name" sortable scope="col">
												Rutine
											</Table.ColumnHeader>
											<Table.ColumnHeader sortKey="app" sortable scope="col">
												Applikasjon
											</Table.ColumnHeader>
											<Table.ColumnHeader sortKey="team" sortable scope="col">
												Team
											</Table.ColumnHeader>
											<Table.ColumnHeader sortKey="frequency" sortable scope="col">
												Frekvens
											</Table.ColumnHeader>
											<Table.ColumnHeader sortKey="lastReview" sortable scope="col">
												Siste gjennomgang
											</Table.ColumnHeader>
											<Table.ColumnHeader sortKey="deadline" sortable scope="col">
												Frist
											</Table.ColumnHeader>
											<Table.ColumnHeader sortKey="status" sortable scope="col">
												Status
											</Table.ColumnHeader>
										</Table.Row>
									</Table.Header>
									<Table.Body>
										{pagedAppRows.map((row) => (
											<Table.Row key={`${row.routineId ?? "x"}-${row.applicationId}`}>
												<Table.DataCell>
													{row.routineId ? (
														<Link to={`/seksjoner/${seksjon}/rutiner/${row.routineId}`}>{row.routineName}</Link>
													) : (
														(row.routineName ?? "—")
													)}
												</Table.DataCell>
												<Table.DataCell>
													<Link to={`/seksjoner/${seksjon}/applikasjoner/${row.applicationId}/detaljer?fane=rutiner`}>
														{row.applicationName}
													</Link>
												</Table.DataCell>
												<Table.DataCell>{row.teamNames.length > 0 ? row.teamNames.join(", ") : "—"}</Table.DataCell>
												<Table.DataCell>
													<FrequencyDisplay frequency={row.frequency} eventFrequency={row.eventFrequency} />
												</Table.DataCell>
												<Table.DataCell>{formatDate(row.lastReviewDate)}</Table.DataCell>
												<Table.DataCell>{formatDate(row.deadline)}</Table.DataCell>
												<Table.DataCell>
													{!row.lastReviewDate ? (
														<Tag variant="neutral" size="small">
															Ikke gjennomført
														</Tag>
													) : (
														<Tag variant="error" size="small">
															Over frist
														</Tag>
													)}
												</Table.DataCell>
											</Table.Row>
										))}
									</Table.Body>
								</Table>
							</section>

							<Pagination totalPages={appTotalPages} currentPage={appCurrentPage} setPage={setAppPage} />
						</VStack>
					)}

					{sectionRows.length > 0 && (
						<VStack gap="space-4">
							<HStack align="center" justify="space-between">
								<Heading size="medium" level="3">
									Seksjonsrutiner
								</Heading>
								<HStack align="center" gap="space-4">
									<BodyShort size="small" textColor="subtle">
										{sectionRows.length} rutiner · {totalSectionHits} applikasjonstreff
									</BodyShort>
									<Select
										label="Rader per side"
										size="small"
										hideLabel
										value={String(sectionPageSize)}
										onChange={(e) => {
											setSectionPageSize(Number(e.target.value))
											setSectionPage(1)
										}}
									>
										{PAGE_SIZE_OPTIONS.map((n) => (
											<option key={n} value={n}>
												{n} per side
											</option>
										))}
									</Select>
								</HStack>
							</HStack>

							{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */}
							<section className="table-scroll" tabIndex={0} aria-label="Seksjonsrutiner ikke gjennomført">
								<Table sort={sectionSort} onSortChange={handleSectionSort}>
									<Table.Header>
										<Table.Row>
											<Table.ColumnHeader sortKey="name" sortable scope="col">
												Rutine
											</Table.ColumnHeader>
											<Table.ColumnHeader sortKey="frequency" sortable scope="col">
												Frekvens
											</Table.ColumnHeader>
											<Table.ColumnHeader sortKey="lastReview" sortable scope="col">
												Siste gjennomgang
											</Table.ColumnHeader>
											<Table.ColumnHeader sortKey="deadline" sortable scope="col">
												Frist
											</Table.ColumnHeader>
											<Table.ColumnHeader sortKey="status" sortable scope="col">
												Status
											</Table.ColumnHeader>
											<Table.ColumnHeader sortKey="appCount" sortable scope="col">
												Applikasjonstreff
											</Table.ColumnHeader>
										</Table.Row>
									</Table.Header>
									<Table.Body>
										{pagedSectionRows.map((row) => (
											<Table.Row key={row.routineId}>
												<Table.DataCell>
													<Link to={`/seksjoner/${seksjon}/rutiner/${row.routineId}`}>{row.routineName}</Link>
												</Table.DataCell>
												<Table.DataCell>
													<FrequencyDisplay frequency={row.frequency} eventFrequency={row.eventFrequency} />
												</Table.DataCell>
												<Table.DataCell>{formatDate(row.lastReviewDate)}</Table.DataCell>
												<Table.DataCell>{formatDate(row.deadline)}</Table.DataCell>
												<Table.DataCell>
													{!row.lastReviewDate ? (
														<Tag variant="neutral" size="small">
															Ikke gjennomført
														</Tag>
													) : (
														<Tag variant="error" size="small">
															Over frist
														</Tag>
													)}
												</Table.DataCell>
												<Table.DataCell>{row.appCount}</Table.DataCell>
											</Table.Row>
										))}
									</Table.Body>
								</Table>
							</section>

							<Pagination totalPages={sectionTotalPages} currentPage={sectionCurrentPage} setPage={setSectionPage} />
						</VStack>
					)}
				</VStack>
			)}
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
