import { PlusIcon, TrashIcon } from "@navikt/aksel-icons"
import { BodyShort, Button, HStack, Select, Table, Tag, TextField, VStack } from "@navikt/ds-react"
import { Form, useFetcher } from "react-router"
import {
	type DataClassification,
	dataClassificationLabels,
	persistenceTypeEnum,
	persistenceTypeLabels,
} from "~/db/schema/applications"
import { type PersistenceEntry, persistenceVariants } from "../shared"

export function PersistenceSection({
	entries,
	questionId,
	confirmed,
}: {
	entries: PersistenceEntry[]
	questionId: string
	confirmed: boolean
}) {
	const fetcher = useFetcher()

	const allClassified = entries.length > 0 && entries.every((p) => p.dataClassification)
	const canConfirm = allClassified && !confirmed

	return (
		<VStack gap="space-6">
			{entries.length > 0 && (
				<section className="table-scroll" aria-label="Registrerte databaser">
					<Table size="small">
						<Table.Header>
							<Table.Row>
								<Table.HeaderCell>Type</Table.HeaderCell>
								<Table.HeaderCell>Navn</Table.HeaderCell>
								<Table.HeaderCell>Klassifisering</Table.HeaderCell>
								<Table.HeaderCell />
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{entries.map((p) => (
								<Table.Row key={p.id}>
									<Table.DataCell>
										<Tag variant={persistenceVariants[p.type] ?? "neutral"} size="xsmall">
											{persistenceTypeLabels[p.type as keyof typeof persistenceTypeLabels] ?? p.type}
										</Tag>
									</Table.DataCell>
									<Table.DataCell>{p.name}</Table.DataCell>
									<Table.DataCell>
										<fetcher.Form method="post">
											<input type="hidden" name="intent" value="update-persistence-classification" />
											<input type="hidden" name="persistenceId" value={p.id} />
											<Select
												label="Klassifisering"
												hideLabel
												name="dataClassification"
												size="small"
												defaultValue={p.dataClassification ?? ""}
												onChange={(e) => {
													const form = e.target.closest("form")
													if (form) fetcher.submit(form)
												}}
											>
												<option value="">Ikke satt</option>
												{(Object.entries(dataClassificationLabels) as [DataClassification, string][]).map(
													([value, label]) => (
														<option key={value} value={value}>
															{label}
														</option>
													),
												)}
											</Select>
										</fetcher.Form>
									</Table.DataCell>
									<Table.DataCell>
										{p.manuallyAdded && (
											<fetcher.Form method="post">
												<input type="hidden" name="intent" value="archive-persistence" />
												<input type="hidden" name="persistenceId" value={p.id} />
												<Button type="submit" size="xsmall" variant="tertiary-neutral" icon={<TrashIcon aria-hidden />}>
													Arkiver
												</Button>
											</fetcher.Form>
										)}
									</Table.DataCell>
								</Table.Row>
							))}
						</Table.Body>
					</Table>
				</section>
			)}

			{entries.length === 0 && (
				<BodyShort size="small" textColor="subtle">
					Ingen databaser registrert ennå.
				</BodyShort>
			)}

			<fetcher.Form method="post">
				<input type="hidden" name="intent" value="add-persistence" />
				<HStack gap="space-4" align="end" wrap>
					<Select label="Type" name="persistenceType" size="small" style={{ minWidth: "12rem" }}>
						{persistenceTypeEnum.map((t) => (
							<option key={t} value={t}>
								{persistenceTypeLabels[t] ?? t}
							</option>
						))}
					</Select>
					<TextField label="Navn" name="persistenceName" size="small" style={{ minWidth: "14rem" }} />
					<Select label="Dataklassifisering" name="dataClassification" size="small">
						<option value="">Ikke satt</option>
						{(Object.entries(dataClassificationLabels) as [DataClassification, string][]).map(([value, label]) => (
							<option key={value} value={value}>
								{label}
							</option>
						))}
					</Select>
					<Button
						type="submit"
						variant="secondary-neutral"
						size="small"
						icon={<PlusIcon aria-hidden />}
						loading={fetcher.state !== "idle"}
					>
						Legg til
					</Button>
				</HStack>
			</fetcher.Form>

			<Form method="post">
				<input type="hidden" name="intent" value="screening" />
				<input type="hidden" name="questionId" value={questionId} />
				<input type="hidden" name="answer" value="confirmed" />
				<HStack gap="space-4" align="center">
					<Button
						type="submit"
						size="small"
						variant={confirmed ? "secondary-neutral" : "primary"}
						disabled={!canConfirm}
					>
						{confirmed ? "✓ Bekreftet" : "Bekreft at all persistens er registrert"}
					</Button>
					{!allClassified && entries.length > 0 && (
						<BodyShort size="small" textColor="subtle">
							Alle databaser må ha klassifisering før du kan bekrefte.
						</BodyShort>
					)}
					{entries.length === 0 && (
						<BodyShort size="small" textColor="subtle">
							Legg til minst én database før du kan bekrefte.
						</BodyShort>
					)}
				</HStack>
			</Form>
		</VStack>
	)
}
