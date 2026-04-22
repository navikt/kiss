import { BodyShort, Heading, Select, Table, Tag, VStack } from "@navikt/ds-react"
import { type ChangeEvent, useEffect, useState } from "react"
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
	if (roles.length === 0) return null

	return (
		<VStack gap="space-4">
			<Heading size="xsmall" level="4">
				Oracle Database-roller ({roles.length})
			</Heading>
			<BodyShort size="small" textColor="subtle">
				Roller som er definert i Oracle-databasene som applikasjonen bruker. Vurder kritikaliteten til hver rolle.
			</BodyShort>

			{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */}
			<section className="table-scroll" tabIndex={0} aria-label="Oracle Database-roller">
				<Table size="small">
					<Table.Header>
						<Table.Row>
							<Table.HeaderCell scope="col">Instans</Table.HeaderCell>
							<Table.HeaderCell scope="col">Rolle</Table.HeaderCell>
							<Table.HeaderCell scope="col">Type</Table.HeaderCell>
							<Table.HeaderCell scope="col">Kritikalitet</Table.HeaderCell>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{roles.map((r) => (
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
						))}
					</Table.Body>
				</Table>
			</section>
		</VStack>
	)
}
