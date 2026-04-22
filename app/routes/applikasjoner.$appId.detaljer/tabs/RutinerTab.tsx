import {
	BodyShort,
	Button,
	Checkbox,
	CheckboxGroup,
	Heading,
	HStack,
	Search,
	Table,
	Tag,
	VStack,
} from "@navikt/ds-react"
import { useState } from "react"
import { Link } from "react-router"
import type { DataClassification } from "~/db/schema/applications"
import { dataClassificationLabels } from "~/db/schema/applications"
import { getFrequencyLabel } from "~/lib/routine-frequencies"
import { persistenceLabels } from "../shared"

type RoutineDeadline = {
	routine: {
		id: string
		name: string
		sectionId: string | null
		frequency: string | null
		technologyElements?: Array<{ id: string; name: string }>
	} | null
	matchSource: string
	deadline: Date | string
	lastReviewDate: Date | string | null
	overdue: boolean
	matchedPersistenceLinks?: Array<{ persistenceType: string | null; dataClassification: string | null }>
}

type CompletedReview = {
	id: string
	routineId: string
	routineName: string
	title: string
	reviewedAt: Date | string
	status: string
	createdBy: string
	sectionId: string | null
	participants: Array<{ confirmedAt: Date | string | null }>
}

export function RutinerTab({
	routineDeadlines,
	completedReviews,
	sectionSlugMap,
}: {
	routineDeadlines: RoutineDeadline[]
	completedReviews: CompletedReview[]
	sectionSlugMap: Record<string, string>
}) {
	const [routineSort, setRoutineSort] = useState<{ orderBy: string; direction: "ascending" | "descending" }>({
		orderBy: "status",
		direction: "descending",
	})
	const [routineSearch, setRoutineSearch] = useState("")
	const [routineStatusFilter, setRoutineStatusFilter] = useState<string[]>([])

	const routineStatusKey = (dl: RoutineDeadline): string => {
		if (dl.overdue) return "overdue"
		if (dl.lastReviewDate) return "ok"
		return "never"
	}

	const matchSourceLabel = (s: string): string => {
		const labels: Record<string, string> = {
			persistence: "Persistering",
			group_classification: "Tilgangsklassifisering",
			oracle_role_criticality: "Oracle-roller",
			screening_selection: "Valgt via spørsmål",
			section: "Seksjon",
			ruleset: "Regelsett",
			screening: "Screening",
		}
		return labels[s] ?? s
	}

	const filteredRoutines = routineDeadlines.filter((dl) => {
		if (routineStatusFilter.length > 0 && !routineStatusFilter.includes(routineStatusKey(dl))) return false
		if (routineSearch) {
			const q = routineSearch.toLowerCase()
			if (
				!(dl.routine?.name ?? "").toLowerCase().includes(q) &&
				!matchSourceLabel(dl.matchSource).toLowerCase().includes(q) &&
				!getFrequencyLabel(dl.routine?.frequency).toLowerCase().includes(q) &&
				!(dl.routine?.technologyElements ?? []).some((te) => te.name.toLowerCase().includes(q))
			)
				return false
		}
		return true
	})

	const sortedRoutines = [...filteredRoutines].sort((a, b) => {
		const dir = routineSort.direction === "ascending" ? 1 : -1
		const orderBy = routineSort.orderBy
		if (orderBy === "lastReview" || orderBy === "deadline") {
			const aRaw = orderBy === "lastReview" ? a.lastReviewDate : a.deadline
			const bRaw = orderBy === "lastReview" ? b.lastReviewDate : b.deadline
			const aTime = aRaw ? new Date(aRaw).getTime() : Number.NEGATIVE_INFINITY
			const bTime = bRaw ? new Date(bRaw).getTime() : Number.NEGATIVE_INFINITY
			return (aTime - bTime) * dir
		}
		let aVal: string
		let bVal: string
		if (orderBy === "name") {
			aVal = a.routine?.name ?? ""
			bVal = b.routine?.name ?? ""
		} else if (orderBy === "matchSource") {
			aVal = matchSourceLabel(a.matchSource)
			bVal = matchSourceLabel(b.matchSource)
		} else if (orderBy === "technologyElement") {
			aVal = (a.routine?.technologyElements ?? []).map((te) => te.name).join(", ")
			bVal = (b.routine?.technologyElements ?? []).map((te) => te.name).join(", ")
		} else if (orderBy === "frequency") {
			aVal = getFrequencyLabel(a.routine?.frequency)
			bVal = getFrequencyLabel(b.routine?.frequency)
		} else if (orderBy === "status") {
			const order = { overdue: "0", never: "1", ok: "2" }
			aVal = order[routineStatusKey(a) as keyof typeof order] ?? "9"
			bVal = order[routineStatusKey(b) as keyof typeof order] ?? "9"
		} else {
			aVal = ""
			bVal = ""
		}
		return aVal.localeCompare(bVal, "nb") * dir
	})

	return (
		<VStack gap="space-8">
			<Heading size="medium" level="3">
				Rutinestatus
			</Heading>
			{routineDeadlines.length === 0 ? (
				<BodyShort>Ingen rutiner er knyttet til denne applikasjonen.</BodyShort>
			) : (
				<VStack gap="space-4">
					<HStack gap="space-4" wrap align="end">
						<div style={{ flex: "1 1 200px", maxWidth: "300px" }}>
							<Search
								label="Søk i rutiner"
								size="small"
								value={routineSearch}
								onChange={setRoutineSearch}
								onClear={() => setRoutineSearch("")}
							/>
						</div>
					</HStack>

					<CheckboxGroup
						legend="Filtrer på status"
						size="small"
						value={routineStatusFilter}
						onChange={setRoutineStatusFilter}
						hideLegend
					>
						<HStack gap="space-4" wrap>
							<Checkbox value="ok">OK</Checkbox>
							<Checkbox value="overdue">Over frist</Checkbox>
							<Checkbox value="never">Ikke gjennomført</Checkbox>
						</HStack>
					</CheckboxGroup>

					{sortedRoutines.length === 0 ? (
						<BodyShort>Ingen rutiner matcher søket/filteret.</BodyShort>
					) : (
						// biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1
						<section className="table-scroll" aria-label="Rutinestatus" tabIndex={0}>
							<Table
								size="small"
								sort={routineSort}
								onSortChange={(sortKey) =>
									setRoutineSort((prev) =>
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
										<Table.ColumnHeader sortKey="matchSource" sortable>
											Kobling
										</Table.ColumnHeader>
										<Table.ColumnHeader sortKey="technologyElement" sortable>
											Teknologielement
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
									{sortedRoutines.map((dl, index) => (
										<Table.Row key={dl.routine?.id ?? `${dl.matchSource}-${String(dl.deadline)}-${index}`}>
											<Table.DataCell>
												{dl.routine?.sectionId && sectionSlugMap[dl.routine.sectionId] ? (
													<Link to={`/seksjoner/${sectionSlugMap[dl.routine.sectionId]}/rutiner/${dl.routine.id}`}>
														{dl.routine?.name ?? "—"}
													</Link>
												) : (
													(dl.routine?.name ?? "—")
												)}
											</Table.DataCell>
											<Table.DataCell>
												{dl.matchSource === "persistence" ? (
													<HStack gap="space-4" wrap>
														{(dl.matchedPersistenceLinks ?? []).map((pl) => (
															<HStack key={`${pl.persistenceType}-${pl.dataClassification}`} gap="space-2" wrap>
																{pl.persistenceType && (
																	<Tag variant="info" size="xsmall">
																		{persistenceLabels[pl.persistenceType] ?? pl.persistenceType}
																	</Tag>
																)}
																{pl.dataClassification && (
																	<Tag variant="warning" size="xsmall">
																		{dataClassificationLabels[pl.dataClassification as DataClassification] ??
																			pl.dataClassification}
																	</Tag>
																)}
															</HStack>
														))}
													</HStack>
												) : dl.matchSource === "screening_selection" ? (
													<Tag variant="alt1" size="xsmall">
														Valgt via spørsmål
													</Tag>
												) : dl.matchSource === "section" ? (
													<Tag variant="alt3" size="xsmall">
														Gjelder alle i seksjonen
													</Tag>
												) : dl.matchSource === "ruleset" ? (
													<Tag variant="alt2" size="xsmall">
														Regelsett
													</Tag>
												) : dl.matchSource === "group_classification" ? (
													<Tag variant="info" size="xsmall">
														Tilgangsklassifisering
													</Tag>
												) : dl.matchSource === "oracle_role_criticality" ? (
													<Tag variant="warning" size="xsmall">
														Oracle-roller
													</Tag>
												) : (
													<Tag variant="neutral" size="xsmall">
														Screening
													</Tag>
												)}
											</Table.DataCell>
											<Table.DataCell>
												{dl.routine?.technologyElements && dl.routine.technologyElements.length > 0 && (
													<HStack gap="space-2" wrap>
														{dl.routine.technologyElements.map((te) => (
															<Tag key={te.id} variant="info" size="xsmall">
																{te.name}
															</Tag>
														))}
													</HStack>
												)}
											</Table.DataCell>
											<Table.DataCell>{getFrequencyLabel(dl.routine?.frequency)}</Table.DataCell>
											<Table.DataCell>
												{dl.lastReviewDate ? new Date(dl.lastReviewDate).toLocaleDateString("nb-NO") : "Aldri"}
											</Table.DataCell>
											<Table.DataCell>{new Date(dl.deadline).toLocaleDateString("nb-NO")}</Table.DataCell>
											<Table.DataCell>
												{dl.overdue ? (
													<Tag variant="error" size="small">
														Over frist
													</Tag>
												) : dl.lastReviewDate ? (
													<Tag variant="success" size="small">
														OK
													</Tag>
												) : (
													<Tag variant="warning" size="small">
														Ikke gjennomført
													</Tag>
												)}
											</Table.DataCell>
											<Table.DataCell>
												{dl.routine?.sectionId && sectionSlugMap[dl.routine.sectionId] && (
													<form method="post" style={{ display: "inline" }}>
														<input type="hidden" name="intent" value="create-draft" />
														<input type="hidden" name="routineId" value={dl.routine.id} />
														<input type="hidden" name="sectionSlug" value={sectionSlugMap[dl.routine.sectionId]} />
														<Button type="submit" variant="tertiary" size="xsmall">
															Ny gjennomgang
														</Button>
													</form>
												)}
											</Table.DataCell>
										</Table.Row>
									))}
								</Table.Body>
							</Table>
						</section>
					)}
				</VStack>
			)}

			{completedReviews.length > 0 && (
				<>
					<Heading size="medium" level="3">
						Gjennomførte gjennomganger
					</Heading>
					<Table size="small">
						<Table.Header>
							<Table.Row>
								<Table.HeaderCell>Dato</Table.HeaderCell>
								<Table.HeaderCell>Rutine</Table.HeaderCell>
								<Table.HeaderCell>Tittel</Table.HeaderCell>
								<Table.HeaderCell>Status</Table.HeaderCell>
								<Table.HeaderCell>Opprettet av</Table.HeaderCell>
								<Table.HeaderCell>Deltakere</Table.HeaderCell>
								<Table.HeaderCell />
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{completedReviews.map((review) => {
								const confirmed = review.participants.filter((p) => p.confirmedAt).length
								const slug = review.sectionId ? sectionSlugMap[review.sectionId] : null
								return (
									<Table.Row key={review.id}>
										<Table.DataCell>{new Date(review.reviewedAt).toLocaleDateString("nb-NO")}</Table.DataCell>
										<Table.DataCell>{review.routineName}</Table.DataCell>
										<Table.DataCell>
											{slug ? (
												<Link to={`/seksjoner/${slug}/rutiner/${review.routineId}/gjennomgang/${review.id}`}>
													{review.title}
												</Link>
											) : (
												review.title
											)}
										</Table.DataCell>
										<Table.DataCell>
											{review.status === "completed" ? (
												<Tag variant="success" size="xsmall">
													Fullført
												</Tag>
											) : (
												<Tag variant="warning" size="xsmall">
													Utkast
												</Tag>
											)}
										</Table.DataCell>
										<Table.DataCell>{review.createdBy}</Table.DataCell>
										<Table.DataCell>
											{review.participants.length} ({confirmed} bekreftet)
										</Table.DataCell>
										<Table.DataCell>
											{review.status === "draft" && (
												<form method="post" style={{ display: "inline" }}>
													<input type="hidden" name="intent" value="discard-review" />
													<input type="hidden" name="reviewId" value={review.id} />
													<Button type="submit" variant="tertiary-neutral" size="xsmall">
														Forkast
													</Button>
												</form>
											)}
										</Table.DataCell>
									</Table.Row>
								)
							})}
						</Table.Body>
					</Table>
				</>
			)}
		</VStack>
	)
}
