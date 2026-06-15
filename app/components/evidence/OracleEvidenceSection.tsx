import { ExternalLinkIcon } from "@navikt/aksel-icons"
import {
	Link as AkselLink,
	Alert,
	BodyShort,
	Button,
	DatePicker,
	Detail,
	Heading,
	HStack,
	Select,
	Skeleton,
	Tag,
	useDatepicker,
	VStack,
} from "@navikt/ds-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { useFetcher, useRevalidator } from "react-router"
import type { EvidenceItemStatus, EvidenceStatusResponse } from "~/lib/evidence-providers/types"
import { getProviderUiConfig } from "~/lib/evidence-providers/ui-config"
import type { EvidenceDownload } from "./DownloadedEvidenceTable"
import { DownloadedEvidenceTable } from "./DownloadedEvidenceTable"
import { EvidenceStatusTable } from "./EvidenceStatusTable"
import { ForceFetchModal } from "./ForceFetchModal"

// ─── Types ────────────────────────────────────────────────────────────────

interface PeriodReview {
	totalStatements: number
	reviewedStatements: number
	unreviewedStatements: number
	reviewProgress: number
	syncWatermarkUtc?: string | null
	periodFullySynced?: boolean
}

interface ActivityProp {
	id: string
	type: string
	status: string
	completedAt: string | null
	createdAt: string
}

export interface OracleEvidenceDataProp {
	configuredInstances: Array<{ instanceId: string }>
	selectedInstanceId?: string | null
	downloads: EvidenceDownload[]
	evidenceTypes: string[]
}

interface Props {
	activity: ActivityProp
	oracleEvidenceData: OracleEvidenceDataProp
	isDraft: boolean
	preview?: boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
	return new Date(dateStr).toLocaleDateString("nb-NO", {
		day: "2-digit",
		month: "2-digit",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	})
}

const config = getProviderUiConfig("oracle")

// ─── Component ────────────────────────────────────────────────────────────

