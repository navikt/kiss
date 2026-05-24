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
import type { EntraCriticality } from "~/lib/entra-staged-data"
import type { ActivityProp } from "../shared"
import { formatDateTime } from "../utils"

const groupCriticalityLabels: Record<EntraCriticality, string> = {
	low: "Lav",
	medium: "Middels",
	high: "Høy",
	very_high: "Svært høy",
}
const groupCriticalityOptions: EntraCriticality[] = ["low", "medium", "high", "very_high"]

const entraChangeTypeLabels: Record<string, string> = {
	added: "Lagt til",
	removed: "Fjernet",
	criticality_changed: "Kritikalitet endret",
}

export type EntraStagedGroupsProp = {
	groups: Array<{
		groupId: string
		groupName: string | null
		source: "nais_auth" | "manual" | "ghost"
		hasNaisSource: boolean
		hasManualSource: boolean
		isGone: boolean
		isNewAssessment: boolean
		isAddedDuringReview: boolean
		criticality: EntraCriticality | null
	}>
}

export function EntraMaintenanceSection({
	activity,
	entraGroupsData,
	isDraft,
}: {
	activity: ActivityProp
	entraGroupsData: EntraStagedGroupsProp
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

	const { groups } = entraGroupsData
	const searchResults = searchFetcher.data?.results ?? []
	const isSearching = searchFetcher.state === "loading"

	const activeGroupIds = useMemo(
		() =>
			new Set(
				groups
					.filter((group) => !group.isGone && (group.hasNaisSource || group.hasManualSource))
					.map((group) => group.groupId),
			),
		[groups],
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
			if (activeGroupIds.has(groupId)) return
			addFetcher.submit({ intent: "add-manual-group", groupId, groupName: displayName }, { method: "POST" })
			setSearchQuery("")
			setShowResults(false)
			setDialogOpen(false)
		},
		[activeGroupIds, addFetcher],
	)

	const sortedGroups = useMemo(() => {
		const dir = sort.direction === "ascending" ? 1 : -1
		return [...groups].sort((a, b) => {
			const nameA = a.groupName ?? ""
			const nameB = b.groupName ?? ""
			switch (sort.orderBy) {
				case "name":
					return dir * nameA.localeCompare(nameB, "nb")
				case "source":
					return dir * a.source.localeCompare(b.source)
				case "criticality":
					return dir * (a.criticality ?? "").localeCompare(b.criticality ?? "", "nb")
				default:
					return 0
			}
		})
	}, [groups, sort])

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

			{sortedGroups.length > 0 ? (
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
							{sortedGroups.map((group) => {
								const canRemove =
									!group.isGone &&
									(group.source === "manual" ||
										group.source === "ghost" ||
										(group.source === "nais_auth" && group.hasManualSource))

								return (
									<Table.Row
										key={group.groupId}
										style={group.isGone ? { backgroundColor: "var(--ax-bg-danger-soft)" } : undefined}
									>
										<Table.DataCell>
											<VStack gap="space-1">
												{group.groupName ?? (
													<BodyShort size="small" textColor="subtle">
														Ukjent
													</BodyShort>
												)}
												<HStack gap="space-1" align="center">
													<Detail textColor="subtle" style={{ fontFamily: "monospace" }}>
														{group.groupId}
													</Detail>
													<CopyButton copyText={group.groupId} size="xsmall" />
												</HStack>
											</VStack>
										</Table.DataCell>
										<Table.DataCell>
											<HStack gap="space-2" wrap>
												{group.hasNaisSource && (
													<Tag variant="info" size="xsmall">
														Nais
													</Tag>
												)}
												{group.hasManualSource && (
													<Tag variant="neutral" size="xsmall">
														Manuell
													</Tag>
												)}
												{group.source === "ghost" && (
													<Tag variant="error" size="xsmall">
														Fjernet
													</Tag>
												)}
												{group.isGone && (
													<Tag variant="error" size="xsmall">
														Fjernet i gjennomgang
													</Tag>
												)}
											</HStack>
										</Table.DataCell>
										<Table.DataCell>
											{group.isGone ? (
												<BodyShort size="small" style={{ color: "var(--ax-text-danger)" }}>
													Fjernet i gjennomgangen
												</BodyShort>
											) : isDraft && isPending ? (
												<criticalityFetcher.Form method="post">
													<input type="hidden" name="intent" value="set-group-criticality" />
													<input type="hidden" name="groupId" value={group.groupId} />
													<Select
														label="Kritikalitet"
														hideLabel
														size="small"
														value={group.criticality ?? ""}
														onChange={(event) => {
															criticalityFetcher.submit(
																{
																	intent: "set-group-criticality",
																	groupId: group.groupId,
																	criticality: event.target.value,
																},
																{ method: "POST" },
															)
														}}
														style={{ minWidth: "120px" }}
													>
														<option value="" disabled>
															Velg…
														</option>
														{groupCriticalityOptions.map((criticality) => (
															<option key={criticality} value={criticality}>
																{groupCriticalityLabels[criticality]}
															</option>
														))}
													</Select>
												</criticalityFetcher.Form>
											) : (
												<BodyShort size="small">
													{group.criticality ? (groupCriticalityLabels[group.criticality] ?? group.criticality) : "—"}
												</BodyShort>
											)}
										</Table.DataCell>
										{isDraft && isPending && (
											<Table.DataCell>
												{canRemove && (
													<removeFetcher.Form method="post">
														<input type="hidden" name="intent" value="remove-manual-group" />
														<input type="hidden" name="groupId" value={group.groupId} />
														<input type="hidden" name="groupName" value={group.groupName ?? ""} />
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
													const alreadyAdded = activeGroupIds.has(result.id)
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
								{activity.changes.map((change) => (
									<Table.Row key={change.id}>
										<Table.DataCell>{formatDateTime(change.performedAt)}</Table.DataCell>
										<Table.DataCell>
											<Tag
												variant={
													change.changeType === "added" ? "success" : change.changeType === "removed" ? "error" : "info"
												}
												size="xsmall"
											>
												{entraChangeTypeLabels[change.changeType] ?? change.changeType}
											</Tag>
										</Table.DataCell>
										<Table.DataCell>
											<VStack gap="space-1">
												{change.groupName && <BodyShort size="small">{change.groupName}</BodyShort>}
												<Detail textColor="subtle" style={{ fontFamily: "monospace" }}>
													{change.groupId}
												</Detail>
											</VStack>
										</Table.DataCell>
										<Table.DataCell>
											{change.changeType === "criticality_changed" && (
												<BodyShort size="small">
													{change.previousValue
														? (groupCriticalityLabels[change.previousValue as EntraCriticality] ?? change.previousValue)
														: "Ingen"}{" "}
													→{" "}
													{change.newValue
														? (groupCriticalityLabels[change.newValue as EntraCriticality] ?? change.newValue)
														: "Ingen"}
												</BodyShort>
											)}
										</Table.DataCell>
										<Table.DataCell>{change.performedBy}</Table.DataCell>
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
