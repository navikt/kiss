import { BodyShort, Box, Heading, HStack, Select, Table, Tag, VStack } from "@navikt/ds-react"
import { useMemo, useState } from "react"
import type { LoaderFunctionArgs } from "react-router"
import { data, Link, useLoaderData } from "react-router"
import { FrequencyDisplay } from "~/components/FrequencyDisplay"
import { PriorityTag } from "~/components/PriorityTag"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getSectionBySlug, getSections, getTeamIncompleteRoutines } from "~/db/queries/sections.server"
import { getAuthenticatedUser } from "~/lib/auth.server"

export { RouteErrorBoundary as ErrorBoundary }

export async function loader({ request, params }: LoaderFunctionArgs) {
	const seksjon = params.seksjon
	const teamSlug = params.team
	if (!seksjon) throw new Response("Mangler seksjon", { status: 400 })
	if (!teamSlug) throw new Response("Mangler team", { status: 400 })

	await getAuthenticatedUser(request)

	const [result, section, allSections] = await Promise.all([
		getTeamIncompleteRoutines(teamSlug),
		getSectionBySlug(seksjon),
		getSections({ includeArchived: true }),
	])

	if (!result) throw new Response("Team ikke funnet", { status: 404 })
	if (!section) throw new Response("Seksjon ikke funnet", { status: 404 })
	if (result.team.sectionId !== section.id) throw new Response("Team tilhører ikke denne seksjonen", { status: 404 })

	const sectionSlugMap = Object.fromEntries(allSections.map((s) => [s.id, s.slug]))

	return data({
		seksjon,
		seksjonName: section.name,
		team: teamSlug,
		teamName: result.team.name,
		deadlines: result.deadlines,
		sectionSlugMap,
	})
}

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100]

type SortKey = "priority" | "name" | "app" | "lastReview" | "deadline" | "status"
type SortDirection = "ascending" | "descending"

function routineStatusKey(dl: { overdue: boolean; lastReviewDate: Date | string | null }) {
	if (dl.overdue) return "overdue"
	if (dl.lastReviewDate) return "ok"
	return "never"
}

