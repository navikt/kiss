import { Alert, BodyShort, Box, Button, Heading, HStack, Select, Table, Tag, VStack } from "@navikt/ds-react"
import { useMemo, useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Link, redirect, useActionData, useLoaderData } from "react-router"
import { FrequencyDisplay } from "~/components/FrequencyDisplay"
import { PriorityTag } from "~/components/PriorityTag"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getSectionBySlug, getSections, getTeamBySlug, getTeamIncompleteRoutines } from "~/db/queries/sections.server"
import { requireAuthenticatedUser } from "~/lib/auth.server"
import { createDraftReview } from "~/lib/create-draft-review.server"

export { RouteErrorBoundary as ErrorBoundary }

export async function loader({ request, params }: LoaderFunctionArgs) {
	const seksjon = params.seksjon
	const teamSlug = params.team
	if (!seksjon) throw new Response("Mangler seksjon", { status: 400 })
	if (!teamSlug) throw new Response("Mangler team", { status: 400 })

	await requireAuthenticatedUser(request)

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
	// Type guard narrows dl.routine til non-null slik at UI-koden slipper optional chaining.
	type DeadlineWithRoutine = (typeof result.deadlines)[number] & {
		routine: NonNullable<(typeof result.deadlines)[number]["routine"]>
	}
	const seenRoutineIds = new Set<string>()
	const sectionRoutines = result.deadlines.filter((d): d is DeadlineWithRoutine => {
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

export async function action({ request, params }: ActionFunctionArgs) {
	const seksjon = params.seksjon
	const teamSlug = params.team
	if (!seksjon) throw new Response("Mangler seksjon", { status: 400 })
	if (!teamSlug) throw new Response("Mangler team", { status: 400 })

	const authedUser = await requireAuthenticatedUser(request)

	// Validate team exists and belongs to the section — same guard as loader.
	const [section, team] = await Promise.all([getSectionBySlug(seksjon), getTeamBySlug(teamSlug)])
	if (!section) throw new Response("Seksjon ikke funnet", { status: 404 })
	if (!team) throw new Response("Team ikke funnet", { status: 404 })
	if (team.sectionId !== section.id) throw new Response("Team tilhører ikke denne seksjonen", { status: 404 })

	const formData = await request.formData()
	const intent = formData.get("intent")

	if (intent === "create-draft") {
		const result = await createDraftReview({
			routineId: formData.get("routineId") as string | null,
			sectionSlug: seksjon,
			applicationId: (formData.get("applicationId") as string | null) || null,
			navIdent: authedUser.navIdent,
		})
		if (!result.ok) {
			return data({ success: false, error: result.error, intent: "create-draft" }, { status: result.status })
		}
		return redirect(`/seksjoner/${result.sectionSlug}/rutiner/${result.routineId}/gjennomgang/${result.reviewId}`)
	}

	return data({ success: false, error: "Ukjent handling" }, { status: 400 })
}

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100]

type AppSortKey = "priority" | "name" | "app" | "lastReview" | "deadline" | "status"
type SectionSortKey = "priority" | "name" | "ownerRole" | "lastReview" | "deadline" | "status"
type SortDirection = "ascending" | "descending"
type ActionFilter = "alle" | "ny" | "fortsett"

function routineStatusKey(dl: { overdue: boolean; lastReviewDate: Date | string | null }) {
	if (dl.overdue) return "overdue"
	if (dl.lastReviewDate) return "ok"
	return "never"
}

export default function TeamUgjennomforteRutiner() {
	const { seksjon, seksjonName, team, teamName, sectionRoutines, appRoutines, sectionSlugMap } =
		useLoaderData<typeof loader>()
	const actionData = useActionData<typeof action>()
	const createDraftError =
		actionData && "error" in actionData && "intent" in actionData && actionData.intent === "create-draft"
			? actionData.error
			: null

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
	const [appActionFilter, setAppActionFilter] = useState<ActionFilter>("alle")
	const [sectionActionFilter, setSectionActionFilter] = useState<ActionFilter>("alle")

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

	function matchesActionFilter(filter: ActionFilter, draftReviewId: string | null | undefined) {
		if (filter === "ny") return !draftReviewId
		if (filter === "fortsett") return !!draftReviewId
		return true
	}

	const filteredAppRoutines = sortedAppRoutines.filter((dl) => matchesActionFilter(appActionFilter, dl.draftReviewId))
	const filteredSectionRoutines = sortedSectionRoutines.filter((dl) =>
		matchesActionFilter(sectionActionFilter, dl.draftReviewId),
	)

	const totalFilteredAppPages = Math.max(1, Math.ceil(filteredAppRoutines.length / appPageSize))
	const currentFilteredAppPage = Math.min(appPage, totalFilteredAppPages)
	const pagedFilteredAppRoutines = filteredAppRoutines.slice(
		(currentFilteredAppPage - 1) * appPageSize,
		currentFilteredAppPage * appPageSize,
	)

	function renderRoutineAction(dl: (typeof appRoutines)[number]) {
		if (!dl.routine?.sectionId || !sectionSlugMap[dl.routine.sectionId]) return null
		const sectionSlug = sectionSlugMap[dl.routine.sectionId]
		const routineName = dl.routine.name
		const appContext = !dl.isSectionRoutine && dl.applicationName ? ` for ${dl.applicationName}` : ""
		if (dl.draftReviewId) {
			return (
				<Button
					as={Link}
					to={`/seksjoner/${sectionSlug}/rutiner/${dl.routine.id}/gjennomgang/${dl.draftReviewId}`}
					variant="tertiary"
					size="xsmall"
					aria-label={`Fortsett gjennomgang av «${routineName}»${appContext}`}
				>
					Fortsett gjennomgang
				</Button>
			)
		}
		return (
			<form method="post" style={{ display: "inline" }}>
				<input type="hidden" name="intent" value="create-draft" />
				<input type="hidden" name="routineId" value={dl.routine.id} />
				{!dl.isSectionRoutine && <input type="hidden" name="applicationId" value={dl.applicationId} />}
				<Button
					type="submit"
					variant="tertiary"
					size="xsmall"
					aria-label={`Ny gjennomgang av «${routineName}»${appContext}`}
				>
					Ny gjennomgang
				</Button>
			</form>
		)
	}

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
				<Table.DataCell>{renderRoutineAction(dl)}</Table.DataCell>
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

			{createDraftError && (
				<Alert variant="error" size="small">
					{createDraftError}
				</Alert>
			)}

			{totalCount === 0 ? (
				<Box padding="space-16" borderRadius="8" background="sunken">
					<BodyShort>Alle rutiner er gjennomført. Bra jobbet! 🎉</BodyShort>
				</Box>
			) : (
				<VStack gap="space-8">
					{appRoutines.length > 0 && (
						<VStack gap="space-4">
							<Heading size="medium" level="3">
								Applikasjonsrutiner
							</Heading>
							<HStack justify="space-between" align="end" wrap>
								<BodyShort size="small" textColor="subtle">
									Viser {filteredAppRoutines.length === 0 ? 0 : (currentFilteredAppPage - 1) * appPageSize + 1}–
									{Math.min(currentFilteredAppPage * appPageSize, filteredAppRoutines.length)} av{" "}
									{filteredAppRoutines.length}
									{appActionFilter !== "alle" ? ` (filtrert fra ${sortedAppRoutines.length})` : ""}
								</BodyShort>
								<HStack gap="space-4" align="end">
									<Select
										label="Handlinger"
										size="small"
										value={appActionFilter}
										onChange={(e) => {
											setAppActionFilter(e.target.value as ActionFilter)
											setAppPage(1)
										}}
										style={{ width: "auto" }}
									>
										<option value="alle">Alle</option>
										<option value="ny">Ny gjennomgang</option>
										<option value="fortsett">Fortsett gjennomgang</option>
									</Select>
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
											<Table.HeaderCell scope="col">Handlinger</Table.HeaderCell>
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
										{pagedFilteredAppRoutines.map((dl, index) =>
											routineRow(dl, `${dl.applicationId}:${dl.routine?.id ?? index}:${dl.matchSource}`, {
												showApp: true,
											}),
										)}
									</Table.Body>
								</Table>
							</section>

							{totalFilteredAppPages > 1 && (
								<HStack justify="center" gap="space-2" wrap>
									<button
										type="button"
										onClick={() => setAppPage((p) => Math.max(1, p - 1))}
										disabled={currentFilteredAppPage === 1}
										style={{
											padding: "var(--ax-space-4) var(--ax-space-8)",
											cursor: currentFilteredAppPage === 1 ? "default" : "pointer",
										}}
									>
										Forrige
									</button>
									{Array.from({ length: totalFilteredAppPages }, (_, i) => i + 1)
										.filter((p) => p === 1 || p === totalFilteredAppPages || Math.abs(p - currentFilteredAppPage) <= 2)
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
													aria-current={p === currentFilteredAppPage ? "page" : undefined}
													style={{
														padding: "var(--ax-space-4) var(--ax-space-8)",
														fontWeight: p === currentFilteredAppPage ? "bold" : undefined,
														cursor: p === currentFilteredAppPage ? "default" : "pointer",
													}}
												>
													{p}
												</button>
											),
										)}
									<button
										type="button"
										onClick={() => setAppPage((p) => Math.min(totalFilteredAppPages, p + 1))}
										disabled={currentFilteredAppPage === totalFilteredAppPages}
										style={{
											padding: "var(--ax-space-4) var(--ax-space-8)",
											cursor: currentFilteredAppPage === totalFilteredAppPages ? "default" : "pointer",
										}}
									>
										Neste
									</button>
								</HStack>
							)}
						</VStack>
					)}

					{sectionRoutines.length > 0 && (
						<VStack gap="space-4">
							<Heading size="medium" level="3">
								Seksjonsrutiner
							</Heading>
							<HStack justify="space-between" align="end" wrap>
								<BodyShort size="small" textColor="subtle">
									{filteredSectionRoutines.length} seksjonsrutine
									{filteredSectionRoutines.length !== 1 ? "r" : ""} ikke gjennomført
									{sectionActionFilter !== "alle" ? ` (filtrert fra ${sortedSectionRoutines.length})` : ""}
								</BodyShort>
								<Select
									label="Handlinger"
									size="small"
									value={sectionActionFilter}
									onChange={(e) => setSectionActionFilter(e.target.value as ActionFilter)}
									style={{ width: "auto" }}
								>
									<option value="alle">Alle</option>
									<option value="ny">Ny gjennomgang</option>
									<option value="fortsett">Fortsett gjennomgang</option>
								</Select>
							</HStack>
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
											<Table.HeaderCell scope="col">Handlinger</Table.HeaderCell>
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
										{filteredSectionRoutines.map((dl) => {
											const key = `${dl.routine.id}-section`
											const routineLink =
												dl.routine.sectionId && sectionSlugMap[dl.routine.sectionId]
													? `/seksjoner/${sectionSlugMap[dl.routine.sectionId]}/rutiner/${dl.routine.id}`
													: null
											return (
												<Table.Row key={key}>
													<Table.DataCell>
														{routineLink ? (
															<Link to={routineLink}>{dl.routine.name ?? "—"}</Link>
														) : (
															(dl.routine.name ?? "—")
														)}
													</Table.DataCell>
													<Table.DataCell>{dl.sectionRoutineOwnerRole ?? "Seksjonsleder"}</Table.DataCell>
													<Table.DataCell>{renderRoutineAction(dl)}</Table.DataCell>
													<Table.DataCell>
														<PriorityTag priority={dl.routine.priority ?? 3} />
													</Table.DataCell>
													<Table.DataCell>
														<FrequencyDisplay
															frequency={dl.routine.frequency}
															eventFrequency={dl.routine.eventFrequency}
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
				</VStack>
			)}
		</VStack>
	)
}
