import { BodyShort, Heading, Select, Table, Tag, VStack } from "@navikt/ds-react"
import { type ChangeEvent, useEffect, useState } from "react"
import { useFetcher } from "react-router"
import { type GroupCriticality, groupCriticalityEnum, groupCriticalityLabels } from "~/db/schema/applications"
import { criticalityTagColor, criticalityTagVariant } from "../shared"

export interface OracleProfileDisplay {
	instanceId: string
	instanceName: string
	profileName: string
	criticality: GroupCriticality | null
	updatedBy: string | null
	updatedAt: string | null
}

function CriticalitySelect({
	instanceId,
	profileName,
	currentValue,
}: {
	instanceId: string
	profileName: string
	currentValue: GroupCriticality | null
}) {
	const fetcher = useFetcher()
	const [value, setValue] = useState(currentValue ?? "")

	useEffect(() => {
		setValue(currentValue ?? "")
	}, [currentValue])

	return (
		<fetcher.Form method="post">
			<input type="hidden" name="intent" value="set-oracle-profile-criticality" />
			<input type="hidden" name="instanceId" value={instanceId} />
			<input type="hidden" name="profileName" value={profileName} />
			<Select
				label="Kritikalitet"
				hideLabel
				size="small"
				value={value}
				onChange={(e: ChangeEvent<HTMLSelectElement>) => {
					setValue(e.target.value)
					fetcher.submit(
						{
							intent: "set-oracle-profile-criticality",
							instanceId,
							profileName,
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

export function OracleProfilesSection({ profiles, canAdmin }: { profiles: OracleProfileDisplay[]; canAdmin: boolean }) {
	if (profiles.length === 0) return null

	return (
		<VStack gap="space-4">
			<Heading size="xsmall" level="4">
				Oracle Database-profiler ({profiles.length})
			</Heading>
			<BodyShort size="small" textColor="subtle">
				Profiler som er tildelt i Oracle-databasene som applikasjonen bruker. Vurder kritikaliteten til hver profil.
			</BodyShort>

			{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */}
			<section className="table-scroll" tabIndex={0} aria-label="Oracle Database-profiler">
				<Table size="small">
					<Table.Header>
						<Table.Row>
							<Table.HeaderCell scope="col">Instans</Table.HeaderCell>
							<Table.HeaderCell scope="col">Profil</Table.HeaderCell>
							<Table.HeaderCell scope="col">Kritikalitet</Table.HeaderCell>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{profiles.map((p) => (
							<Table.Row key={`${p.instanceId}:${p.profileName}`}>
								<Table.DataCell>
									<BodyShort size="small">{p.instanceName}</BodyShort>
								</Table.DataCell>
								<Table.DataCell>
									<BodyShort size="small" style={{ fontFamily: "monospace" }}>
										{p.profileName}
									</BodyShort>
								</Table.DataCell>
								<Table.DataCell>
									{canAdmin ? (
										<CriticalitySelect
											instanceId={p.instanceId}
											profileName={p.profileName}
											currentValue={p.criticality}
										/>
									) : p.criticality ? (
										<Tag
											variant={criticalityTagVariant[p.criticality] ?? "neutral"}
											size="xsmall"
											style={
												p.criticality === "high"
													? { backgroundColor: criticalityTagColor.high, borderColor: criticalityTagColor.high }
													: undefined
											}
										>
											{groupCriticalityLabels[p.criticality] ?? p.criticality}
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
