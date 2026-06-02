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

	// Seksjonsrutiner dedupliseres på routine.id — samme rutine kan matche
	// mot flere apper i teamet, men lastReviewDate/deadline er seksjonsnivå.
	const seenRoutineIds = new Set<string>()
	const sectionRoutines = result.deadlines.filter((d) => {
		if (!d.isSectionRoutine || !d.routine) return false
		if (seenRoutineIds.has(d.routine.id)) return false
		seenRoutineIds.add(d.routine.id)
		return true
	})

	const appRoutines = result.deadlines.filter((d) => !d.isSectionRoutine)

	return data({
		seksjon,
		seksjonName: section.name,
		team: teamSlug,
		teamName: result.team.name,
		sectionRoutines,
		appRoutines,
		sectionSlugMap,
	})
}

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100]

type AppSortKey = "priority" | "name" | "app" | "lastReview" | "deadline" | "status"
type SectionSortKey = "priority" | "name" | "ownerRole" | "lastReview" | "deadline" | "status"
type SortDirection = "ascending" | "descending"

function routineStatusKey(dl: { overdue: boolean; lastReviewDate: Date | string | null }) {
	if (dl.overdue) return "overdue"
	if (dl.lastReviewDate) return "ok"
	return "never"
}

export default function TeamUgjennomforteRutiner() {
	const { seksjon, seksjonName, team, teamName, sectionRoutines, appRoutines, sectionSlugMap } =
		useLoaderData<typeof loader>()

	const [appSort, setAppSort] = useState<{ orderBy: AppSortKey; direction: SortDirection }>({
		orderBy: "priority",
		direction: "ascending",
	})
	const [sectionSort, setSectionSort] = useState<{ orderBy: SectionSortKey; direction: SortDirection }>({
		orderBy: "priority",
		direction: "ascending",
	})
	const [appPage, setAppPage] = useState(1)
	const [appPageSize, setAppPageSize] = useState(25)

	const handleAppSort = (sortKey: string | undefined) => {
		if (!sortKey) return
		setAppSort((prev) =>
			prev.orderBy === sortKey
				? { orderBy: sortKey as AppSortKey, direction: prev.direction === "ascending" ? "descending" : "ascending" }
				: { orderBy: sortKey as AppSortKey, direction: "ascending" },
		)
		setAppPage(1)
	}

	const handleSectionSort = (sortKey: string | undefined) => {
		if (!sortKey) return
		setSectionSort((prev) =>
			prev.orderBy === sortKey
				? {
						orderBy: sortKey as SectionSortKey,
						direction: prev.direction === "ascending" ? "descending" : "ascending",
					}
				: { orderBy: sortKey as SectionSortKey, direction: "ascending" },
		)
	}

	const sortedSectionRoutines = useMemo(() => {
		const dir = sectionSort.direction === "ascending" ? 1 : -1
		return [...sectionRoutines].sort((a, b) => {
			switch (sectionSort.orderBy) {
				case "priority": {
					return ((a.routine?.priority ?? 3) - (b.routine?.priority ?? 3)) * dir
				}
				case "name":
					return (a.routine?.name ?? "").localeCompare(b.routine?.name ?? "", "nb") * dir
				case "ownerRole":
					return (
						(a.sectionRoutineOwnerRole ?? "Seksjonsleder").localeCompare(
							b.sectionRoutineOwnerRole ?? "Seksjonsleder",
							"nb",
						) * dir
					)
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
					return (
						((order[routineStatusKey(a) as keyof typeof order] ?? 9) -
							(order[routineStatusKey(b) as keyof typeof order] ?? 9)) *
						dir
					)
				}
				default:
					return 0
			}
		})
	}, [sectionRoutines, sectionSort])

	const sortedAppRoutines = useMemo(() => {
		const dir = appSort.direction === "ascending" ? 1 : -1
		return [...appRoutines].sort((a, b) => {
			switch (appSort.orderBy) {
				case "priority":
					return ((a.routine?.priority ?? 3) - (b.routine?.priority ?? 3)) * dir
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
					return (
						((order[routineStatusKey(a) as keyof typeof order] ?? 9) -
							(order[routineStatusKey(b) as keyof typeof order] ?? 9)) *
						dir
					)
				}
				default:
					return 0
			}
		})
	}, [appRoutines, appSort])

	const totalAppPages = Math.max(1, Math.ceil(sortedAppRoutines.length / appPageSize))
	const currentAppPage = Math.min(appPage, totalAppPages)
	const pagedAppRoutines = sortedAppRoutines.slice((currentAppPage - 1) * appPageSize, currentAppPage * appPageSize)

	function routineRow(dl: (typeof appRoutines)[number], key: string, opts: { showApp: boolean }) {
		const routineLink =
			dl.routine?.sectionId && sectionSlugMap[dl.routine.sectionId]
				? `/seksjoner/${sectionSlugMap[dl.routine.sectionId]}/rutiner/${dl.routine.id}`
				: null
		const appLink = `/seksjoner/${seksjon}/team/${team}/applikasjoner/${dl.applicationId}/detaljer?fane=rutiner`

		return (
			<Table.Row key={key}>
				<Table.DataCell>
					{routineLink ? <Link to={routineLink}>{dl.routine?.name ?? "—"}</Link> : (dl.routine?.name ?? "—")}
				</Table.DataCell>
				{opts.showApp && (
					<Table.DataCell>
						<Link to={appLink}>{dl.applicationName}</Link>
					</Table.DataCell>
				)}
				<Table.DataCell>
					<PriorityTag priority={dl.routine?.priority ?? 3} />
				</Table.DataCell>
				<Table.DataCell>
					<FrequencyDisplay frequency={dl.routine?.frequency} eventFrequency={dl.routine?.eventFrequency} />
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
	}

	const totalCount = sectionRoutines.length + appRoutines.length

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
				<BodyShort textColor="subtle">{totalCount} rutiner ikke gjennomført</BodyShort>
			</VStack>

			{totalCount === 0 ? (
				<Box padding="space-16" borderRadius="8" background="sunken">
					<BodyShort>Alle rutiner er gjennomført. Bra jobbet! 🎉</BodyShort>
				</Box>
			) : (
				<VStack gap="space-8">
					{sectionRoutines.length > 0 && (
						<VStack gap="space-4">
							<Heading size="medium" level="3">
								Seksjonsrutiner
							</Heading>
							<BodyShort size="small" textColor="subtle">
								{sectionRoutines.length} seksjonsrutine{sectionRoutines.length !== 1 ? "r" : ""} ikke gjennomført
							</BodyShort>
							{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */}
							<section className="table-scroll" tabIndex={0} aria-label="Ikke-gjennomførte seksjonsrutiner">
								<Table sort={sectionSort} onSortChange={handleSectionSort}>
									<Table.Header>
										<Table.Row>
											<Table.ColumnHeader sortKey="name" sortable scope="col">
												Rutine
											</Table.ColumnHeader>
											<Table.ColumnHeader sortKey="ownerRole" sortable scope="col">
												Ansvarlig rolle
											</Table.ColumnHeader>
											<Table.ColumnHeader sortKey="priority" sortable scope="col">
												Prioritet
											</Table.ColumnHeader>
											<Table.HeaderCell scope="col">Frekvens</Table.HeaderCell>
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
										{sortedSectionRoutines.map((dl, index) => {
											const key = `${dl.routine?.id ?? index}-section`
											const routineLink =
												dl.routine?.sectionId && sectionSlugMap[dl.routine.sectionId]
													? `/seksjoner/${sectionSlugMap[dl.routine.sectionId]}/rutiner/${dl.routine.id}`
													: null
											return (
												<Table.Row key={key}>
													<Table.DataCell>
														{routineLink ? (
															<Link to={routineLink}>{dl.routine?.name ?? "—"}</Link>
														) : (
															(dl.routine?.name ?? "—")
														)}
													</Table.DataCell>
													<Table.DataCell>{dl.sectionRoutineOwnerRole ?? "Seksjonsleder"}</Table.DataCell>
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
						</VStack>
					)}

					{appRoutines.length > 0 && (
						<VStack gap="space-4">
							<Heading size="medium" level="3">
								Applikasjonsrutiner
							</Heading>
							<HStack justify="space-between" align="end" wrap>
								<BodyShort size="small" textColor="subtle">
									Viser {(currentAppPage - 1) * appPageSize + 1}–
									{Math.min(currentAppPage * appPageSize, sortedAppRoutines.length)} av {sortedAppRoutines.length}
								</BodyShort>
								<Select
									label="Rader per side"
									size="small"
									value={appPageSize}
									onChange={(e) => {
										setAppPageSize(Number(e.target.value))
										setAppPage(1)
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

							{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */}
							<section className="table-scroll" tabIndex={0} aria-label="Ikke-gjennomførte applikasjonsrutiner">
								<Table sort={appSort} onSortChange={handleAppSort}>
									<Table.Header>
										<Table.Row>
											<Table.ColumnHeader sortKey="name" sortable scope="col">
												Rutine
											</Table.ColumnHeader>
											<Table.ColumnHeader sortKey="app" sortable scope="col">
												Applikasjon
											</Table.ColumnHeader>
											<Table.ColumnHeader sortKey="priority" sortable scope="col">
												Prioritet
											</Table.ColumnHeader>
											<Table.HeaderCell scope="col">Frekvens</Table.HeaderCell>
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
										{pagedAppRoutines.map((dl, index) =>
											routineRow(dl, `${dl.applicationId}:${dl.routine?.id ?? index}:${dl.matchSource}`, {
												showApp: true,
											}),
										)}
									</Table.Body>
								</Table>
							</section>

							{totalAppPages > 1 && (
								<HStack justify="center" gap="space-2" wrap>
									<button
										type="button"
										onClick={() => setAppPage((p) => Math.max(1, p - 1))}
										disabled={currentAppPage === 1}
										style={{
											padding: "var(--ax-space-4) var(--ax-space-8)",
											cursor: currentAppPage === 1 ? "default" : "pointer",
										}}
									>
										Forrige
									</button>
									{Array.from({ length: totalAppPages }, (_, i) => i + 1)
										.filter((p) => p === 1 || p === totalAppPages || Math.abs(p - currentAppPage) <= 2)
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
													onClick={() => setAppPage(p)}
													aria-current={p === currentAppPage ? "page" : undefined}
													style={{
														padding: "var(--ax-space-4) var(--ax-space-8)",
														fontWeight: p === currentAppPage ? "bold" : undefined,
														cursor: p === currentAppPage ? "default" : "pointer",
													}}
												>
													{p}
												</button>
											),
										)}
									<button
										type="button"
										onClick={() => setAppPage((p) => Math.min(totalAppPages, p + 1))}
										disabled={currentAppPage === totalAppPages}
										style={{
											padding: "var(--ax-space-4) var(--ax-space-8)",
											cursor: currentAppPage === totalAppPages ? "default" : "pointer",
										}}
									>
										Neste
									</button>
								</HStack>
							)}
						</VStack>
					)}
				</VStack>
			)}
		</VStack>
	)
}
