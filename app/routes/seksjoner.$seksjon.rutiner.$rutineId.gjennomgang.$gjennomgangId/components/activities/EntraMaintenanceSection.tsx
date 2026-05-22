import { PlusIcon, TrashIcon } from "@navikt/aksel-icons"
import {
	BodyShort,
	Box,
	Button,
	CopyButton,
	Detail,
	Dialog,
	Heading,
	HStack,
	Search,
	Select,
	type SortState,
	Table,
	Tag,
	VStack,
} from "@navikt/ds-react"
import { useCallback, useMemo, useRef, useState } from "react"
import { useFetcher } from "react-router"
import type { ActivityProp } from "../shared"
import { formatDateTime } from "../utils"

const groupCriticalityLabels: Record<string, string> = {
	low: "Lav",
	medium: "Middels",
	high: "Høy",
	very_high: "Svært høy",
}
const groupCriticalityOptions = ["low", "medium", "high", "very_high"] as const

const entraChangeTypeLabels: Record<string, string> = {
	added: "Lagt til",
	removed: "Fjernet",
	criticality_changed: "Kritikalitet endret",
}

export type EntraGroupsDataProp = {
	naisGroupIds: string[]
	manualGroups: Array<{ id: string; groupId: string; groupName: string | null; createdBy: string; createdAt: string }>
	ghostGroupIds: string[]
	groupNames: Record<string, string>
	assessmentsByGroupId: Record<string, { criticality: string; updatedBy: string; updatedAt: string }>
}

