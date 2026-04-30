import { PlusIcon, TrashIcon } from "@navikt/aksel-icons"
import {
	BodyShort,
	Button,
	Dialog,
	ErrorSummary,
	Heading,
	HStack,
	Select,
	Table,
	Tag,
	TextField,
	VStack,
} from "@navikt/ds-react"
import { type FormEvent, useRef, useState } from "react"
import { Form, useFetcher } from "react-router"
import {
	type DataClassification,
	dataClassificationLabels,
	persistenceTypeEnum,
	persistenceTypeLabels,
} from "~/db/schema/applications"
import { type PersistenceEntry, persistenceVariants } from "../shared"
import styles from "./wizard.module.css"

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
	const [dialogOpen, setDialogOpen] = useState(false)
	const [hasAttempted, setHasAttempted] = useState(false)
	const typeRef = useRef<HTMLSelectElement>(null)
	const errorSummaryRef = useRef<HTMLDivElement>(null)

	const allClassified = entries.length > 0 && entries.every((p) => p.dataClassification)
	const unclassifiedEntries = entries.filter((p) => !p.dataClassification)

	function handleConfirmSubmit(e: FormEvent<HTMLFormElement>) {
		if (entries.length === 0 || !allClassified) {
			e.preventDefault()
			setHasAttempted(true)
			setTimeout(() => errorSummaryRef.current?.focus(), 0)
		}
	}

	const errors: Array<{ message: string; href: string }> = []
	if (hasAttempted && entries.length === 0) {
		errors.push({ message: "Legg til minst én database", href: "#add-persistence-btn" })
	}
	if (hasAttempted && unclassifiedEntries.length > 0) {
		for (const p of unclassifiedEntries) {
			errors.push({ message: `Sett klassifisering for ${p.name}`, href: `#classification-${p.id}` })
		}
	}

	return (
		<VStack gap="space-6">
			<div className={styles.tableHeader}>
				<Heading size="xsmall" level="4">
					Registrerte databaser
				</Heading>
				<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
					<Dialog.Trigger>
						<Button variant="tertiary" size="small" icon={<PlusIcon aria-hidden />} id="add-persistence-btn">
							Legg til database
						</Button>
					</Dialog.Trigger>
					<Dialog.Popup
						width="large"
						position="center"
						closeOnOutsideClick
						initialFocusTo={() => typeRef.current}
						aria-label="Legg til database"
					>
						<Dialog.Header>Legg til database</Dialog.Header>
						<Dialog.Body>
							<fetcher.Form
								method="post"
								onSubmit={() => {
									setTimeout(() => setDialogOpen(false), 100)
								}}
							>
								<input type="hidden" name="intent" value="add-persistence" />
								<VStack gap="space-4">
									<Select ref={typeRef} label="Type" name="persistenceType" size="small">
										{persistenceTypeEnum.map((t) => (
											<option key={t} value={t}>
												{persistenceTypeLabels[t] ?? t}
											</option>
										))}
									</Select>
									<TextField label="Navn" name="persistenceName" size="small" />
									<Select label="Dataklassifisering" name="dataClassification" size="small">
										<option value="">Ikke satt</option>
										{(Object.entries(dataClassificationLabels) as [DataClassification, string][]).map(
											([value, label]) => (
												<option key={value} value={value}>
													{label}
												</option>
											),
										)}
									</Select>
									<Button type="submit" variant="primary" size="small" loading={fetcher.state !== "idle"}>
										Legg til
									</Button>
								</VStack>
							</fetcher.Form>
						</Dialog.Body>
					</Dialog.Popup>
				</Dialog>
			</div>

			{entries.length > 0 ? (
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
												id={`classification-${p.id}`}
												onChange={(e) => {
													const form = e.target.closest("form")
													if (form) fetcher.submit(form)
													if (hasAttempted) setHasAttempted(false)
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
			) : (
				<BodyShort size="small" textColor="subtle">
					Ingen databaser registrert ennå. Legg til med knappen over.
				</BodyShort>
			)}

			<Form method="post" onSubmit={handleConfirmSubmit}>
				<input type="hidden" name="intent" value="screening" />
				<input type="hidden" name="questionId" value={questionId} />
				<input type="hidden" name="answer" value="confirmed" />
				<VStack gap="space-4">
					{hasAttempted && errors.length > 0 && (
						<ErrorSummary ref={errorSummaryRef} heading="Kan ikke bekrefte ennå">
							{errors.map((err) => (
								<ErrorSummary.Item key={err.href} href={err.href}>
									{err.message}
								</ErrorSummary.Item>
							))}
						</ErrorSummary>
					)}
					<HStack gap="space-4" align="center" justify="end">
						{confirmed && (
							<Tag variant="success" size="xsmall">
								✓ Bekreftet
							</Tag>
						)}
						<Button type="submit" size="small" variant={confirmed ? "secondary-neutral" : "primary"}>
							{confirmed ? "✓ Bekreftet" : "Bekreft og gå videre"}
						</Button>
					</HStack>
				</VStack>
			</Form>
		</VStack>
	)
}
