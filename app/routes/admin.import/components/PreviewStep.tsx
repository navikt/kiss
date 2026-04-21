import type { SortState } from "@navikt/ds-react"
import { BodyLong, Heading, HStack, Switch, Table, VStack } from "@navikt/ds-react"
import { useMemo, useState } from "react"
import { allColumns, basicColumnKeys, type SerializedControl, type SerializedSummary } from "../shared"

interface PreviewStepProps {
	summary: SerializedSummary
}

export function PreviewStep({ summary }: PreviewStepProps) {
	const [showAllColumns, setShowAllColumns] = useState(false)
	const [sort, setSort] = useState<SortState | undefined>(undefined)

	const visibleColumns = showAllColumns ? allColumns : allColumns.filter((c) => basicColumnKeys.has(c.key))

	const sortedControls = useMemo(() => {
		if (!sort) return summary.controls
		// sort.orderBy is set from col.key (keyof SerializedControl) below — safe to narrow once.
		const orderBy = sort.orderBy as keyof SerializedControl
		return [...summary.controls].sort((a, b) => {
			const aVal = a[orderBy] ?? ""
			const bVal = b[orderBy] ?? ""
			const cmp = String(aVal).localeCompare(String(bVal), "nb")
			return sort.direction === "descending" ? -cmp : cmp
		})
	}, [summary.controls, sort])

	return (
		<>
			<VStack gap="space-2">
				<Heading size="medium" level="3">
					Metadata
				</Heading>
				<BodyLong>
					<strong>Filnavn:</strong> {summary.fileName}
				</BodyLong>
				<BodyLong>
					<strong>Lastet opp:</strong> {new Date(summary.uploadedAt).toLocaleString("nb-NO")}
				</BodyLong>
				<BodyLong>
					<strong>Lastet opp av:</strong> {summary.uploadedBy}
				</BodyLong>
			</VStack>
			<VStack gap="space-2">
				<Heading size="medium" level="3">
					Oppsummering
				</Heading>
				<BodyLong>
					{summary.domainCount} domener · {summary.riskCount} risikoer · {summary.controlCount} kontroller
				</BodyLong>
			</VStack>
			<VStack gap="space-4">
				<HStack gap="space-6" align="center" justify="space-between">
					<Heading size="medium" level="3">
						Kontroller (forhåndsvisning)
					</Heading>
					<Switch size="small" checked={showAllColumns} onChange={() => setShowAllColumns((v) => !v)}>
						Vis alle kolonner
					</Switch>
				</HStack>
				{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */}
				<section className="table-scroll" tabIndex={0} aria-label="Kontroller forhåndsvisning">
					<Table
						size="small"
						sort={sort}
						onSortChange={(sortKey) =>
							setSort((prev) =>
								prev?.orderBy === sortKey && prev.direction === "ascending"
									? { orderBy: sortKey, direction: "descending" }
									: { orderBy: sortKey, direction: "ascending" },
							)
						}
					>
						<Table.Header>
							<Table.Row>
								{visibleColumns.map((col) => (
									<Table.ColumnHeader key={col.key} sortKey={col.key} sortable>
										{col.label}
									</Table.ColumnHeader>
								))}
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{sortedControls.map((control) => (
								<Table.Row key={control.controlId}>
									{visibleColumns.map((col) => (
										<Table.DataCell key={col.key}>{control[col.key] ?? "–"}</Table.DataCell>
									))}
								</Table.Row>
							))}
						</Table.Body>
					</Table>
				</section>
			</VStack>
		</>
	)
}