export function OracleEvidenceSection({ activity, oracleEvidenceData, isDraft, preview = false }: Props) {
	const { configuredInstances, selectedInstanceId, downloads, evidenceTypes } = oracleEvidenceData
	const [selectedInstance, setSelectedInstance] = useState<string>(
		selectedInstanceId ?? configuredInstances[0]?.instanceId ?? "",
	)
	const isConfiguredInstanceLocked = !!selectedInstanceId
	const [fromDate, setFromDate] = useState<string>("")
	const [toDate, setToDate] = useState<string>("")
	const [forceFetchState, setForceFetchState] = useState<{
		open: boolean
		evidenceType: string
		format: string
		status: EvidenceItemStatus
	}>({ open: false, evidenceType: "", format: "", status: "pending" })

	const statusFetcher = useFetcher<EvidenceStatusResponse | { error: string }>()
	const downloadFetcher = useFetcher()
	const revalidator = useRevalidator()

	const isCompleted = activity.status === "completed"
	const isPending = activity.status === "pending"
	const showDateFilters = config.showDateFilters(evidenceTypes)

	const statusFetcherRef = useRef(statusFetcher)
	statusFetcherRef.current = statusFetcher

	const fetchStatus = useCallback(() => {
		if (!selectedInstance) return
		const params = new URLSearchParams({ instanceId: selectedInstance, activityId: activity.id })
		if (fromDate) params.set("fromUtc", fromDate)
		if (toDate) params.set("toUtc", toDate)
		statusFetcherRef.current.load(`/api/evidence-status?providerType=oracle&${params.toString()}`)
	}, [selectedInstance, fromDate, toDate, activity.id])

	useEffect(() => {
		if (preview) return
		if (selectedInstance) {
			fetchStatus()
		}
	}, [selectedInstance, fetchStatus, preview])

	const statusFetcherData = statusFetcher.data
	const evidenceStatus =
		statusFetcherData && "items" in statusFetcherData ? (statusFetcherData as EvidenceStatusResponse) : undefined
	const statusError =
		statusFetcherData && "error" in statusFetcherData ? (statusFetcherData as { error: string }).error : undefined
	const isLoadingStatus = statusFetcher.state === "loading"

	const downloadError =
		downloadFetcher.data && "error" in downloadFetcher.data
			? (downloadFetcher.data as { error: string }).error
			: undefined

	const filteredEvidenceTypes = evidenceStatus?.items.filter((et) => evidenceTypes.includes(et.id)) ?? []

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

			formData.set("providerType", "oracle")
			downloadFetcher.submit(formData, { method: "POST", action: "/api/evidence-download" })
		},
		[evidenceStatus, selectedInstance, activity.id, fromDate, toDate, downloadFetcher],
	)

	const handleDownloadAttempt = useCallback(
		(evidenceType: string, format: string) => {
			const etStatus = filteredEvidenceTypes.find((et) => et.id === evidenceType)
			if (!etStatus?.canDownload) return
			if (etStatus.status !== "ok") {
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
			setForceFetchState({ open: false, evidenceType: "", format: "", status: "pending" })
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
					{config.heading}
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
					{config.noInstancesWarning}
				</Alert>
			)}

			{configuredInstances.length > 0 && (
				<VStack gap="space-4">
					<HStack gap="space-4" align="end">
						{isConfiguredInstanceLocked ? (
							<BodyShort size="small">
								{config.instanceLabel}: <strong>{config.formatInstanceId(selectedInstanceId)}</strong>
							</BodyShort>
						) : configuredInstances.length === 1 ? (
							<BodyShort size="small">
								{config.instanceLabel}: <strong>{config.formatInstanceId(configuredInstances[0].instanceId)}</strong>
							</BodyShort>
						) : (
							<Select
								label={config.instanceLabel}
								size="small"
								value={selectedInstance}
								onChange={(e) => setSelectedInstance(e.target.value)}
								style={{ width: "14rem" }}
							>
								{configuredInstances.map((inst) => (
									<option key={inst.instanceId} value={inst.instanceId}>
										{config.formatInstanceId(inst.instanceId)}
									</option>
								))}
							</Select>
						)}

						{showDateFilters && (
							<>
								<DatePicker {...fromDatepicker.datepickerProps}>
									<DatePicker.Input {...fromDatepicker.inputProps} label="Fra dato" size="small" />
								</DatePicker>
								<DatePicker {...toDatepicker.datepickerProps}>
									<DatePicker.Input {...toDatepicker.inputProps} label="Til dato" size="small" />
								</DatePicker>
							</>
						)}

						<Button variant="secondary" size="small" onClick={fetchStatus} loading={isLoadingStatus} disabled={preview}>
							Oppdater status
						</Button>
					</HStack>

					{evidenceStatus?.externalUrl && (
						<HStack gap="space-2">
							<AkselLink href={evidenceStatus.externalUrl} target="_blank" rel="noopener noreferrer">
								<HStack gap="space-2" align="center">
									<ExternalLinkIcon aria-hidden />
									{config.externalLinkLabel}
								</HStack>
							</AkselLink>
						</HStack>
					)}

					{isLoadingStatus && !evidenceStatus && (
						<VStack gap="space-2">
							<Detail>{config.loadingMessage}</Detail>
							<Skeleton variant="rectangle" width="100%" height={120} />
						</VStack>
					)}

					{isDownloading && (
						<Alert variant="info" size="small">
							{config.downloadingMessage}
						</Alert>
					)}

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

					{evidenceStatus && filteredEvidenceTypes.length > 0 && (
						<VStack gap="space-2">
							<BodyShort size="small">{config.statusTableDescription}</BodyShort>
							<EvidenceStatusTable
								evidenceTypes={filteredEvidenceTypes}
								showActions={!preview && isDraft && isPending}
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

					{evidenceStatus?.items
						.filter(
							(et): et is typeof et & { details: { review: PeriodReview } } =>
								et.id === "period" && et.details?.review != null && evidenceTypes.includes("period"),
						)
						.map((et) => (
							<PeriodProgress key={et.id} review={et.details.review} />
						))}
				</VStack>
			)}

			<DownloadedEvidenceTable
				downloads={downloads}
				evidenceTypeLabels={config.evidenceTypeLabels}
				formatInstanceId={config.formatInstanceId}
				preview={preview}
			/>

			<ForceFetchModal
				open={forceFetchState.open}
				onClose={() => setForceFetchState({ open: false, evidenceType: "", format: "", status: "pending" })}
				onConfirm={handleForceFetchConfirm}
				evidenceTypeLabel={config.evidenceTypeLabels[forceFetchState.evidenceType] ?? forceFetchState.evidenceType}
				status={forceFetchState.status}
			/>
		</VStack>
	)
}

// ─── Oracle-specific sub-components ───────────────────────────────────────

function PeriodProgress({ review }: { review: PeriodReview }) {
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
