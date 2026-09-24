import { PlusIcon, TrashIcon } from "@navikt/aksel-icons"
import { BodyShort, Button, Dialog, Heading, Select, Table, Tag, TextField, VStack } from "@navikt/ds-react"
import type { MouseEvent } from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import { useFetcher } from "react-router"
import {
	type DataClassification,
	dataClassificationLabels,
	persistenceTypeEnum,
	persistenceTypeLabels,
} from "~/db/schema/applications"
import { type PersistenceEntry, persistenceVariants } from "../shared"
import styles from "./wizard.module.css"

export function PersistenceSection({ entries }: { entries: PersistenceEntry[] }) {
	const fetcher = useFetcher()
	const [dialogOpen, setDialogOpen] = useState(false)
	const typeRef = useRef<HTMLSelectElement>(null)

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
									<TextField
										label="Begrunnelse (valgfritt)"
										description="Forklar gjerne hvorfor databasen er vurdert til denne klassifiseringen"
										name="dataClassificationJustification"
										size="small"
									/>
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
								<Table.HeaderCell>Begrunnelse</Table.HeaderCell>
								<Table.HeaderCell />
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{entries.map((p) => (
								<PersistenceEntryRow key={p.id} p={p} />
							))}
						</Table.Body>
					</Table>
				</section>
			) : (
				<BodyShort size="small" textColor="subtle">
					Ingen databaser registrert ennå. Legg til med knappen over.
				</BodyShort>
			)}
		</VStack>
	)
}

function PersistenceEntryRow({ p }: { p: PersistenceEntry }) {
	const classificationFetcher = useFetcher()
	const archiveFetcher = useFetcher()
	const submitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
	const lastSavedJustification = useRef(p.dataClassificationJustification ?? "")
	const archiveFormRef = useRef<HTMLFormElement | null>(null)
	const pendingArchiveRef = useRef(false)
	const flushClassificationForm = useCallback(() => {
		if (submitTimer.current) {
			clearTimeout(submitTimer.current)
			submitTimer.current = null
		}
		const form = document.getElementById(`classification-form-${p.id}`) as HTMLFormElement | null
		if (form) classificationFetcher.submit(form)
	}, [p.id, classificationFetcher])
	useEffect(
		() => () => {
			if (submitTimer.current) flushClassificationForm()
		},
		[flushClassificationForm],
	)
	// Begge intents er "staged" (skrives til staged_data og replayes ved
	// fullføring). Hvis en klassifiserings-lagring fortsatt venter når
	// arkivering trigges, må den staged FØR arkiveringen — ellers kan
	// arkiveringen bli staged først, og replay ved fullføring vil da avvise
	// den senere klassifiseringsoppdateringen mot den (nå) arkiverte raden.
	useEffect(() => {
		if (pendingArchiveRef.current && classificationFetcher.state === "idle") {
			pendingArchiveRef.current = false
			archiveFormRef.current?.requestSubmit()
		}
	}, [classificationFetcher.state])
	const scheduleSubmit = () => {
		if (submitTimer.current) clearTimeout(submitTimer.current)
		submitTimer.current = setTimeout(() => {
			submitTimer.current = null
			const form = document.getElementById(`classification-form-${p.id}`) as HTMLFormElement | null
			if (form) classificationFetcher.submit(form)
		}, 400)
	}
	const handleArchiveClick = (e: MouseEvent<HTMLButtonElement>) => {
		if (submitTimer.current) {
			e.preventDefault()
			pendingArchiveRef.current = true
			flushClassificationForm()
		} else if (classificationFetcher.state !== "idle") {
			e.preventDefault()
			pendingArchiveRef.current = true
		}
	}

	return (
		<Table.Row>
			<Table.DataCell>
				<Tag variant={persistenceVariants[p.type] ?? "neutral"} size="xsmall">
					{persistenceTypeLabels[p.type as keyof typeof persistenceTypeLabels] ?? p.type}
				</Tag>
			</Table.DataCell>
			<Table.DataCell>{p.name}</Table.DataCell>
			<Table.DataCell>
				<classificationFetcher.Form method="post" id={`classification-form-${p.id}`}>
					<input type="hidden" name="intent" value="update-persistence-classification" />
					<input type="hidden" name="persistenceId" value={p.id} />
				</classificationFetcher.Form>
				<Select
					label="Klassifisering"
					hideLabel
					name="dataClassification"
					size="small"
					form={`classification-form-${p.id}`}
					defaultValue={p.dataClassification ?? ""}
					id={`classification-${p.id}`}
					onChange={() => {
						const justificationInput = document.getElementById(
							`classification-justification-${p.id}`,
						) as HTMLInputElement | null
						if (justificationInput) lastSavedJustification.current = justificationInput.value
						scheduleSubmit()
					}}
				>
					<option value="">Ikke satt</option>
					{(Object.entries(dataClassificationLabels) as [DataClassification, string][]).map(([value, label]) => (
						<option key={value} value={value}>
							{label}
						</option>
					))}
				</Select>
			</Table.DataCell>
			<Table.DataCell>
				<TextField
					label="Begrunnelse (valgfritt)"
					hideLabel
					name="dataClassificationJustification"
					size="small"
					form={`classification-form-${p.id}`}
					defaultValue={p.dataClassificationJustification ?? ""}
					id={`classification-justification-${p.id}`}
					onBlur={(e) => {
						if (e.target.value === lastSavedJustification.current) return
						lastSavedJustification.current = e.target.value
						scheduleSubmit()
					}}
				/>
			</Table.DataCell>
			<Table.DataCell>
				{p.manuallyAdded && (
					<archiveFetcher.Form method="post" ref={archiveFormRef}>
						<input type="hidden" name="intent" value="archive-persistence" />
						<input type="hidden" name="persistenceId" value={p.id} />
						<Button
							type="submit"
							size="xsmall"
							variant="tertiary-neutral"
							icon={<TrashIcon aria-hidden />}
							loading={archiveFetcher.state !== "idle"}
							onClick={handleArchiveClick}
						>
							Arkiver
						</Button>
					</archiveFetcher.Form>
				)}
			</Table.DataCell>
		</Table.Row>
	)
}
