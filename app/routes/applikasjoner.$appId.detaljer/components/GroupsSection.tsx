import { ExclamationmarkTriangleIcon, TrashIcon } from "@navikt/aksel-icons"
import {
	BodyShort,
	Box,
	Button,
	CopyButton,
	Detail,
	Heading,
	HStack,
	Search,
	Select,
	Table,
	Tag,
	VStack,
} from "@navikt/ds-react"
import { type ChangeEvent, useCallback, useEffect, useRef, useState } from "react"
import { useFetcher } from "react-router"
import { type GroupCriticality, groupCriticalityEnum, groupCriticalityLabels } from "~/db/schema/applications"
import { criticalityTagColor, criticalityTagVariant, type UnifiedGroup } from "../shared"

export function GroupsSection({
	naisGroupIds,
	manualGroups,
	ghostGroupIds,
	groupNames,
	assessmentsByGroupId,
	authIntegrations,
	canAdmin,
}: {
	naisGroupIds: string[]
	manualGroups: Array<{ id: string; groupId: string; groupName: string | null; createdBy: string; createdAt: string }>
	ghostGroupIds: string[]
	groupNames: Record<string, string>
	assessmentsByGroupId: Record<string, { criticality: string; updatedBy: string; updatedAt: string }>
	authIntegrations: Array<{ type: string; allowAllUsers: boolean | null; groups: string | null }>
	canAdmin: boolean
}) {
	const addFetcher = useFetcher()
	const removeFetcher = useFetcher()
	const criticalityFetcher = useFetcher()
	const searchFetcher = useFetcher<{ results: Array<{ id: string; displayName: string }> }>()
	const [searchQuery, setSearchQuery] = useState("")
	const [showResults, setShowResults] = useState(false)
	const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

	const searchResults = searchFetcher.data?.results ?? []
	const isSearching = searchFetcher.state === "loading"

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

	useEffect(() => {
		return () => {
			if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
		}
	}, [])

	const handleAddGroup = useCallback(
		(groupId: string, displayName: string) => {
			addFetcher.submit({ intent: "add-manual-group", groupId, groupName: displayName }, { method: "POST" })
			setSearchQuery("")
			setShowResults(false)
		},
		[addFetcher],
	)

	const naisGroupIdSet = new Set(naisGroupIds)
	const allExistingGroupIds = new Set([...naisGroupIds, ...manualGroups.map((g) => g.groupId)])

	const unifiedGroups: UnifiedGroup[] = []
	for (const gid of naisGroupIds) {
		unifiedGroups.push({ groupId: gid, source: "nais" })
	}
	for (const mg of manualGroups) {
		if (!naisGroupIdSet.has(mg.groupId)) {
			unifiedGroups.push({ groupId: mg.groupId, source: "manual", manualGroupDbId: mg.id, createdBy: mg.createdBy })
		}
	}
	for (const gid of ghostGroupIds) {
		unifiedGroups.push({ groupId: gid, source: "removed" })
	}

	const totalGroupCount = unifiedGroups.length

	const entraAuth = authIntegrations.find((a) => a.type === "entra_id")
	const hasAllUsers = entraAuth?.allowAllUsers ?? false

	return (
		<VStack gap="space-4">
			<VStack gap="space-2">
				<Heading size="xsmall" level="4">
					Entra ID-grupper ({totalGroupCount})
				</Heading>
				<BodyShort size="small" textColor="subtle">
					{hasAllUsers
						? "Alle brukere får utstedt token uavhengig av gruppemedlemskap."
						: naisGroupIds.length > 0
							? "Bruker må være medlem av minst én av gruppene for å få utstedt token. Applikasjonen kan ha ytterligere tilgangskontroll som avgrenser tilgang."
							: "Ingen grupper er konfigurert i Nais-manifestet."}
				</BodyShort>
			</VStack>

			{canAdmin && (
				<Box
					padding="space-4"
					borderRadius="8"
					borderWidth="1"
					borderColor="neutral-subtle"
					style={{ position: "relative" }}
				>
					<VStack gap="space-2">
						<Search
							label="Legg til gruppe (søk på navn eller Object-ID)"
							size="small"
							value={searchQuery}
							onChange={handleSearch}
							onClear={() => {
								setSearchQuery("")
								setShowResults(false)
							}}
						/>

						{showResults && (
							<Box
								padding="space-2"
								borderRadius="8"
								borderWidth="1"
								borderColor="neutral-subtle"
								shadow="dialog"
								style={{
									position: "absolute",
									top: "100%",
									left: 0,
									right: 0,
									zIndex: 10,
									marginTop: "4px",
									backgroundColor: "var(--ax-bg-default)",
								}}
							>
								{isSearching ? (
									<BodyShort size="small" textColor="subtle" style={{ padding: "var(--ax-space-4)" }}>
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
													style={{
														justifyContent: "flex-start",
														width: "100%",
														textAlign: "left",
													}}
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
									<BodyShort size="small" textColor="subtle" style={{ padding: "var(--ax-space-4)" }}>
										Ingen grupper funnet
									</BodyShort>
								)}
							</Box>
						)}
					</VStack>
				</Box>
			)}

			{unifiedGroups.length > 0 && (
				// biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1
				<section className="table-scroll" tabIndex={0} aria-label="Tilgangsgrupper">
					<Table size="small">
						<Table.Header>
							<Table.Row>
								<Table.HeaderCell scope="col">Gruppe</Table.HeaderCell>
								<Table.HeaderCell scope="col">Kilde</Table.HeaderCell>
								<Table.HeaderCell scope="col">Kritikalitet</Table.HeaderCell>
								{canAdmin && (
									<Table.HeaderCell scope="col" style={{ width: "1px" }}>
										<span className="navds-sr-only">Handlinger</span>
									</Table.HeaderCell>
								)}
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{unifiedGroups.map((ug) => {
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
											{canAdmin ? (
												<criticalityFetcher.Form method="post">
													<input type="hidden" name="intent" value="set-group-criticality" />
													<input type="hidden" name="groupId" value={ug.groupId} />
													<Select
														label="Kritikalitet"
														hideLabel
														size="small"
														value={assessment?.criticality ?? ""}
														onChange={(e: ChangeEvent<HTMLSelectElement>) => {
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
														{groupCriticalityEnum.map((c) => (
															<option key={c} value={c}>
																{groupCriticalityLabels[c]}
															</option>
														))}
													</Select>
												</criticalityFetcher.Form>
											) : assessment ? (
												<Tag
													variant={criticalityTagVariant[assessment.criticality] ?? "neutral"}
													size="xsmall"
													style={
														assessment.criticality === "high"
															? { backgroundColor: criticalityTagColor.high, borderColor: criticalityTagColor.high }
															: undefined
													}
												>
													{groupCriticalityLabels[assessment.criticality as GroupCriticality] ?? assessment.criticality}
												</Tag>
											) : (
												<BodyShort size="small" textColor="subtle">
													Ikke vurdert
												</BodyShort>
											)}
										</Table.DataCell>
										{canAdmin && (
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
										)}
									</Table.Row>
								)
							})}
						</Table.Body>
					</Table>
				</section>
			)}
		</VStack>
	)
}
