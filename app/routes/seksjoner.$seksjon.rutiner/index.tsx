import { CheckmarkCircleIcon, DownloadIcon, XMarkOctagonIcon } from "@navikt/aksel-icons"
import type { SortState } from "@navikt/ds-react"
import { BodyShort, Box, Button, Heading, HGrid, HStack, Search, Select, Table, Tag, VStack } from "@navikt/ds-react"
import { useMemo, useState } from "react"
import type { LoaderFunctionArgs } from "react-router"
import { data, Link, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getAllControls } from "~/db/queries/framework.server"
import { getRoutinesForSection } from "~/db/queries/routines.server"
import { getSectionBySlug } from "~/db/queries/sections.server"
import {
	type DataClassification,
	dataClassificationLabels,
	type PersistenceType,
	persistenceTypeLabels,
} from "~/db/schema/applications"
import { getAuthenticatedUser } from "~/lib/auth.server"
import { isAdmin } from "~/lib/authorization.server"
import { frequencyLabels, getFrequencyLabel, type RoutineFrequency } from "~/lib/routine-frequencies"

export async function loader({ request, params }: LoaderFunctionArgs) {
	const { seksjon } = params
	if (!seksjon) {
		throw data({ message: "Mangler seksjonsparameter" }, { status: 400 })
	}

	const user = await getAuthenticatedUser(request)

	const section = await getSectionBySlug(seksjon)
	if (!section) {
		throw data({ message: `Fant ikke seksjon: ${seksjon}` }, { status: 404 })
	}

	const [routines, allControls] = await Promise.all([getRoutinesForSection(section.id), getAllControls()])

	return data({
		section,
		routines,
		allControls,
		canAdmin: user ? isAdmin(user) : false,
	})
}

