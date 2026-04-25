import { TrashIcon } from "@navikt/aksel-icons"
import { Link as AkselLink, Button, Detail, HStack, ReadMore, Select, Table, Tag, VStack } from "@navikt/ds-react"
import type { ChangeEvent } from "react"
import { useFetcher } from "react-router"
import { type DataClassification, dataClassificationLabels } from "~/db/schema/applications"
import { conclusionConfig, findingSeverityVariant, persistenceLabels, persistenceVariants } from "../shared"

export function PersistenceRow({
	p,
	oracleAuditSummaries,
}: {
	p: {
		id: string
		type: string
		name: string
		version: string | null
		tier: string | null
		highAvailability: boolean | null
		auditLogging: boolean | null
		auditLogUrl: string | null
		oracleInstanceId: string | null
		dataClassification: string | null
		manuallyAdded: boolean
	}
	oracleAuditSummaries: Record<
		string,
		{
			conclusion: string
			reason: string
			findings: Array<{ severity: string; message: string }>
		}
	>
}) {
	const classificationFetcher = useFetcher()
	const archiveFetcher = useFetcher()

	return (
		<Table.Row>
			<Table.DataCell>
				<HStack gap="space-2" align="center">
					<Tag variant={persistenceVariants[p.type] ?? "neutral"} size="xsmall">
						{persistenceLabels[p.type] ?? p.type}
					</Tag>
					{p.manuallyAdded && (
						<Tag variant="neutral" size="xsmall">
							Manuelt
						</Tag>
					)}
					{!p.manuallyAdded && p.oracleInstanceId && p.oracleInstanceId === p.name && (
						<Tag variant="neutral" size="xsmall">
							Manuelt konfigurert
						</Tag>
					)}
				</HStack>
			</Table.DataCell>
			<Table.DataCell>{p.name}</Table.DataCell>
			<Table.DataCell>
				<classificationFetcher.Form method="post">
					<input type="hidden" name="intent" value="update-classification" />
					<input type="hidden" name="persistenceId" value={p.id} />
					<Select
						label="Dataklassifisering"
						hideLabel
						size="small"
						name="dataClassification"
						defaultValue={p.dataClassification ?? ""}
						onChange={(e: ChangeEvent<HTMLSelectElement>) => {
							const form = e.currentTarget.form
							if (form) classificationFetcher.submit(form)
						}}
					>
						<option value="">Ikke satt</option>
						{(Object.entries(dataClassificationLabels) as [DataClassification, string][]).map(([value, label]) => (
							<option key={value} value={value}>
								{label}
							</option>
						))}
					</Select>
				</classificationFetcher.Form>
			</Table.DataCell>
			<Table.DataCell>{p.version ?? "–"}</Table.DataCell>
			<Table.DataCell>{p.tier ?? "–"}</Table.DataCell>
			<Table.DataCell>
				{p.highAvailability === true ? (
					<Tag variant="success" size="xsmall">
						Ja
					</Tag>
				) : p.highAvailability === false ? (
					<Tag variant="error" size="xsmall">
						Nei
					</Tag>
				) : (
					"–"
				)}
			</Table.DataCell>
			<Table.DataCell>
				{p.type === "oracle" && oracleAuditSummaries[p.id] ? (
					<VStack gap="space-2">
						<Tag variant={conclusionConfig[oracleAuditSummaries[p.id].conclusion]?.variant ?? "neutral"} size="xsmall">
							{conclusionConfig[oracleAuditSummaries[p.id].conclusion]?.label ?? oracleAuditSummaries[p.id].conclusion}
						</Tag>
						<Detail style={{ color: "var(--ax-text-subtle)" }}>{oracleAuditSummaries[p.id].reason}</Detail>
						{oracleAuditSummaries[p.id].findings.length > 0 && (
							<ReadMore header="Funn" size="small" defaultOpen={false}>
								<VStack gap="space-2">
									{oracleAuditSummaries[p.id].findings.map((f, i) => (
										// biome-ignore lint/suspicious/noArrayIndexKey: static findings list
										<HStack key={i} gap="space-2" align="center" wrap>
											<Tag variant={findingSeverityVariant[f.severity] ?? "info"} size="xsmall">
												{f.severity}
											</Tag>
											<Detail>{f.message}</Detail>
										</HStack>
									))}
								</VStack>
							</ReadMore>
						)}
					</VStack>
				) : p.auditLogging === true ? (
					p.auditLogUrl ? (
						<AkselLink href={p.auditLogUrl} target="_blank" rel="noopener noreferrer">
							<Tag variant="success" size="xsmall">
								Ja – se logg (åpnes i nytt vindu)
							</Tag>
						</AkselLink>
					) : (
						<Tag variant="success" size="xsmall">
							Ja
						</Tag>
					)
				) : p.auditLogging === false ? (
					<Tag variant="error" size="xsmall">
						Nei
					</Tag>
				) : (
					"–"
				)}
			</Table.DataCell>
			<Table.DataCell>
				{p.manuallyAdded && (
					<archiveFetcher.Form method="post">
						<input type="hidden" name="intent" value="archive-persistence" />
						<input type="hidden" name="persistenceId" value={p.id} />
						<Button
							type="submit"
							variant="tertiary-neutral"
							size="xsmall"
							icon={<TrashIcon aria-hidden />}
							loading={archiveFetcher.state !== "idle"}
						>
							Arkiver
						</Button>
					</archiveFetcher.Form>
				)}
			</Table.DataCell>
		</Table.Row>
	)
}
