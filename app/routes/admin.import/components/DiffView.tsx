import { Alert, BodyLong, Checkbox, Heading, HStack, Table, Tag, VStack } from "@navikt/ds-react"
import { WordDiff } from "~/components/WordDiff"
import { diffFieldLabels, resolveDiffValue, type StagingDiff, truncateValue } from "../shared"

interface DiffViewProps {
	stagingDiff: StagingDiff
	excludedChanges: Set<string>
	setExcludedChanges: (updater: (prev: Set<string>) => Set<string>) => void
}

interface ChangeTableProps {
	rows: Array<{ id: string; field: string; oldValue: string | null; newValue: string | null; entityKey: string }>
	excludedChanges: Set<string>
	setExcludedChanges: (updater: (prev: Set<string>) => Set<string>) => void
	headerLabel: string
	ariaLabel: string
	tagVariant: "warning" | "info"
	tagLabel: string
	description?: string
}

function toggle(set: Set<string>, key: string): Set<string> {
	const next = new Set(set)
	if (next.has(key)) {
		next.delete(key)
	} else {
		next.add(key)
	}
	return next
}

function ChangeTable({
	rows,
	excludedChanges,
	setExcludedChanges,
	headerLabel,
	ariaLabel,
	tagVariant,
	tagLabel,
	description,
}: ChangeTableProps) {
	const allKeys = rows.map((r) => r.entityKey)
	const includedCount = allKeys.filter((k) => !excludedChanges.has(k)).length

	return (
		<VStack gap="space-2">
			<HStack gap="space-2" align="center">
				<Tag variant={tagVariant} size="small">
					{tagLabel}
				</Tag>
			</HStack>
			{description && <BodyLong size="small">{description}</BodyLong>}
			{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */}
			<section className="table-scroll" tabIndex={0} aria-label={ariaLabel}>
				<Table size="small">
					<Table.Header>
						<Table.Row>
							<Table.HeaderCell scope="col">
								<Checkbox
									size="small"
									hideLabel
									checked={includedCount === allKeys.length}
									indeterminate={includedCount > 0 && includedCount < allKeys.length}
									onChange={() => {
										setExcludedChanges((prev) => {
											const allIncluded = allKeys.every((k) => !prev.has(k))
											if (allIncluded) {
												return new Set([...prev, ...allKeys])
											}
											const next = new Set(prev)
											for (const k of allKeys) {
												next.delete(k)
											}
											return next
										})
									}}
								>
									{headerLabel}
								</Checkbox>
							</Table.HeaderCell>
							<Table.HeaderCell scope="col">Element</Table.HeaderCell>
							<Table.HeaderCell scope="col">Felt</Table.HeaderCell>
							<Table.HeaderCell scope="col">Gammel verdi</Table.HeaderCell>
							<Table.HeaderCell scope="col">Ny verdi</Table.HeaderCell>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{rows.map((row) => (
							<Table.Row key={row.entityKey}>
								<Table.DataCell>
									<Checkbox
										size="small"
										hideLabel
										checked={!excludedChanges.has(row.entityKey)}
										onChange={() => setExcludedChanges((prev) => toggle(prev, row.entityKey))}
									>
										Inkluder endring for {row.id} {row.field}
									</Checkbox>
								</Table.DataCell>
								<Table.DataCell>{row.id}</Table.DataCell>
								<Table.DataCell>{diffFieldLabels[row.field] ?? row.field}</Table.DataCell>
								<Table.DataCell>
									<WordDiff
										oldValue={resolveDiffValue(row.field, row.oldValue)}
										newValue={resolveDiffValue(row.field, row.newValue)}
										side="old"
									/>
								</Table.DataCell>
								<Table.DataCell>
									<WordDiff
										oldValue={resolveDiffValue(row.field, row.oldValue)}
										newValue={resolveDiffValue(row.field, row.newValue)}
										side="new"
									/>
								</Table.DataCell>
							</Table.Row>
						))}
					</Table.Body>
				</Table>
			</section>
		</VStack>
	)
}

