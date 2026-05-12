import { DownloadIcon, ExternalLinkIcon } from "@navikt/aksel-icons"
import {
	Link as AkselLink,
	Alert,
	BodyShort,
	Button,
	DatePicker,
	Detail,
	Heading,
	HStack,
	Modal,
	Select,
	Skeleton,
	Table,
	Tag,
	Textarea,
	useDatepicker,
	VStack,
} from "@navikt/ds-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { useFetcher, useRevalidator } from "react-router"
import type { EvidenceStatus, EvidenceTypeStatus } from "~/lib/oracle-revisjon.server"

// ─── Types ────────────────────────────────────────────────────────────────

interface ActivityProp {
	id: string
	type: string
	status: string
	completedAt: string | null
	createdAt: string
}

interface OracleEvidenceDataProp {
	configuredInstances: Array<{ instanceId: string }>
	downloads: Array<{
		id: string
		instanceId: string
		evidenceType: string
		format: string
		fileName: string
		sizeBytes: number | null
		source: string
		apiInstanceName: string | null
		forceFetchJustification: string | null
		performedBy: string
		performedAt: string
	}>
	evidenceTypes: string[]
}

interface Props {
	activity: ActivityProp
	oracleEvidenceData: OracleEvidenceDataProp
	isDraft: boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatFileSize(bytes: number | null): string {
	if (bytes == null) return "—"
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(dateStr: string): string {
	return new Date(dateStr).toLocaleDateString("nb-NO", {
		day: "2-digit",
		month: "2-digit",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	})
}

function statusVariant(status: string): "success" | "warning" | "error" {
	switch (status) {
		case "OK":
			return "success"
		case "PARTIAL":
			return "warning"
		case "FAILED":
			return "error"
		default:
			return "warning"
	}
}

function statusLabel(status: string): string {
	switch (status) {
		case "OK":
			return "OK"
		case "PARTIAL":
			return "Delvis"
		case "FAILED":
			return "Feilet"
		default:
			return status
	}
}

const evidenceTypeLabels: Record<string, string> = {
	audit: "Oracle Unified Audit-konfigurasjon",
	profiles: "Oracle-profiler",
	roles: "Oracle-roller",
	users: "Oracle-brukere",
	period: "Periodebasert gjennomgang",
}

// ─── Force-fetch modal ────────────────────────────────────────────────────

function ForceFetchModal({
	open,
	onClose,
	onConfirm,
	evidenceType,
	status,
}: {
	open: boolean
	onClose: () => void
	onConfirm: (justification: string) => void
	evidenceType: string
	status: string
}) {
	const [justification, setJustification] = useState("")
	const modalRef = useRef<HTMLDialogElement>(null)

	useEffect(() => {
		if (open) setJustification("")
	}, [open])

	return (
		<Modal ref={modalRef} open={open} onClose={onClose} header={{ heading: "Hent ufullstendig bevis" }}>
			<Modal.Body>
				<VStack gap="space-4">
					<Alert variant="warning" size="small">
						Beviset «{evidenceTypeLabels[evidenceType] ?? evidenceType}» har status «{statusLabel(status)}» og er ikke
						fullstendig. Du kan likevel hente det, men du må oppgi en begrunnelse.
					</Alert>
					<Textarea
						label="Begrunnelse"
						description="Forklar hvorfor du henter beviset selv om det ikke er fullstendig"
						value={justification}
						onChange={(e) => setJustification(e.target.value)}
						minRows={3}
					/>
				</VStack>
			</Modal.Body>
			<Modal.Footer>
				<Button variant="primary" onClick={() => onConfirm(justification)} disabled={!justification.trim()}>
					Hent bevis med begrunnelse
				</Button>
				<Button variant="secondary" onClick={onClose}>
					Avbryt
				</Button>
			</Modal.Footer>
		</Modal>
	)
}

// ─── Component ────────────────────────────────────────────────────────────

export function OracleEvidenceSection({ activity, oracleEvidenceData, isDraft }: Props) {
	const { configuredInstances, downloads, evidenceTypes } = oracleEvidenceData
	const [selectedInstance, setSelectedInstance] = useState<string>(configuredInstances[0]?.instanceId ?? "")
	const [fromDate, setFromDate] = useState<string>("")
	const [toDate, setToDate] = useState<string>("")
	const [forceFetchState, setForceFetchState] = useState<{
		open: boolean
		evidenceType: string
		format: string
		status: string
	}>({ open: false, evidenceType: "", format: "", status: "" })

	const statusFetcher = useFetcher<EvidenceStatus>()
	const downloadFetcher = useFetcher()
	const revalidator = useRevalidator()

	const isCompleted = activity.status === "completed"
	const isPending = activity.status === "pending"
	const hasPeriodType = evidenceTypes.includes("period")

	const statusFetcherRef = useRef(statusFetcher)
	statusFetcherRef.current = statusFetcher

	const fetchStatus = useCallback(() => {
		if (!selectedInstance) return
		const params = new URLSearchParams({ instanceId: selectedInstance, activityId: activity.id })
		if (fromDate) params.set("fromUtc", fromDate)
		if (toDate) params.set("toUtc", toDate)
		statusFetcherRef.current.load(`/api/oracle-evidence-status?${params.toString()}`)
	}, [selectedInstance, fromDate, toDate, activity.id])

	useEffect(() => {
		if (selectedInstance) {
			fetchStatus()
		}
	}, [selectedInstance, fetchStatus])

	const statusFetcherData = statusFetcher.data
	const evidenceStatus = statusFetcherData && "evidenceTypes" in statusFetcherData ? statusFetcherData : undefined
	const statusError =
		statusFetcherData && "error" in statusFetcherData ? (statusFetcherData as { error: string }).error : undefined
	const isLoadingStatus = statusFetcher.state === "loading"

	const downloadError =
		downloadFetcher.data && "error" in downloadFetcher.data
			? (downloadFetcher.data as { error: string }).error
			: undefined

	const filteredEvidenceTypes = evidenceStatus?.evidenceTypes.filter((et) => evidenceTypes.includes(et.type)) ?? []

	const handleDownload = useCallback(
		(evidenceType: string, format: string, forceJustification?: string) => {
			if (!evidenceStatus || !selectedInstance) return
			const formData = new FormData()
			formData.set("intent", "download-from-api")
			formData.set("instanceId", selectedInstance)
			formData.set("evidenceType", evidenceType)
			formData.set("format", format)
			formData.set("activityId", activity.id)
			if (fromDate) formData.set("fromUtc", fromDate)
			if (toDate) formData.set("toUtc", toDate)
			if (forceJustification) {
				formData.set("forceFetchJustification", forceJustification)
			}

			downloadFetcher.submit(formData, { method: "POST", action: "/api/oracle-evidence-download" })
		},
		[evidenceStatus, selectedInstance, activity.id, fromDate, toDate, downloadFetcher],
	)

	const handleDownloadAttempt = useCallback(
		(evidenceType: string, format: string) => {
			const etStatus = filteredEvidenceTypes.find((et) => et.type === evidenceType)
			if (!etStatus?.available) return
			if (etStatus.status !== "OK") {
				setForceFetchState({ open: true, evidenceType, format, status: etStatus.status })
			} else {
				handleDownload(evidenceType, format)
			}
		},
		[filteredEvidenceTypes, handleDownload],
	)

	const handleForceFetchConfirm = useCallback(
		(justification: string) => {
			handleDownload(forceFetchState.evidenceType, forceFetchState.format, justification)
			setForceFetchState({ open: false, evidenceType: "", format: "", status: "" })
		},
		[forceFetchState, handleDownload],
	)

	const revalidateRef = useRef(revalidator.revalidate)
	revalidateRef.current = revalidator.revalidate
	useEffect(() => {
		if (downloadFetcher.state === "idle" && downloadFetcher.data && "success" in downloadFetcher.data) {
			revalidateRef.current()
		}
	}, [downloadFetcher.state, downloadFetcher.data])

	const isDownloading = downloadFetcher.state !== "idle"

	const fromDatepicker = useDatepicker({
		onDateChange: (date) => {
			if (date) {
				const y = date.getFullYear()
				const m = String(date.getMonth() + 1).padStart(2, "0")
				const d = String(date.getDate()).padStart(2, "0")
				setFromDate(`${y}-${m}-${d}`)
			} else {
				setFromDate("")
			}
		},
	})
	const toDatepicker = useDatepicker({
		onDateChange: (date) => {
			if (date) {
				const y = date.getFullYear()
				const m = String(date.getMonth() + 1).padStart(2, "0")
				const d = String(date.getDate()).padStart(2, "0")
				setToDate(`${y}-${m}-${d}`)
			} else {
				setToDate("")
			}
		},
	})

	return (
		<VStack gap="space-6">
			<HStack gap="space-4" align="center">
				<Heading size="medium" level="3">
					Oracle revisjonsbevis
				</Heading>
				{isCompleted ? (
					<Tag variant="success" size="xsmall">
						Fullført
					</Tag>
				) : (
					<Tag variant="warning" size="xsmall">
						Pågår
					</Tag>
				)}
			</HStack>

			{configuredInstances.length === 0 && (
				<Alert variant="warning" size="small">
					Ingen Oracle-instanser er konfigurert for denne applikasjonen. Konfigurer instanser i
					applikasjonsinnstillingene.
				</Alert>
			)}

			{configuredInstances.length > 0 && (
				<VStack gap="space-4">
					{/* Instance selector — auto-select when only one */}
					<HStack gap="space-4" align="end">
						{configuredInstances.length === 1 ? (
							<BodyShort size="small">
								Oracle-instans: <strong>{configuredInstances[0].instanceId.toUpperCase()}</strong>
							</BodyShort>
						) : (
							<Select
								label="Oracle-instans"
								size="small"
								value={selectedInstance}
								onChange={(e) => setSelectedInstance(e.target.value)}
								style={{ width: "14rem" }}
							>
								{configuredInstances.map((inst) => (
									<option key={inst.instanceId} value={inst.instanceId}>
										{inst.instanceId.toUpperCase()}
									</option>
								))}
							</Select>
						)}

						{hasPeriodType && (
							<>
								<DatePicker {...fromDatepicker.datepickerProps}>
									<DatePicker.Input {...fromDatepicker.inputProps} label="Fra dato" size="small" />
								</DatePicker>
								<DatePicker {...toDatepicker.datepickerProps}>
									<DatePicker.Input {...toDatepicker.inputProps} label="Til dato" size="small" />
								</DatePicker>
							</>
						)}

						<Button variant="secondary" size="small" onClick={fetchStatus} loading={isLoadingStatus}>
							Oppdater status
						</Button>
					</HStack>

					{/* Review URL */}
					{evidenceStatus?.reviewUrl && (
						<HStack gap="space-2">
							<AkselLink href={evidenceStatus.reviewUrl} target="_blank" rel="noopener noreferrer">
								<HStack gap="space-2" align="center">
									<ExternalLinkIcon aria-hidden />
									Åpne gjennomgang i pensjon-oracle-revisjon
								</HStack>
							</AkselLink>
						</HStack>
					)}

					{/* Status panel — loading */}
					{isLoadingStatus && !evidenceStatus && (
						<VStack gap="space-2">
							<Detail>Henter status fra pensjon-oracle-revisjon… (dette kan ta opptil 30 sekunder)</Detail>
							<Skeleton variant="rectangle" width="100%" height={120} />
						</VStack>
					)}

					{/* Download in progress */}
					{isDownloading && (
						<Alert variant="info" size="small">
							Henter bevis fra pensjon-oracle-revisjon… dette kan ta opptil ett minutt.
						</Alert>
					)}

					{/* Error messages */}
					{statusError && (
						<Alert variant="error" size="small">
							Kunne ikke hente status: {statusError}
						</Alert>
					)}
					{downloadError && !isDownloading && (
						<Alert variant="error" size="small">
							{downloadError}
						</Alert>
					)}

					{/* Status table */}
					{evidenceStatus && filteredEvidenceTypes.length > 0 && (
						<VStack gap="space-2">
							<BodyShort size="small">
								Tabellen under viser status for bevistyper i pensjon-oracle-revisjon. Velg format for å hente beviset
								direkte inn i denne rutinegjennomgangen.
							</BodyShort>
							<EvidenceStatusTable
								evidenceTypes={filteredEvidenceTypes}
								isDraft={isDraft && isPending}
								isDownloading={isDownloading}
								onDownload={handleDownloadAttempt}
							/>
						</VStack>
					)}

					{evidenceStatus && filteredEvidenceTypes.length === 0 && (
						<Alert variant="info" size="small">
							Ingen relevante bevistyper tilgjengelig for denne instansen.
						</Alert>
					)}

					{/* Period review progress */}
					{evidenceStatus?.evidenceTypes
						.filter(
							(et): et is EvidenceTypeStatus & { review: NonNullable<EvidenceTypeStatus["review"]> } =>
								et.type === "period" && et.review != null && evidenceTypes.includes("period"),
						)
						.map((et) => (
							<PeriodProgress key={et.type} review={et.review} />
						))}
				</VStack>
			)}

			{/* Downloaded evidence table */}
			<VStack gap="space-2">
				<Heading size="small" level="4">
					Nedlastede bevis ({downloads.length})
				</Heading>
				{downloads.length > 0 ? (
					// biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable table needs keyboard access
					<section className="table-scroll" tabIndex={0} aria-label="Nedlastede bevis">
						<Table size="small">
							<Table.Header>
								<Table.Row>
									<Table.HeaderCell>Bevistype</Table.HeaderCell>
									<Table.HeaderCell>Instans</Table.HeaderCell>
									<Table.HeaderCell>Format</Table.HeaderCell>
									<Table.HeaderCell>Kilde</Table.HeaderCell>
									<Table.HeaderCell>Størrelse</Table.HeaderCell>
									<Table.HeaderCell>Utført av</Table.HeaderCell>
									<Table.HeaderCell>Tidspunkt</Table.HeaderCell>
									<Table.HeaderCell />
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{downloads.map((d) => (
									<Table.Row key={d.id}>
										<Table.DataCell>{evidenceTypeLabels[d.evidenceType] ?? d.evidenceType}</Table.DataCell>
										<Table.DataCell>{d.apiInstanceName ?? d.instanceId.toUpperCase()}</Table.DataCell>
										<Table.DataCell>
											<Tag variant="neutral" size="xsmall">
												{d.format.toUpperCase()}
											</Tag>
										</Table.DataCell>
										<Table.DataCell>
											<VStack gap="space-1">
												{d.source === "m2m_api" ? (
													<Tag variant="info" size="xsmall">
														Hentet automatisk
													</Tag>
												) : (
													<Tag variant="alt1" size="xsmall">
														Lastet opp manuelt
													</Tag>
												)}
												{d.forceFetchJustification && <Detail>Begrunnelse: {d.forceFetchJustification}</Detail>}
											</VStack>
										</Table.DataCell>
										<Table.DataCell>{formatFileSize(d.sizeBytes)}</Table.DataCell>
										<Table.DataCell>{d.performedBy}</Table.DataCell>
										<Table.DataCell>{formatDate(d.performedAt)}</Table.DataCell>
										<Table.DataCell>
											<Button
												as="a"
												href={`/api/oracle-evidence-file/${d.id}`}
												variant="tertiary"
												size="xsmall"
												icon={<DownloadIcon aria-hidden />}
											>
												Last ned
											</Button>
										</Table.DataCell>
									</Table.Row>
								))}
							</Table.Body>
						</Table>
					</section>
				) : (
					<BodyShort size="small">Ingen bevis lastet ned ennå.</BodyShort>
				)}
			</VStack>

			{/* Force-fetch modal */}
			<ForceFetchModal
				open={forceFetchState.open}
				onClose={() => setForceFetchState({ open: false, evidenceType: "", format: "", status: "" })}
				onConfirm={handleForceFetchConfirm}
				evidenceType={forceFetchState.evidenceType}
				status={forceFetchState.status}
			/>
		</VStack>
	)
}

// ─── Sub-components ───────────────────────────────────────────────────────

function EvidenceStatusTable({
	evidenceTypes,
	isDraft,
	isDownloading,
	onDownload,
}: {
	evidenceTypes: EvidenceTypeStatus[]
	isDraft: boolean
	isDownloading: boolean
	onDownload: (type: string, format: string) => void
}) {
	return (
		// biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable table needs keyboard access
		<section className="table-scroll" tabIndex={0} aria-label="Status for bevistyper">
			<Table size="small">
				<Table.Header>
					<Table.Row>
						<Table.HeaderCell>Bevistype</Table.HeaderCell>
						<Table.HeaderCell>Status</Table.HeaderCell>
						<Table.HeaderCell>Tilgjengelig</Table.HeaderCell>
						{isDraft && <Table.HeaderCell>Handlinger</Table.HeaderCell>}
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{evidenceTypes.map((et) => (
						<Table.Row key={et.type}>
							<Table.DataCell>
								<VStack gap="space-1">
									<BodyShort size="small" weight="semibold">
										{et.title}
									</BodyShort>
								</VStack>
							</Table.DataCell>
							<Table.DataCell>
								<Tag variant={statusVariant(et.status)} size="xsmall">
									{statusLabel(et.status)}
								</Tag>
								{et.error && <Detail style={{ color: "var(--ax-text-danger)" }}>{et.error}</Detail>}
							</Table.DataCell>
							<Table.DataCell>
								{et.available ? (
									<Tag variant="success" size="xsmall">
										Ja
									</Tag>
								) : (
									<Tag variant="neutral" size="xsmall">
										Nei
									</Tag>
								)}
							</Table.DataCell>
							{isDraft && (
								<Table.DataCell>
									<HStack gap="space-2">
										{et.formats.map((fmt) => (
											<Button
												key={fmt}
												variant="tertiary"
												size="xsmall"
												onClick={() => onDownload(et.type, fmt.toLowerCase())}
												loading={isDownloading}
												disabled={!et.available || isDownloading}
											>
												Hent {fmt}
											</Button>
										))}
									</HStack>
								</Table.DataCell>
							)}
						</Table.Row>
					))}
				</Table.Body>
			</Table>
		</section>
	)
}

function PeriodProgress({ review }: { review: NonNullable<EvidenceTypeStatus["review"]> }) {
	const progressPct = review.reviewProgress.toFixed(1)
	return (
		<Alert variant={review.reviewProgress >= 100 ? "success" : "info"} size="small">
			<VStack gap="space-1">
				<BodyShort size="small" weight="semibold">
					Gjennomgangsprogresjon: {progressPct}%
				</BodyShort>
				<BodyShort size="small">
					{review.reviewedStatements.toLocaleString("nb-NO")} av {review.totalStatements.toLocaleString("nb-NO")}{" "}
					skriveoperasjoner gjennomgått ({review.unreviewedStatements.toLocaleString("nb-NO")} gjenstår)
				</BodyShort>
				{review.syncWatermarkUtc && (
					<Detail>
						Siste synkronisering: {formatDate(review.syncWatermarkUtc)}
						{!review.periodFullySynced && " — perioden er ikke ferdig synkronisert"}
					</Detail>
				)}
			</VStack>
		</Alert>
	)
}
