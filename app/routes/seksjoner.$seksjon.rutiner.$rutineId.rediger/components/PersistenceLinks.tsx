import { PlusIcon, TrashIcon } from "@navikt/aksel-icons"
import { BodyShort, Button, HStack, Label, Select, VStack } from "@navikt/ds-react"
import {
	type DataClassification,
	dataClassificationLabels,
	persistenceTypeEnum,
	persistenceTypeLabels,
} from "~/db/schema/applications"
import type { PersistenceLinkItem } from "../shared"

interface Props {
	links: PersistenceLinkItem[]
	onAdd: () => void
	onRemove: (index: number) => void
	onUpdate: (index: number, field: "persistenceType" | "dataClassification", value: string) => void
}

export function PersistenceLinks({ links, onAdd, onRemove, onUpdate }: Props) {
	return (
		<VStack gap="space-2">
			<Label size="small">Database og klassifisering</Label>
			<BodyShort size="small" textColor="subtle">
				Knytt rutinen til én eller flere databasetyper og/eller dataklassifiseringer.
			</BodyShort>
			{links.map((link, index) => (
				<HStack key={link.key} gap="space-2" align="end" wrap>
					{/* TODO: flytt inline style til CSS */}
					<div style={{ flex: 1, minWidth: "12rem" }}>
						<Select
							label={index === 0 ? "Databasetype" : undefined}
							hideLabel={index > 0}
							aria-label="Databasetype"
							size="small"
							value={link.persistenceType}
							onChange={(e) => onUpdate(index, "persistenceType", e.target.value)}
						>
							<option value="">Ikke angitt</option>
							{persistenceTypeEnum.map((t) => (
								<option key={t} value={t}>
									{persistenceTypeLabels[t]}
								</option>
							))}
						</Select>
					</div>
					{/* TODO: flytt inline style til CSS */}
					<div style={{ flex: 1, minWidth: "12rem" }}>
						<Select
							label={index === 0 ? "Dataklassifisering" : undefined}
							hideLabel={index > 0}
							aria-label="Dataklassifisering"
							size="small"
							value={link.dataClassification}
							onChange={(e) => onUpdate(index, "dataClassification", e.target.value)}
						>
							<option value="">Ikke angitt</option>
							{(Object.entries(dataClassificationLabels) as [DataClassification, string][]).map(([value, label]) => (
								<option key={value} value={value}>
									{label}
								</option>
							))}
						</Select>
					</div>
					<input type="hidden" name="plPersistenceType" value={link.persistenceType} />
					<input type="hidden" name="plDataClassification" value={link.dataClassification} />
					<Button
						type="button"
						variant="tertiary-neutral"
						size="small"
						icon={<TrashIcon aria-hidden />}
						onClick={() => onRemove(index)}
						aria-label="Fjern kobling"
					/>
				</HStack>
			))}
			<div>
				<Button type="button" variant="secondary" size="xsmall" icon={<PlusIcon aria-hidden />} onClick={onAdd}>
					Legg til kobling
				</Button>
			</div>
		</VStack>
	)
}
