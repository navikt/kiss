import type { SortState } from "@navikt/ds-react"
import { BodyShort, HStack, Select, Table, Tag, VStack } from "@navikt/ds-react"
import { type ChangeEvent, useEffect, useMemo, useState } from "react"
import { useFetcher } from "react-router"
import { type GroupCriticality, groupCriticalityEnum, groupCriticalityLabels } from "~/db/schema/applications"
import type { OracleRolesData } from "../shared"

const criticalityOrder: Record<string, number> = { very_high: 0, high: 1, medium: 2, low: 3 }

function CriticalitySelect({
	instanceId,
	roleName,
	currentValue,
	id,
}: {
	instanceId: string
	roleName: string
	currentValue: string
	id?: string
}) {
	const fetcher = useFetcher()
	const [value, setValue] = useState(currentValue)

	useEffect(() => {
		setValue(currentValue)
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
				id={id}
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

export function OracleRolesScreeningSection({
	oracleRolesData,
	canAdmin,
}: {
	oracleRolesData: OracleRolesData
	canAdmin: boolean
}) {
	const [sort, setSort] = useState<SortState>({ orderBy: "name", direction: "ascending" })

	const { roles, assessments } = oracleRolesData

	const sortedRoles = useMemo(() => {
		const dir = sort.direction === "ascending" ? 1 : -1
		return [...roles].sort((a, b) => {
			const keyA = `${a.instanceId}:${a.roleName.toUpperCase().trim()}`
			const keyB = `${b.instanceId}:${b.roleName.toUpperCase().trim()}`
			switch (sort.orderBy) {
				case "name":
					return dir * a.roleName.localeCompare(b.roleName, "nb")
				case "instance":
					return dir * a.instanceId.localeCompare(b.instanceId, "nb")
				case "criticality": {
					const critA = assessments[keyA]?.criticality ?? ""
					const critB = assessments[keyB]?.criticality ?? ""
					const ordA = critA ? (criticalityOrder[critA] ?? 99) : 99
					const ordB = critB ? (criticalityOrder[critB] ?? 99) : 99
					return dir * (ordA - ordB)
				}
				default:
					return 0
			}
		})
	}, [roles, sort, assessments])

	const handleSort = (sortKey: string) => {
		setSort((prev) =>
			prev.orderBy === sortKey
				? { orderBy: sortKey, direction: prev.direction === "ascending" ? "descending" : "ascending" }
				: { orderBy: sortKey, direction: "ascending" },
		)
	}

	return (
		<VStack gap="space-6">
			{roles.length > 0 ? (
				/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */
				<section className="table-scroll" tabIndex={0} aria-label="Oracle-roller">
					<Table size="small" sort={sort} onSortChange={handleSort}>
						<Table.Header>
							<Table.Row>
								<Table.ColumnHeader sortKey="name" sortable scope="col">
									Rolle
								</Table.ColumnHeader>
								<Table.ColumnHeader sortKey="instance" sortable scope="col">
									Instans
								</Table.ColumnHeader>
								<Table.HeaderCell scope="col">Type</Table.HeaderCell>
								<Table.ColumnHeader sortKey="criticality" sortable scope="col">
									Kritikalitet
								</Table.ColumnHeader>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{sortedRoles.map((role) => {
								const key = `${role.instanceId}:${role.roleName.toUpperCase().trim()}`
								const assessment = assessments[key]

								return (
									<Table.Row key={key}>
										<Table.DataCell>
											<BodyShort size="small" style={{ fontFamily: "monospace" }}>
												{role.roleName}
											</BodyShort>
										</Table.DataCell>
										<Table.DataCell>
											<BodyShort size="small" textColor="subtle">
												{role.instanceId}
											</BodyShort>
										</Table.DataCell>
										<Table.DataCell>
											<HStack gap="space-1">
												{role.common && (
													<Tag variant="neutral" size="xsmall">
														Common
													</Tag>
												)}
												{role.authType && (
													<Tag variant="info" size="xsmall">
														{role.authType}
													</Tag>
												)}
											</HStack>
										</Table.DataCell>
										<Table.DataCell>
											{canAdmin ? (
												<CriticalitySelect
													instanceId={role.instanceId}
													roleName={role.roleName}
													currentValue={assessment?.criticality ?? ""}
													id={`criticality-${key}`}
												/>
											) : assessment?.criticality ? (
												<Tag variant="neutral" size="xsmall">
													{groupCriticalityLabels[assessment.criticality as GroupCriticality] ?? assessment.criticality}
												</Tag>
											) : (
												<BodyShort size="small" textColor="subtle">
													Ikke vurdert
												</BodyShort>
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
					Ingen Oracle-roller funnet for denne applikasjonen.
				</BodyShort>
			)}
		</VStack>
	)
}