export default function TeamUgjennomforteRutiner() {
	const { seksjon, seksjonName, team, teamName, deadlines, sectionSlugMap } = useLoaderData<typeof loader>()

	const [sort, setSort] = useState<{ orderBy: SortKey; direction: SortDirection }>({
		orderBy: "priority",
		direction: "ascending",
	})
	const [page, setPage] = useState(1)
	const [pageSize, setPageSize] = useState(25)

	const handleSort = (sortKey: string | undefined) => {
		if (!sortKey) return
		setSort((prev) =>
			prev.orderBy === sortKey
				? { orderBy: sortKey as SortKey, direction: prev.direction === "ascending" ? "descending" : "ascending" }
				: { orderBy: sortKey as SortKey, direction: "ascending" },
		)
		setPage(1)
	}

	const sorted = useMemo(() => {
		const dir = sort.direction === "ascending" ? 1 : -1
		return [...deadlines].sort((a, b) => {
			switch (sort.orderBy) {
				case "priority": {
					const aPriority = a.routine?.priority ?? 3
					const bPriority = b.routine?.priority ?? 3
					return (aPriority - bPriority) * dir
				}
				case "name":
					return (a.routine?.name ?? "").localeCompare(b.routine?.name ?? "", "nb") * dir
				case "app":
					return (a.applicationName ?? "").localeCompare(b.applicationName ?? "", "nb") * dir
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
					const order = { overdue: 0, never: 1, ok: 2 }
					const aVal = order[routineStatusKey(a) as keyof typeof order] ?? 9
					const bVal = order[routineStatusKey(b) as keyof typeof order] ?? 9
					return (aVal - bVal) * dir
				}
				default:
					return 0
			}
		})
	}, [deadlines, sort])

	const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
	const currentPage = Math.min(page, totalPages)
	const paged = sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize)

	function sortableHeader(label: string, key: SortKey) {
		return (
			<Table.ColumnHeader sortKey={key} sortable scope="col">
				{label}
			</Table.ColumnHeader>
		)
	}

	return (
		<VStack gap="space-8">
			<VStack gap="space-2">
				<BodyShort size="small">
					<Link to={`/seksjoner/${seksjon}`}>{seksjonName}</Link>
					{" / "}
					<Link to={`/seksjoner/${seksjon}/team/${team}`}>{teamName}</Link>
				</BodyShort>
				<Heading size="xlarge" level="2">
					Ikke-gjennomførte rutiner
				</Heading>
				<BodyShort textColor="subtle">{deadlines.length} rutiner ikke gjennomført</BodyShort>
			</VStack>

			{deadlines.length === 0 ? (
				<Box padding="space-16" borderRadius="8" background="sunken">
					<BodyShort>Alle rutiner er gjennomført. Bra jobbet! 🎉</BodyShort>
				</Box>
			) : (
				<VStack gap="space-4">
					<HStack justify="space-between" align="end" wrap>
						<BodyShort size="small" textColor="subtle">
							Viser {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, sorted.length)} av{" "}
							{sorted.length}
						</BodyShort>
						<HStack gap="space-4" align="end">
							<Select
								label="Rader per side"
								size="small"
								value={pageSize}
								onChange={(e) => {
									setPageSize(Number(e.target.value))
									setPage(1)
								}}
								style={{ width: "auto" }}
							>
								{PAGE_SIZE_OPTIONS.map((n) => (
									<option key={n} value={n}>
										{n}
									</option>
								))}
							</Select>
						</HStack>
					</HStack>

					{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */}
					<section className="table-scroll" tabIndex={0} aria-label="Ikke-gjennomførte rutiner">
						<Table sort={sort} onSortChange={handleSort}>
							<Table.Header>
								<Table.Row>
									{sortableHeader("Rutine", "name")}
									{sortableHeader("Applikasjon", "app")}
									{sortableHeader("Prioritet", "priority")}
									<Table.HeaderCell scope="col">Frekvens</Table.HeaderCell>
									{sortableHeader("Siste gjennomgang", "lastReview")}
									{sortableHeader("Frist", "deadline")}
									{sortableHeader("Status", "status")}
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{paged.map((dl, index) => {
									const routineLink =
										dl.routine?.sectionId && sectionSlugMap[dl.routine.sectionId]
											? `/seksjoner/${sectionSlugMap[dl.routine.sectionId]}/rutiner/${dl.routine.id}`
											: null
									const appLink = `/seksjoner/${seksjon}/team/${team}/applikasjoner/${dl.applicationId}/detaljer?fane=rutiner`

									return (
										<Table.Row key={`${dl.applicationId}:${dl.routine?.id ?? index}:${dl.matchSource}`}>
											<Table.DataCell>
												{routineLink ? (
													<Link to={routineLink}>{dl.routine?.name ?? "—"}</Link>
												) : (
													(dl.routine?.name ?? "—")
												)}
											</Table.DataCell>
											<Table.DataCell>
												<Link to={appLink}>{dl.applicationName}</Link>
											</Table.DataCell>
											<Table.DataCell>
												<PriorityTag priority={dl.routine?.priority ?? 3} />
											</Table.DataCell>
											<Table.DataCell>
												<FrequencyDisplay
													frequency={dl.routine?.frequency}
													eventFrequency={dl.routine?.eventFrequency}
												/>
											</Table.DataCell>
											<Table.DataCell>
												{dl.lastReviewDate ? new Date(dl.lastReviewDate).toLocaleDateString("nb-NO") : "Aldri"}
											</Table.DataCell>
											<Table.DataCell>
												{dl.deadline ? new Date(dl.deadline).toLocaleDateString("nb-NO") : "Ingen frist"}
											</Table.DataCell>
											<Table.DataCell>
												<HStack gap="space-2" align="center" wrap>
													{dl.overdue ? (
														<Tag variant="error" size="small">
															Over frist
														</Tag>
													) : (
														<Tag variant="warning" size="small">
															Ikke gjennomført
														</Tag>
													)}
													{dl.needsFollowUp && (
														<Tag variant="warning" size="small">
															Må følges opp
														</Tag>
													)}
												</HStack>
											</Table.DataCell>
										</Table.Row>
									)
								})}
							</Table.Body>
						</Table>
					</section>

					{totalPages > 1 && (
						<HStack justify="center" gap="space-2" wrap>
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
