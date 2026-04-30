import { ExclamationmarkTriangleIcon, PlusIcon, TrashIcon } from "@navikt/aksel-icons"
import type { SortState } from "@navikt/ds-react"
import {
	BodyShort,
	Box,
	Button,
	CopyButton,
	Detail,
	Dialog,
	ErrorSummary,
	Heading,
	HStack,
	Search,
	Select,
	Table,
	Tag,
	VStack,
} from "@navikt/ds-react"
import { type ChangeEvent, type FormEvent, useCallback, useMemo, useRef, useState } from "react"
import { Form, useFetcher } from "react-router"
import { groupCriticalityEnum, groupCriticalityLabels } from "~/db/schema/applications"
import type { EntraGroupsData } from "../shared"
import styles from "./wizard.module.css"

type UnifiedGroup = {
	groupId: string
	source: "nais" | "manual" | "removed"
	manualGroupDbId?: string
	createdBy?: string
}

export function EntraGroupsSection({
	entraGroupsData,
	questionId,
	confirmed,
}: {
	entraGroupsData: EntraGroupsData
	questionId: string
	confirmed: boolean
}) {
	const addFetcher = useFetcher()
	const removeFetcher = useFetcher()
	const criticalityFetcher = useFetcher()
	const searchFetcher = useFetcher<{ results: Array<{ id: string; displayName: string }> }>()
	const [searchQuery, setSearchQuery] = useState("")
	const [showResults, setShowResults] = useState(false)
	const [dialogOpen, setDialogOpen] = useState(false)
	const [sort, setSort] = useState<SortState>({ orderBy: "name", direction: "ascending" })
	const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const searchInputRef = useRef<HTMLInputElement>(null)

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

	const unifiedGroups = useMemo(() => {
		const groups: UnifiedGroup[] = []
		for (const gid of naisGroupIds) {
			groups.push({ groupId: gid, source: "nais" })
		}
		for (const mg of manualGroups) {
			if (!naisGroupIdSet.has(mg.groupId)) {
				groups.push({ groupId: mg.groupId, source: "manual", manualGroupDbId: mg.id, createdBy: mg.createdBy })
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
			const nameA = groupNames[a.groupId] ?? manualGroups.find((mg) => mg.groupId === a.groupId)?.groupName ?? ""
			const nameB = groupNames[b.groupId] ?? manualGroups.find((mg) => mg.groupId === b.groupId)?.groupName ?? ""
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
	}, [unifiedGroups, sort, groupNames, manualGroups, assessmentsByGroupId])

	const handleSort = (sortKey: string) => {
		setSort((prev) =>
			prev.orderBy === sortKey
				? { orderBy: sortKey, direction: prev.direction === "ascending" ? "descending" : "ascending" }
				: { orderBy: sortKey, direction: "ascending" },
		)
	}

	const allGroupsHaveCriticality =
		unifiedGroups.length > 0 && unifiedGroups.every((ug) => assessmentsByGroupId[ug.groupId]?.criticality)
	const [hasAttempted, setHasAttempted] = useState(false)
	const errorSummaryRef = useRef<HTMLDivElement>(null)

	const uncriticalGroups = unifiedGroups.filter((ug) => !assessmentsByGroupId[ug.groupId]?.criticality)
	const confirmErrors: Array<{ message: string; href: string }> = []
	if (hasAttempted && unifiedGroups.length === 0) {
		confirmErrors.push({ message: "Legg til minst én gruppe", href: "#add-group-btn" })
	}
	if (hasAttempted && uncriticalGroups.length > 0) {
		for (const ug of uncriticalGroups) {
			const name =
				groupNames[ug.groupId] ?? manualGroups.find((mg) => mg.groupId === ug.groupId)?.groupName ?? ug.groupId
			confirmErrors.push({ message: `Sett kritikalitet for ${name}`, href: `#criticality-${ug.groupId}` })
		}
	}

	function handleConfirmSubmit(e: FormEvent<HTMLFormElement>) {
		if (unifiedGroups.length === 0 || !allGroupsHaveCriticality) {
			e.preventDefault()
			setHasAttempted(true)
			setTimeout(() => errorSummaryRef.current?.focus(), 0)
		}
	}

	return (
		<VStack gap="space-6">
			<div className={styles.tableHeader}>
				<Heading size="xsmall" level="4">
					Entra ID-grupper
				</Heading>
				<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
					<Dialog.Trigger>
						<Button variant="tertiary" size="small" icon={<PlusIcon aria-hidden />} id="add-group-btn">
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
															onClick={() => {
																if (!alreadyAdded) handleAddGroup(result.id, result.displayName)
															}}
															aria-disabled={alreadyAdded || undefined}
														>
															<VStack>
																<BodyShort size="small" weight="semibold">
																	{result.displayName}
																	{alreadyAdded && " ✓"}
																</BodyShort>
																<Detail textColor="subtle">{alreadyAdded ? "Allerede lagt til" : result.id}</Detail>
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
			</div>

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
								<Table.HeaderCell scope="col" style={{ width: "1px" }}>
									<span className="navds-sr-only">Handlinger</span>
								</Table.HeaderCell>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{sortedGroups.map((ug) => {
								const assessment = assessmentsByGroupId[ug.groupId]
								const displayName =
									groupNames[ug.groupId] ?? manualGroups.find((mg) => mg.groupId === ug.groupId)?.groupName ?? null

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
													<ExclamationmarkTriangleIcon aria-hidden fontSize="1rem" /> Borte fra manifest
												</Tag>
											)}
										</Table.DataCell>
										<Table.DataCell>
											<criticalityFetcher.Form method="post">
												<input type="hidden" name="intent" value="set-group-criticality" />
												<input type="hidden" name="groupId" value={ug.groupId} />
												<Select
													label="Kritikalitet"
													hideLabel
													size="small"
													value={assessment?.criticality ?? ""}
													id={`criticality-${ug.groupId}`}
													onChange={(e: ChangeEvent<HTMLSelectElement>) => {
														criticalityFetcher.submit(
															{
																intent: "set-group-criticality",
																groupId: ug.groupId,
																criticality: e.target.value,
															},
															{ method: "POST" },
														)
														if (hasAttempted) setHasAttempted(false)
													}}
													style={{ minWidth: "120px" }}
												>
													<option value="" disabled>
														Velg…
													</option>
													{groupCriticalityEnum.map((c) => (
														<option key={c} value={c}>
															{groupCriticalityLabels[c]}
														</option>
													))}
												</Select>
											</criticalityFetcher.Form>
										</Table.DataCell>
										<Table.DataCell>
											{ug.source === "manual" && ug.manualGroupDbId && (
												<removeFetcher.Form method="post">
													<input type="hidden" name="intent" value="remove-manual-group" />
													<input type="hidden" name="manualGroupId" value={ug.manualGroupDbId} />
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
									</Table.Row>
								)
							})}
						</Table.Body>
					</Table>
				</section>
			) : (
				<BodyShort size="small" textColor="subtle">
					Ingen Entra ID-grupper registrert ennå. Legg til med knappen over.
				</BodyShort>
			)}

			<Form method="post" onSubmit={handleConfirmSubmit}>
				<input type="hidden" name="intent" value="screening" />
				<input type="hidden" name="questionId" value={questionId} />
				<input type="hidden" name="answer" value="confirmed" />
				<VStack gap="space-4">
					{hasAttempted && confirmErrors.length > 0 && (
						<ErrorSummary ref={errorSummaryRef} heading="Kan ikke bekrefte ennå">
							{confirmErrors.map((err) => (
								<ErrorSummary.Item key={err.href} href={err.href}>
									{err.message}
								</ErrorSummary.Item>
							))}
						</ErrorSummary>
					)}
					<HStack gap="space-4" align="center" justify="end">
						{confirmed && (
							<Tag variant="success" size="xsmall">
								✓ Bekreftet
							</Tag>
						)}
						<Button type="submit" size="small" variant={confirmed ? "secondary-neutral" : "primary"}>
							{confirmed ? "✓ Bekreftet" : "Bekreft"}
						</Button>
					</HStack>
				</VStack>
			</Form>
		</VStack>
	)
}