export function EntraMaintenanceSection({
	activity,
	entraGroupsData,
	isDraft,
}: {
	activity: ActivityProp
	entraGroupsData: EntraGroupsDataProp
	isDraft: boolean
}) {
	const addFetcher = useFetcher()
	const removeFetcher = useFetcher()
	const criticalityFetcher = useFetcher()
	const searchFetcher = useFetcher<{ results: Array<{ id: string; displayName: string }> }>()
	const [searchQuery, setSearchQuery] = useState("")
	const [showResults, setShowResults] = useState(false)
	const [dialogOpen, setDialogOpen] = useState(false)
	const [sort, setSort] = useState<SortState>({ orderBy: "name", direction: "ascending" })
	const searchInputRef = useRef<HTMLInputElement>(null)
	const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

	const { naisGroupIds, manualGroups, ghostGroupIds, groupNames, assessmentsByGroupId } = entraGroupsData
	const searchResults = searchFetcher.data?.results ?? []
	const isSearching = searchFetcher.state === "loading"

	const naisGroupIdSet = useMemo(() => new Set(naisGroupIds), [naisGroupIds])
	const allExistingGroupIds = useMemo(
		() => new Set([...naisGroupIds, ...manualGroups.map((g) => g.groupId)]),
		[naisGroupIds, manualGroups],
	)

	const handleSearch = useCallback(
		(value: string) => {
			setSearchQuery(value)
			if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
			if (value.trim().length < 2) {
				setShowResults(false)
				return
			}
			searchTimeoutRef.current = setTimeout(() => {
				searchFetcher.load(`/api/graph/groups?q=${encodeURIComponent(value.trim())}`)
				setShowResults(true)
			}, 300)
		},
		[searchFetcher],
	)

	const handleAddGroup = useCallback(
		(groupId: string, displayName: string) => {
			if (allExistingGroupIds.has(groupId)) return
			addFetcher.submit({ intent: "add-manual-group", groupId, groupName: displayName }, { method: "POST" })
			setSearchQuery("")
			setShowResults(false)
			setDialogOpen(false)
		},
		[addFetcher, allExistingGroupIds],
	)

	type UnifiedGroup = {
		groupId: string
		source: "nais" | "manual" | "removed"
		manualGroupDbId?: string
	}

	const unifiedGroups = useMemo(() => {
		const groups: UnifiedGroup[] = []
		for (const gid of naisGroupIds) {
			groups.push({ groupId: gid, source: "nais" })
		}
		for (const mg of manualGroups) {
			if (!naisGroupIdSet.has(mg.groupId)) {
				groups.push({ groupId: mg.groupId, source: "manual", manualGroupDbId: mg.id })
			}
		}
		for (const gid of ghostGroupIds) {
			groups.push({ groupId: gid, source: "removed" })
		}
		return groups
	}, [naisGroupIds, manualGroups, ghostGroupIds, naisGroupIdSet])

	const sortedGroups = useMemo(() => {
		const dir = sort.direction === "ascending" ? 1 : -1
		return [...unifiedGroups].sort((a, b) => {
			const nameA = groupNames[a.groupId] ?? ""
			const nameB = groupNames[b.groupId] ?? ""
			switch (sort.orderBy) {
				case "name":
					return dir * nameA.localeCompare(nameB, "nb")
				case "source":
					return dir * a.source.localeCompare(b.source)
				case "criticality": {
					const critA = assessmentsByGroupId[a.groupId]?.criticality ?? ""
					const critB = assessmentsByGroupId[b.groupId]?.criticality ?? ""
					return dir * critA.localeCompare(critB, "nb")
				}
				default:
					return 0
			}
		})
	}, [unifiedGroups, sort, groupNames, assessmentsByGroupId])

	const handleSort = (sortKey: string) => {
		setSort((prev) =>
			prev.orderBy === sortKey
				? { orderBy: sortKey, direction: prev.direction === "ascending" ? "descending" : "ascending" }
				: { orderBy: sortKey, direction: "ascending" },
		)
	}

	const isPending = activity.status === "pending"

	return (
		<VStack gap="space-6">
			<HStack gap="space-4" align="center">
				<Heading size="medium" level="3">
					Entra ID-gruppevedlikehold
				</Heading>
				{isPending ? (
					<Tag variant="warning" size="small">
						Pågår
					</Tag>
				) : (
					<Tag variant="success" size="small">
						Fullført
					</Tag>
				)}
			</HStack>

			{/* Groups table */}
			{unifiedGroups.length > 0 ? (
				/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */
				<section className="table-scroll" tabIndex={0} aria-label="Entra ID-grupper">
					<Table size="small" sort={sort} onSortChange={handleSort}>
						<Table.Header>
							<Table.Row>
								<Table.ColumnHeader sortKey="name" sortable scope="col">
									Gruppe
								</Table.ColumnHeader>
								<Table.ColumnHeader sortKey="source" sortable scope="col">
									Kilde
								</Table.ColumnHeader>
								<Table.ColumnHeader sortKey="criticality" sortable scope="col">
									Kritikalitet
								</Table.ColumnHeader>
								{isDraft && isPending && (
									<Table.HeaderCell scope="col" style={{ width: "1px" }}>
										<span className="navds-sr-only">Handlinger</span>
									</Table.HeaderCell>
								)}
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{sortedGroups.map((ug) => {
								const assessment = assessmentsByGroupId[ug.groupId]
								const displayName = groupNames[ug.groupId] ?? null

								return (
									<Table.Row key={`${ug.source}-${ug.groupId}`}>
										<Table.DataCell>
											<VStack gap="space-1">
												{displayName ?? (
													<BodyShort size="small" textColor="subtle">
														Ukjent
													</BodyShort>
												)}
												<HStack gap="space-1" align="center">
													<Detail textColor="subtle" style={{ fontFamily: "monospace" }}>
														{ug.groupId}
													</Detail>
													<CopyButton copyText={ug.groupId} size="xsmall" />
												</HStack>
											</VStack>
										</Table.DataCell>
										<Table.DataCell>
											{ug.source === "nais" && (
												<Tag variant="info" size="xsmall">
													Nais
												</Tag>
											)}
											{ug.source === "manual" && (
												<Tag variant="neutral" size="xsmall">
													Manuell
												</Tag>
											)}
											{ug.source === "removed" && (
												<Tag variant="error" size="xsmall">
													Fjernet
												</Tag>
											)}
										</Table.DataCell>
										<Table.DataCell>
											{isDraft && isPending ? (
												<criticalityFetcher.Form method="post">
													<input type="hidden" name="intent" value="set-group-criticality" />
													<input type="hidden" name="groupId" value={ug.groupId} />
													<Select
														label="Kritikalitet"
														hideLabel
														size="small"
														value={assessment?.criticality ?? ""}
														onChange={(e) => {
															criticalityFetcher.submit(
																{
																	intent: "set-group-criticality",
																	groupId: ug.groupId,
																	criticality: e.target.value,
																},
																{ method: "POST" },
															)
														}}
														style={{ minWidth: "120px" }}
													>
														<option value="" disabled>
															Velg…
														</option>
														{groupCriticalityOptions.map((c) => (
															<option key={c} value={c}>
																{groupCriticalityLabels[c]}
															</option>
														))}
													</Select>
												</criticalityFetcher.Form>
											) : (
												<BodyShort size="small">
													{assessment?.criticality
														? (groupCriticalityLabels[assessment.criticality] ?? assessment.criticality)
														: "—"}
												</BodyShort>
											)}
										</Table.DataCell>
										{isDraft && isPending && (
											<Table.DataCell>
												{ug.source === "manual" && ug.manualGroupDbId && (
													<removeFetcher.Form method="post">
														<input type="hidden" name="intent" value="remove-manual-group" />
														<input type="hidden" name="manualGroupId" value={ug.manualGroupDbId} />
														<input type="hidden" name="groupId" value={ug.groupId} />
														<input type="hidden" name="groupName" value={displayName ?? ""} />
														<Button
															type="submit"
															variant="tertiary-neutral"
															size="xsmall"
															icon={<TrashIcon aria-hidden />}
															loading={removeFetcher.state !== "idle"}
														>
															Fjern
														</Button>
													</removeFetcher.Form>
												)}
											</Table.DataCell>
										)}
									</Table.Row>
								)
							})}
						</Table.Body>
					</Table>
				</section>
			) : (
				<BodyShort size="small" textColor="subtle">
					Ingen Entra ID-grupper registrert.
				</BodyShort>
			)}

			{/* Add group button — only for pending activities in drafts */}
			{isDraft && isPending && (
				<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
					<Dialog.Trigger>
						<Button variant="secondary" size="small" icon={<PlusIcon aria-hidden />}>
							Legg til gruppe
						</Button>
					</Dialog.Trigger>
					<Dialog.Popup
						width="large"
						position="center"
						closeOnOutsideClick
						initialFocusTo={() => searchInputRef.current}
						aria-label="Legg til Entra ID-gruppe"
					>
						<Dialog.Header>Legg til Entra ID-gruppe</Dialog.Header>
						<Dialog.Body>
							<VStack gap="space-4">
								<Search
									ref={searchInputRef}
									label="Søk på gruppenavn eller Object-ID"
									size="small"
									value={searchQuery}
									onChange={handleSearch}
									onClear={() => {
										setSearchQuery("")
										setShowResults(false)
									}}
									autoComplete="off"
								/>
								{showResults && (
									<Box
										borderRadius="8"
										borderWidth="1"
										borderColor="neutral-subtle"
										style={{ maxHeight: "300px", overflowY: "auto" }}
									>
										{isSearching ? (
											<BodyShort size="small" textColor="subtle" style={{ padding: "var(--ax-space-8)" }}>
												Søker…
											</BodyShort>
										) : searchResults.length > 0 ? (
											<VStack>
												{searchResults.map((result) => {
													const alreadyAdded = allExistingGroupIds.has(result.id)
													return (
														<Button
															key={result.id}
															variant="tertiary-neutral"
															size="small"
															style={{ justifyContent: "flex-start", width: "100%", textAlign: "left" }}
															onClick={() => handleAddGroup(result.id, result.displayName)}
															disabled={alreadyAdded}
														>
															<VStack>
																<BodyShort size="small" weight="semibold">
																	{result.displayName}
																	{alreadyAdded && " (allerede lagt til)"}
																</BodyShort>
																<Detail textColor="subtle">{result.id}</Detail>
															</VStack>
														</Button>
													)
												})}
											</VStack>
										) : (
											<BodyShort size="small" textColor="subtle" style={{ padding: "var(--ax-space-8)" }}>
												Ingen grupper funnet
											</BodyShort>
										)}
									</Box>
								)}
							</VStack>
						</Dialog.Body>
					</Dialog.Popup>
				</Dialog>
			)}

			{/* Changes log */}
			{activity.changes.length > 0 && (
				<VStack gap="space-4">
					<Heading size="small" level="4">
						Endringslogg ({activity.changes.length})
					</Heading>
					{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */}
					<section className="table-scroll" tabIndex={0} aria-label="Endringslogg for Entra ID-grupper">
						<Table size="small">
							<Table.Header>
								<Table.Row>
									<Table.HeaderCell>Tidspunkt</Table.HeaderCell>
									<Table.HeaderCell>Handling</Table.HeaderCell>
									<Table.HeaderCell>Gruppe</Table.HeaderCell>
									<Table.HeaderCell>Detaljer</Table.HeaderCell>
									<Table.HeaderCell>Utført av</Table.HeaderCell>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{activity.changes.map((c) => (
									<Table.Row key={c.id}>
										<Table.DataCell>{formatDateTime(c.performedAt)}</Table.DataCell>
										<Table.DataCell>
											<Tag
												variant={c.changeType === "added" ? "success" : c.changeType === "removed" ? "error" : "info"}
												size="xsmall"
											>
												{entraChangeTypeLabels[c.changeType] ?? c.changeType}
											</Tag>
										</Table.DataCell>
										<Table.DataCell>
											<VStack gap="space-1">
												{c.groupName && <BodyShort size="small">{c.groupName}</BodyShort>}
												<Detail textColor="subtle" style={{ fontFamily: "monospace" }}>
													{c.groupId}
												</Detail>
											</VStack>
										</Table.DataCell>
										<Table.DataCell>
											{c.changeType === "criticality_changed" && (
												<BodyShort size="small">
													{c.previousValue ? (groupCriticalityLabels[c.previousValue] ?? c.previousValue) : "Ingen"} →{" "}
													{c.newValue ? (groupCriticalityLabels[c.newValue] ?? c.newValue) : "Ingen"}
												</BodyShort>
											)}
										</Table.DataCell>
										<Table.DataCell>{c.performedBy}</Table.DataCell>
									</Table.Row>
								))}
							</Table.Body>
						</Table>
					</section>
				</VStack>
			)}
		</VStack>
	)
}
