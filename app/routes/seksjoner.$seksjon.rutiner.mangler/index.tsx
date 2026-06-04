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

	// Deduplicate section routines — same routine can match multiple apps but deadline is section-level
	const seenSectionRoutineIds = new Set<string>()
	const deduplicated = deadlines.filter((d) => {
		if (!d.routine?.isSectionRoutine) return true
		if (seenSectionRoutineIds.has(d.routine.id)) return false
		seenSectionRoutineIds.add(d.routine.id)
		return true
	})

	// Batch-fetch team names for all app routines
	const appIds = deduplicated.filter((d) => !d.routine?.isSectionRoutine).map((d) => d.applicationId)

	const uniqueAppIds = [...new Set(appIds)]
	const teamNamesByApp = await getTeamNamesForApps(uniqueAppIds, section.id)

	const rows = deduplicated.map((d) => ({
		routineId: d.routine?.id ?? null,
		routineName: d.routine?.name ?? null,
		isSectionRoutine: d.routine?.isSectionRoutine === 1,
		applicationId: d.applicationId,
		// Section routines match multiple apps — use empty string so sorting on app column is stable
		applicationName: d.routine?.isSectionRoutine === 1 ? "" : d.applicationName,
		frequency: d.routine?.frequency ?? null,
		eventFrequency: d.routine?.eventFrequency ?? null,
		lastReviewDate: d.lastReviewDate ? d.lastReviewDate.toISOString() : null,
		deadline: d.deadline ? d.deadline.toISOString() : null,
		teamNames: d.routine?.isSectionRoutine === 1 ? [] : (teamNamesByApp.get(d.applicationId) ?? []),
	}))

	return data({ seksjon, sectionName: section.name, rows })
}

function statusKey(row: { lastReviewDate: string | null }) {
	return !row.lastReviewDate ? "never" : "overdue"
}

export default function IkkeGjennomforteRutiner() {
	const { seksjon, sectionName, rows } = useLoaderData<typeof loader>()

	const [sort, setSort] = useState<{ orderBy: SortKey; direction: SortDirection }>({
		orderBy: "deadline",
		direction: "ascending",
	})
	const [page, setPage] = useState(1)
	const [pageSize, setPageSize] = useState(25)

	function handleSort(key: string | undefined) {
		if (!key) return
		setSort((prev) =>
			prev.orderBy === key
				? { orderBy: key as SortKey, direction: prev.direction === "ascending" ? "descending" : "ascending" }
				: { orderBy: key as SortKey, direction: "ascending" },
		)
		setPage(1)
	}

	const sorted = useMemo(() => {
		const dir = sort.direction === "ascending" ? 1 : -1
		return [...rows].sort((a, b) => {
			switch (sort.orderBy) {
				case "name":
					return (a.routineName ?? "").localeCompare(b.routineName ?? "", "nb") * dir
				case "app":
					return (a.applicationName ?? "").localeCompare(b.applicationName ?? "", "nb") * dir
				case "team":
					return (a.teamNames.join(", ") ?? "").localeCompare(b.teamNames.join(", ") ?? "", "nb") * dir
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
	}, [rows, sort])

	const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
	const currentPage = Math.min(page, totalPages)
	const paged = sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize)

	return (
		<VStack gap="space-8">
			<Heading size="xlarge" level="2" spacing>
				Rutiner ikke gjennomført — {sectionName}
			</Heading>

			{rows.length === 0 ? (
				<Box padding="space-6" borderRadius="8" background="sunken">
					<BodyShort>Ingen rutiner ikke gjennomført. Bra jobbet!</BodyShort>
				</Box>
			) : (
				<VStack gap="space-4">
					<HStack align="center" justify="space-between">
						<BodyShort size="small" textColor="subtle">
							{sorted.length} rutiner ikke gjennomført
						</BodyShort>
						<HStack align="center" gap="space-2">
							<Select
								label="Rader per side"
								size="small"
								hideLabel
								value={String(pageSize)}
								onChange={(e) => {
									setPageSize(Number(e.target.value))
									setPage(1)
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
					<section className="table-scroll" tabIndex={0} aria-label="Rutiner ikke gjennomført">
						<Table sort={sort} onSortChange={handleSort}>
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
								{paged.map((row, index) => (
									<Table.Row
										key={
											row.isSectionRoutine
												? `section-${row.routineId ?? index}`
												: `${row.routineId ?? index}-${row.applicationId}`
										}
									>
										<Table.DataCell>
											{row.routineId ? (
												<Link to={`/seksjoner/${seksjon}/rutiner/${row.routineId}`}>{row.routineName}</Link>
											) : (
												(row.routineName ?? "—")
											)}
										</Table.DataCell>
										<Table.DataCell>
											{row.isSectionRoutine ? (
												<BodyShort size="small" textColor="subtle">
													Alle applikasjoner
												</BodyShort>
											) : (
												<Link to={`/seksjoner/${seksjon}/applikasjoner/${row.applicationId}/detaljer?fane=rutiner`}>
													{row.applicationName}
												</Link>
											)}
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

					{totalPages > 1 && (
						<HStack gap="space-2" justify="center" wrap>
							<button
								type="button"
								onClick={() => setPage((p) => Math.max(1, p - 1))}
								disabled={currentPage === 1}
								style={{
									padding: "var(--ax-space-4) var(--ax-space-8)",
									cursor: currentPage === 1 ? "default" : "pointer",
								}}
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
								onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
								disabled={currentPage === totalPages}
								style={{
									padding: "var(--ax-space-4) var(--ax-space-8)",
									cursor: currentPage === totalPages ? "default" : "pointer",
								}}
							>
								Neste
							</button>
						</HStack>
					)}
				</VStack>
			)}
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
