import { BodyShort, Heading, HStack, Search, Select, type SortState, Table, Tag, VStack } from "@navikt/ds-react"
import { type ChangeEvent, useEffect, useMemo, useState } from "react"
import { useFetcher } from "react-router"
import { type GroupCriticality, groupCriticalityEnum, groupCriticalityLabels } from "~/db/schema/applications"
import { criticalityTagColor, criticalityTagVariant } from "../shared"

export interface OracleRoleDisplay {
	instanceId: string
	instanceName: string
	roleName: string
	oracleMaintained: boolean | null
	common: boolean | null
	criticality: GroupCriticality | null
	updatedBy: string | null
	updatedAt: string | null
}

const criticalityOrder: Record<string, number> = { very_high: 0, high: 1, medium: 2, low: 3 }

type RoleType = "oracle" | "common" | "egendefinert"

function roleTypes(r: OracleRoleDisplay): RoleType[] {
	const types: RoleType[] = []
	if (r.oracleMaintained === true) types.push("oracle")
	if (r.common === true) types.push("common")
	if (r.oracleMaintained !== true && r.common !== true) types.push("egendefinert")
	return types
}

function CriticalitySelect({
	instanceId,
	roleName,
	currentValue,
}: {
	instanceId: string
	roleName: string
	currentValue: GroupCriticality | null
}) {
	const fetcher = useFetcher()
	const [value, setValue] = useState(currentValue ?? "")

	useEffect(() => {
		setValue(currentValue ?? "")
	}, [currentValue])

	return (
		<fetcher.Form method="post">
			<input type="hidden" name="intent" value="set-oracle-role-criticality" />
			<input type="hidden" name="instanceId" value={instanceId} />
			<input type="hidden" name="roleName" value={roleName} />
			<Select
				label="Kritikalitet"
				hideLabel
				size="small"
				value={value}
				onChange={(e: ChangeEvent<HTMLSelectElement>) => {
					setValue(e.target.value)
					fetcher.submit(
						{
							intent: "set-oracle-role-criticality",
							instanceId,
							roleName,
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
		</fetcher.Form>
	)
}

export function OracleRolesSection({ roles, canAdmin }: { roles: OracleRoleDisplay[]; canAdmin: boolean }) {
	const [search, setSearch] = useState("")
	const [instanceFilter, setInstanceFilter] = useState<string>("")
	const [typeFilter, setTypeFilter] = useState<"" | RoleType>("")
	const [criticalityFilter, setCriticalityFilter] = useState<"" | "unassessed" | GroupCriticality>("")
	const [sort, setSort] = useState<SortState>({ orderBy: "instans", direction: "ascending" })

	const instances = useMemo(() => {
		const m = new Map<string, string>()
		for (const r of roles) m.set(r.instanceId, r.instanceName)
		return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], "nb"))
	}, [roles])

	const filtered = useMemo(() => {
		const q = search.toLowerCase().trim()
		return roles.filter((r) => {
			if (instanceFilter && r.instanceId !== instanceFilter) return false
			if (typeFilter && !roleTypes(r).includes(typeFilter)) return false
			if (criticalityFilter === "unassessed" && r.criticality) return false
			if (criticalityFilter && criticalityFilter !== "unassessed" && r.criticality !== criticalityFilter) return false
			if (q && !r.roleName.toLowerCase().includes(q) && !r.instanceName.toLowerCase().includes(q)) return false
			return true
		})
	}, [roles, search, instanceFilter, typeFilter, criticalityFilter])

	const sorted = useMemo(() => {
		const dir = sort.direction === "ascending" ? 1 : -1
		return [...filtered].sort((a, b) => {
			switch (sort.orderBy) {
				case "instans":
					return (
						a.instanceName.localeCompare(b.instanceName, "nb") * dir || a.roleName.localeCompare(b.roleName, "nb") * dir
					)
				case "rolle":
					return a.roleName.localeCompare(b.roleName, "nb") * dir
				case "type": {
					const ta = roleTypes(a).slice().sort().join(",")
					const tb = roleTypes(b).slice().sort().join(",")
					return ta.localeCompare(tb, "nb") * dir
				}
				case "kritikalitet": {
					const ordA = a.criticality ? (criticalityOrder[a.criticality] ?? 99) : 99
					const ordB = b.criticality ? (criticalityOrder[b.criticality] ?? 99) : 99
					return (ordA - ordB) * dir
				}
				default:
					return 0
			}
		})
	}, [filtered, sort])

	const handleSort = (sortKey: string) => {
		setSort((prev) =>
			prev.orderBy === sortKey
				? { orderBy: sortKey, direction: prev.direction === "ascending" ? "descending" : "ascending" }
				: { orderBy: sortKey, direction: "ascending" },
		)
	}

	if (roles.length === 0) return null

	return (
		<VStack gap="space-8">
			<VStack gap="space-4">
				<Heading size="xsmall" level="4">
					{`Oracle Database-roller (${sorted.length}${sorted.length !== roles.length ? ` av ${roles.length}` : ""})`}
				</Heading>
				<BodyShort size="small" textColor="subtle">
					Roller som er egendefinerte eller brukt av Nav-ansatte. Vurder kritikaliteten til hver rolle.
				</BodyShort>
			</VStack>

			<HStack gap="space-8" wrap align="end">
				<Search
					label="Søk etter rolle eller instans"
					size="small"
					value={search}
					onChange={setSearch}
					onClear={() => setSearch("")}
					style={{ minWidth: "16rem" }}
				/>
				<Select label="Instans" size="small" value={instanceFilter} onChange={(e) => setInstanceFilter(e.target.value)}>
					<option value="">Alle instanser</option>
					{instances.map(([id, name]) => (
						<option key={id} value={id}>
							{name}
						</option>
					))}
				</Select>
				<Select
					label="Type"
					size="small"
					value={typeFilter}
					onChange={(e) => setTypeFilter(e.target.value as "" | RoleType)}
				>
					<option value="">Alle typer</option>
					<option value="oracle">Oracle</option>
					<option value="common">Common</option>
					<option value="egendefinert">Egendefinert</option>
				</Select>
				<Select
					label="Kritikalitet"
					size="small"
					value={criticalityFilter}
					onChange={(e) => setCriticalityFilter(e.target.value as "" | "unassessed" | GroupCriticality)}
				>
					<option value="">Alle</option>
					<option value="unassessed">Ikke vurdert</option>
					{groupCriticalityEnum.map((c) => (
						<option key={c} value={c}>
							{groupCriticalityLabels[c]}
						</option>
					))}
				</Select>
			</HStack>

			{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */}
			<section className="table-scroll" tabIndex={0} aria-label="Oracle Database-roller">
				<Table size="small" sort={sort} onSortChange={handleSort}>
					<Table.Header>
						<Table.Row>
							<Table.ColumnHeader sortKey="instans" sortable scope="col">
								Instans
							</Table.ColumnHeader>
							<Table.ColumnHeader sortKey="rolle" sortable scope="col">
								Rolle
							</Table.ColumnHeader>
							<Table.ColumnHeader sortKey="type" sortable scope="col">
								Type
							</Table.ColumnHeader>
							<Table.ColumnHeader sortKey="kritikalitet" sortable scope="col">
								Kritikalitet
							</Table.ColumnHeader>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{sorted.length === 0 ? (
							<Table.Row>
								<Table.DataCell colSpan={4}>
									<BodyShort size="small" textColor="subtle">
										Ingen roller matcher filteret.
									</BodyShort>
								</Table.DataCell>
							</Table.Row>
						) : (
							sorted.map((r) => (
								<Table.Row key={`${r.instanceId}:${r.roleName}`}>
									<Table.DataCell>
										<BodyShort size="small">{r.instanceName}</BodyShort>
									</Table.DataCell>
									<Table.DataCell>
										<BodyShort size="small" style={{ fontFamily: "monospace" }}>
											{r.roleName}
										</BodyShort>
									</Table.DataCell>
									<Table.DataCell>
										{r.oracleMaintained === true && (
											<Tag variant="info" size="xsmall" style={{ marginRight: "var(--ax-space-2)" }}>
												Oracle
											</Tag>
										)}
										{r.common === true && (
											<Tag variant="neutral" size="xsmall">
												Common
											</Tag>
										)}
										{r.oracleMaintained !== true && r.common !== true && (
											<BodyShort size="small" textColor="subtle">
												Egendefinert
											</BodyShort>
										)}
									</Table.DataCell>
									<Table.DataCell>
										{canAdmin ? (
											<CriticalitySelect instanceId={r.instanceId} roleName={r.roleName} currentValue={r.criticality} />
										) : r.criticality ? (
											<Tag
												variant={criticalityTagVariant[r.criticality] ?? "neutral"}
												size="xsmall"
												style={
													r.criticality === "high"
														? { backgroundColor: criticalityTagColor.high, borderColor: criticalityTagColor.high }
														: undefined
												}
											>
												{groupCriticalityLabels[r.criticality] ?? r.criticality}
											</Tag>
										) : (
											<BodyShort size="small" textColor="subtle">
												Ikke vurdert
											</BodyShort>
										)}
									</Table.DataCell>
								</Table.Row>
							))
						)}
					</Table.Body>
				</Table>
			</section>
		</VStack>
	)
}