export function DiffView({ stagingDiff, excludedChanges, setExcludedChanges }: DiffViewProps) {
	if (stagingDiff.isFirstImport) {
		return (
			<VStack gap="space-4">
				<Heading size="medium" level="3">
					Endringer fra aktiv versjon
				</Heading>
				<Alert variant="info">Dette er første import — alle elementer er nye.</Alert>
			</VStack>
		)
	}

	const addedCount =
		stagingDiff.added.risks.length + stagingDiff.added.controls.length + stagingDiff.added.domains.length
	const removedCount =
		stagingDiff.removed.risks.length + stagingDiff.removed.controls.length + stagingDiff.removed.domains.length
	const changedCount = stagingDiff.changed.risks.length + stagingDiff.changed.controls.length

	const hasAdded =
		stagingDiff.added.risks.length > 0 || stagingDiff.added.controls.length > 0 || stagingDiff.added.domains.length > 0
	const hasRemoved =
		stagingDiff.removed.risks.length > 0 ||
		stagingDiff.removed.controls.length > 0 ||
		stagingDiff.removed.domains.length > 0

	const xlsxChangedRisks = stagingDiff.changed.risks
		.map((r) => ({ ...r, fields: r.fields.filter((f) => f.source === "xlsx-changed") }))
		.filter((r) => r.fields.length > 0)
	const xlsxChangedControls = stagingDiff.changed.controls
		.map((c) => ({ ...c, fields: c.fields.filter((f) => f.source === "xlsx-changed") }))
		.filter((c) => c.fields.length > 0)
	const dbOnlyRisks = stagingDiff.changed.risks
		.map((r) => ({ ...r, fields: r.fields.filter((f) => f.source === "db-only") }))
		.filter((r) => r.fields.length > 0)
	const dbOnlyControls = stagingDiff.changed.controls
		.map((c) => ({ ...c, fields: c.fields.filter((f) => f.source === "db-only") }))
		.filter((c) => c.fields.length > 0)

	const xlsxRows = [
		...xlsxChangedRisks.flatMap((r) =>
			r.fields.map((f) => ({
				id: r.riskId,
				field: f.field,
				oldValue: f.oldValue,
				newValue: f.newValue,
				entityKey: `risk:${r.riskId}:${f.field}`,
			})),
		),
		...xlsxChangedControls.flatMap((c) =>
			c.fields.map((f) => ({
				id: c.controlId,
				field: f.field,
				oldValue: f.oldValue,
				newValue: f.newValue,
				entityKey: `control:${c.controlId}:${f.field}`,
			})),
		),
	]

	const dbOnlyRows = [
		...dbOnlyRisks.flatMap((r) =>
			r.fields.map((f) => ({
				id: r.riskId,
				field: f.field,
				oldValue: f.oldValue,
				newValue: f.newValue,
				entityKey: `risk:${r.riskId}:${f.field}`,
			})),
		),
		...dbOnlyControls.flatMap((c) =>
			c.fields.map((f) => ({
				id: c.controlId,
				field: f.field,
				oldValue: f.oldValue,
				newValue: f.newValue,
				entityKey: `control:${c.controlId}:${f.field}`,
			})),
		),
	]

	const noChanges =
		stagingDiff.added.risks.length === 0 &&
		stagingDiff.added.controls.length === 0 &&
		stagingDiff.added.domains.length === 0 &&
		stagingDiff.removed.risks.length === 0 &&
		stagingDiff.removed.controls.length === 0 &&
		stagingDiff.removed.domains.length === 0 &&
		stagingDiff.changed.risks.length === 0 &&
		stagingDiff.changed.controls.length === 0

	return (
		<VStack gap="space-4">
			<Heading size="medium" level="3">
				Endringer fra aktiv versjon
			</Heading>
			<BodyLong>
				{addedCount} nye, {removedCount} fjernede, {changedCount} endrede elementer
			</BodyLong>

			{hasAdded && (
				<VStack gap="space-2">
					<HStack gap="space-2" align="center">
						<Tag variant="success" size="small">
							Nye elementer
						</Tag>
					</HStack>
					<Table size="small">
						<Table.Header>
							<Table.Row>
								<Table.HeaderCell scope="col">Type</Table.HeaderCell>
								<Table.HeaderCell scope="col">ID</Table.HeaderCell>
								<Table.HeaderCell scope="col">Beskrivelse</Table.HeaderCell>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{stagingDiff.added.domains.map((d) => (
								<Table.Row key={`domain-${d.code}`}>
									<Table.DataCell>Domene</Table.DataCell>
									<Table.DataCell>{d.code}</Table.DataCell>
									<Table.DataCell>{d.name}</Table.DataCell>
								</Table.Row>
							))}
							{stagingDiff.added.risks.map((r) => (
								<Table.Row key={`risk-${r.riskId}`}>
									<Table.DataCell>Risiko</Table.DataCell>
									<Table.DataCell>{r.riskId}</Table.DataCell>
									<Table.DataCell>{truncateValue(r.description)}</Table.DataCell>
								</Table.Row>
							))}
							{stagingDiff.added.controls.map((c) => (
								<Table.Row key={`control-${c.controlId}`}>
									<Table.DataCell>Kontroll</Table.DataCell>
									<Table.DataCell>{c.controlId}</Table.DataCell>
									<Table.DataCell>{truncateValue(c.requirement)}</Table.DataCell>
								</Table.Row>
							))}
						</Table.Body>
					</Table>
				</VStack>
			)}

			{hasRemoved && (
				<VStack gap="space-2">
					<HStack gap="space-2" align="center">
						<Tag variant="error" size="small">
							Fjernede elementer
						</Tag>
					</HStack>
					<Table size="small">
						<Table.Header>
							<Table.Row>
								<Table.HeaderCell scope="col">Type</Table.HeaderCell>
								<Table.HeaderCell scope="col">ID</Table.HeaderCell>
								<Table.HeaderCell scope="col">Beskrivelse</Table.HeaderCell>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{stagingDiff.removed.domains.map((d) => (
								<Table.Row key={`domain-${d.code}`}>
									<Table.DataCell>Domene</Table.DataCell>
									<Table.DataCell>{d.code}</Table.DataCell>
									<Table.DataCell>{d.name}</Table.DataCell>
								</Table.Row>
							))}
							{stagingDiff.removed.risks.map((r) => (
								<Table.Row key={`risk-${r.riskId}`}>
									<Table.DataCell>Risiko</Table.DataCell>
									<Table.DataCell>{r.riskId}</Table.DataCell>
									<Table.DataCell>{truncateValue(r.description)}</Table.DataCell>
								</Table.Row>
							))}
							{stagingDiff.removed.controls.map((c) => (
								<Table.Row key={`control-${c.controlId}`}>
									<Table.DataCell>Kontroll</Table.DataCell>
									<Table.DataCell>{c.controlId}</Table.DataCell>
									<Table.DataCell>{truncateValue(c.requirement)}</Table.DataCell>
								</Table.Row>
							))}
						</Table.Body>
					</Table>
				</VStack>
			)}

			{xlsxRows.length > 0 && (
				<ChangeTable
					rows={xlsxRows}
					excludedChanges={excludedChanges}
					setExcludedChanges={setExcludedChanges}
					headerLabel="Inkluder alle endringer"
					ariaLabel="Endringer i kontrollrammeverket"
					tagVariant="warning"
					tagLabel="Endringer i kontrollrammeverket"
				/>
			)}

			{dbOnlyRows.length > 0 && (
				<ChangeTable
					rows={dbOnlyRows}
					excludedChanges={excludedChanges}
					setExcludedChanges={setExcludedChanges}
					headerLabel="Inkluder alle manuelle endringer"
					ariaLabel="Manuelle endringer i databasen"
					tagVariant="info"
					tagLabel="Manuelle endringer i databasen"
					description="Disse feltene ble endret manuelt i applikasjonen etter forrige import. De er ikke valgt for oppdatering som standard."
				/>
			)}

			{noChanges && <Alert variant="info">Ingen endringer funnet mellom importert data og aktive data.</Alert>}
		</VStack>
	)
}