export default function SeksjonRutinerIndex() {
	const { section, routines, allControls, canAdmin } = useLoaderData<typeof loader>()

	const [searchQuery, setSearchQuery] = useState("")
	const [filterControl, setFilterControl] = useState("")
	const [filterFrequency, setFilterFrequency] = useState("")
	const [filterTechElement, setFilterTechElement] = useState("")
	const [filterPersistence, setFilterPersistence] = useState("")
	const [filterStatus, setFilterStatus] = useState("active")
	const [sort, setSort] = useState<SortState | undefined>({ orderBy: "name", direction: "ascending" })

	// Collect unique values for dropdown filters
	const uniqueControls = useMemo(() => {
		const set = new Map<string, string>()
		for (const r of routines) for (const c of r.controls) set.set(c.controlId, `${c.controlId} ${c.name}`)
		return [...set.entries()].sort((a, b) => a[0].localeCompare(b[0]))
	}, [routines])

	const uniqueFrequencies = useMemo(() => {
		const set = new Set<string>()
		for (const r of routines) if (r.frequency) set.add(r.frequency)
		return [...set].sort()
	}, [routines])

	const uniqueTechElements = useMemo(() => {
		const set = new Set<string>()
		for (const r of routines) for (const te of r.technologyElements) set.add(te.name)
		return [...set].sort()
	}, [routines])

	const uniquePersistenceTypes = useMemo(() => {
		const set = new Set<string>()
		for (const r of routines) for (const pl of r.persistenceLinks) if (pl.persistenceType) set.add(pl.persistenceType)
		return [...set].sort()
	}, [routines])

	// Filter
	const filtered = useMemo(() => {
		return routines.filter((r) => {
			if (searchQuery) {
				const q = searchQuery.toLowerCase()
				const nameMatch = r.name.toLowerCase().includes(q)
				const controlMatch = r.controls.some(
					(c) => c.controlId.toLowerCase().includes(q) || c.name.toLowerCase().includes(q),
				)
				if (!nameMatch && !controlMatch) return false
			}
			if (filterControl && !r.controls.some((c) => c.controlId === filterControl)) return false
			if (filterFrequency && r.frequency !== filterFrequency) return false
			if (filterTechElement && !r.technologyElements.some((te) => te.name === filterTechElement)) return false
			if (filterPersistence && !r.persistenceLinks.some((pl) => pl.persistenceType === filterPersistence)) return false
			if (filterStatus && r.status !== filterStatus) return false
			return true
		})
	}, [routines, searchQuery, filterControl, filterFrequency, filterTechElement, filterPersistence, filterStatus])

	// Sort
	const sorted = useMemo(() => {
		if (!sort) return filtered
		const dir = sort.direction === "ascending" ? 1 : -1
		return [...filtered].sort((a, b) => {
			switch (sort.orderBy) {
				case "name":
					return dir * a.name.localeCompare(b.name)
				case "frequency":
					return dir * (getFrequencyLabel(a.frequency) ?? "").localeCompare(getFrequencyLabel(b.frequency) ?? "")
				case "controls":
					return dir * (a.controls[0]?.controlId ?? "").localeCompare(b.controls[0]?.controlId ?? "")
				case "techElements":
					return dir * (a.technologyElements[0]?.name ?? "").localeCompare(b.technologyElements[0]?.name ?? "")
				case "persistence":
					return (
						dir *
						(a.persistenceLinks[0]?.persistenceType ?? "").localeCompare(b.persistenceLinks[0]?.persistenceType ?? "")
					)
				case "reviewCount":
					return dir * (a.reviewCount - b.reviewCount)
				default:
					return 0
			}
		})
	}, [filtered, sort])

	const handleSort = (sortKey: string) => {
		setSort((prev) =>
			prev && prev.orderBy === sortKey
				? { orderBy: sortKey, direction: prev.direction === "ascending" ? "descending" : "ascending" }
				: { orderBy: sortKey, direction: "ascending" },
		)
	}

	const hasActiveFilters =
		searchQuery ||
		filterControl ||
		filterFrequency ||
		filterTechElement ||
		filterPersistence ||
		filterStatus !== "active"

	return (
		<VStack gap="space-6">
			<HStack justify="space-between" align="center">
				<Heading size="large">Rutiner — {section.name}</Heading>
				<HStack gap="space-2">
					<Button
						as="a"
						href={`/api/seksjoner/${section.slug}/eksport?type=rutiner`}
						variant="tertiary"
						size="small"
						icon={<DownloadIcon aria-hidden />}
					>
						Eksporter
					</Button>
					<Button as={Link} to="./mangler" variant="secondary" size="small">
						Manglende
					</Button>
					<Button as={Link} to="./gjennomfort" variant="secondary" size="small">
						Gjennomførte
					</Button>
					{canAdmin && (
						<Button as={Link} to="./ny" variant="primary" size="small">
							Opprett ny rutine
						</Button>
					)}
				</HStack>
			</HStack>

			{routines.length === 0 ? (
				<Box padding="space-6" borderRadius="8" background="sunken">
					<BodyShort>Ingen rutiner er opprettet for denne seksjonen ennå.</BodyShort>
				</Box>
			) : (
				<VStack gap="space-4">
					{/* Filters */}
					<HStack gap="space-4" wrap align="end">
						<div style={{ flex: "1 1 14rem", minWidth: "14rem" }}>
							<Search
								label="Søk i rutiner"
								size="small"
								value={searchQuery}
								onChange={setSearchQuery}
								onClear={() => setSearchQuery("")}
							/>
						</div>
						<Select
							label="Krav"
							size="small"
							value={filterControl}
							onChange={(e) => setFilterControl(e.target.value)}
							style={{ minWidth: "10rem" }}
						>
							<option value="">Alle krav</option>
							{uniqueControls.map(([id, label]) => (
								<option key={id} value={id}>
									{label}
								</option>
							))}
						</Select>
						<Select
							label="Frekvens"
							size="small"
							value={filterFrequency}
							onChange={(e) => setFilterFrequency(e.target.value)}
						>
							<option value="">Alle frekvenser</option>
							{uniqueFrequencies.map((f) => (
								<option key={f} value={f}>
									{frequencyLabels[f as RoutineFrequency] ?? f}
								</option>
							))}
						</Select>
						{uniqueTechElements.length > 0 && (
							<Select
								label="Teknologielement"
								size="small"
								value={filterTechElement}
								onChange={(e) => setFilterTechElement(e.target.value)}
							>
								<option value="">Alle elementer</option>
								{uniqueTechElements.map((te) => (
									<option key={te} value={te}>
										{te}
									</option>
								))}
							</Select>
						)}
						{uniquePersistenceTypes.length > 0 && (
							<Select
								label="Databasekobling"
								size="small"
								value={filterPersistence}
								onChange={(e) => setFilterPersistence(e.target.value)}
							>
								<option value="">Alle typer</option>
								{uniquePersistenceTypes.map((pt) => (
									<option key={pt} value={pt}>
										{persistenceTypeLabels[pt as PersistenceType] ?? pt}
									</option>
								))}
							</Select>
						)}
						<Select label="Status" size="small" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
							<option value="">Alle statuser</option>
							<option value="active">Aktiv</option>
							<option value="draft">Utkast</option>
							<option value="archived">Arkivert</option>
						</Select>
					</HStack>

					{hasActiveFilters && (
						<BodyShort size="small" textColor="subtle">
							Viser {sorted.length} av {routines.length} rutiner
						</BodyShort>
					)}

					<Table sort={sort} onSortChange={handleSort}>
						<Table.Header>
							<Table.Row>
								<Table.ColumnHeader sortKey="name" sortable>
									Navn
								</Table.ColumnHeader>
								<Table.ColumnHeader sortKey="frequency" sortable>
									Frekvens
								</Table.ColumnHeader>
								<Table.ColumnHeader sortKey="controls" sortable>
									Krav
								</Table.ColumnHeader>
								<Table.ColumnHeader sortKey="techElements" sortable>
									Teknologielementer
								</Table.ColumnHeader>
								<Table.ColumnHeader sortKey="persistence" sortable>
									Databasekoblinger
								</Table.ColumnHeader>
								<Table.ColumnHeader sortKey="reviewCount" sortable>
									Gjennomganger
								</Table.ColumnHeader>
								<Table.HeaderCell />
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{sorted.map((routine) => (
								<Table.Row key={routine.id}>
									<Table.DataCell>
										<HStack gap="space-2" align="center" wrap>
											<Link to={`./${routine.id}`}>{routine.name}</Link>
											{routine.appliesToAllInSection === 1 && (
												<Tag variant="alt3" size="xsmall">
													Gjelder alle
												</Tag>
											)}
											{routine.status === "draft" && (
												<Tag variant="warning" size="xsmall">
													Utkast
												</Tag>
											)}
											{routine.status === "archived" && (
												<Tag variant="neutral" size="xsmall">
													Arkivert
												</Tag>
											)}
										</HStack>
									</Table.DataCell>
									<Table.DataCell>{getFrequencyLabel(routine.frequency)}</Table.DataCell>
									<Table.DataCell>
										<VStack gap="space-1">
											{routine.controls.map((c) => (
												<HStack key={c.id} gap="space-2" align="center" wrap>
													<Tag variant="alt1" size="xsmall">
														{c.controlId}
													</Tag>
													<BodyShort size="small">{c.name}</BodyShort>
												</HStack>
											))}
										</VStack>
									</Table.DataCell>
									<Table.DataCell>
										<HStack gap="space-1" wrap>
											{routine.technologyElements.map((te) => (
												<Tag key={te.id} variant="info" size="small">
													{te.name}
												</Tag>
											))}
										</HStack>
									</Table.DataCell>
									<Table.DataCell>
										<HStack gap="space-2" wrap>
											{routine.persistenceLinks.map((pl) => (
												<HStack key={pl.id} gap="space-1" wrap>
													{pl.persistenceType && (
														<Tag variant="info" size="xsmall">
															{persistenceTypeLabels[pl.persistenceType as PersistenceType] ?? pl.persistenceType}
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
									</Table.DataCell>
									<Table.DataCell>{routine.reviewCount}</Table.DataCell>
									<Table.DataCell>
										{canAdmin && (
											<Button as={Link} to={`./${routine.id}/rediger`} variant="tertiary" size="small">
												Rediger
											</Button>
										)}
									</Table.DataCell>
								</Table.Row>
							))}
						</Table.Body>
					</Table>
				</VStack>
			)}

			{/* Kravdekning */}
			<ControlCoverageSummary routines={routines} allControls={allControls} />
		</VStack>
	)
}

function ControlCoverageSummary({
	routines,
	allControls,
}: {
	routines: Array<{ controls: Array<{ id: string; controlId: string; name: string }> }>
	allControls: Array<{ controlId: string; name: string; technologyElements: string[] }>
}) {
	const coveredControlIds = new Set(routines.flatMap((r) => r.controls.map((c) => c.controlId)))

	// Collect all unique tech elements
	const techElementSet = new Set<string>()
	for (const c of allControls) {
		for (const te of c.technologyElements) techElementSet.add(te)
	}
	const techElements = [...techElementSet].sort()

	// Controls without tech elements
	const generalControls = allControls.filter((c) => c.technologyElements.length === 0)

	type GroupData = {
		label: string
		covered: typeof allControls
		uncovered: typeof allControls
	}

	const groups: GroupData[] = []

	// General controls group
	if (generalControls.length > 0) {
		groups.push({
			label: "Generelle krav",
			covered: generalControls.filter((c) => coveredControlIds.has(c.controlId)),
			uncovered: generalControls.filter((c) => !coveredControlIds.has(c.controlId)),
		})
	}

	// Per tech element groups
	for (const te of techElements) {
		const teControls = allControls.filter((c) => c.technologyElements.includes(te))
		groups.push({
			label: te,
			covered: teControls.filter((c) => coveredControlIds.has(c.controlId)),
			uncovered: teControls.filter((c) => !coveredControlIds.has(c.controlId)),
		})
	}

	const totalCovered = allControls.filter((c) => coveredControlIds.has(c.controlId)).length

	return (
		<VStack gap="space-4">
			<HStack gap="space-4" align="center">
				<Heading size="medium" level="3">
					Kravdekning
				</Heading>
				<Tag variant={totalCovered === allControls.length ? "success" : "neutral"} size="small">
					{totalCovered} av {allControls.length} krav dekket
				</Tag>
			</HStack>

			<VStack gap="space-6">
				{groups.map((group) => (
					<VStack key={group.label} gap="space-2">
						<HStack gap="space-4" align="center">
							<Heading size="small" level="4">
								{group.label}
							</Heading>
							<Tag variant={group.uncovered.length === 0 ? "success" : "neutral"} size="xsmall">
								{group.covered.length} av {group.covered.length + group.uncovered.length} dekket
							</Tag>
						</HStack>

						<HGrid columns={{ xs: 1, md: 2 }} gap="space-4">
							{group.uncovered.length > 0 && (
								<Box padding="space-4" borderRadius="8" borderWidth="1" borderColor="neutral-subtle">
									<VStack gap="space-2">
										<HStack gap="space-2" align="center">
											<XMarkOctagonIcon aria-hidden fontSize="1.25rem" color="var(--ax-text-danger)" />
											<Heading size="xsmall" level="5">
												Uten rutiner ({group.uncovered.length})
											</Heading>
										</HStack>
										<VStack gap="space-1">
											{group.uncovered.map((c) => (
												<HStack key={c.controlId} gap="space-2" align="center" wrap>
													<Tag variant="error" size="xsmall">
														{c.controlId}
													</Tag>
													<BodyShort size="small">{c.name}</BodyShort>
												</HStack>
											))}
										</VStack>
									</VStack>
								</Box>
							)}

							{group.covered.length > 0 && (
								<Box padding="space-4" borderRadius="8" borderWidth="1" borderColor="neutral-subtle">
									<VStack gap="space-2">
										<HStack gap="space-2" align="center">
											<CheckmarkCircleIcon aria-hidden fontSize="1.25rem" color="var(--ax-text-success)" />
											<Heading size="xsmall" level="5">
												Med rutiner ({group.covered.length})
											</Heading>
										</HStack>
										<VStack gap="space-1">
											{group.covered.map((c) => (
												<HStack key={c.controlId} gap="space-2" align="center" wrap>
													<Tag variant="success" size="xsmall">
														{c.controlId}
													</Tag>
													<BodyShort size="small">{c.name}</BodyShort>
												</HStack>
											))}
										</VStack>
									</VStack>
								</Box>
							)}
						</HGrid>
					</VStack>
				))}
			</VStack>
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
