/**
 * Deployment evidence section for NDA audit reports.
 *
 * Handles the full lifecycle:
 * 1. Period selection (if not yet chosen)
 * 2. Status display with deployment statistics
 * 3. Report generation with async polling
 * 4. Report download and display of existing downloads
 */

import {
	Alert,
	BodyShort,
	Button,
	Detail,
	Heading,
	HStack,
	Loader,
	ReadMore,
	Table,
	Tag,
	VStack,
} from "@navikt/ds-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { useFetcher, useRevalidator } from "react-router"
import type { EvidenceStatusResponse } from "~/lib/evidence-providers/types"
import { getProviderUiConfig } from "~/lib/evidence-providers/ui-config"
import { EvidenceStatusBadge } from "./EvidenceStatusBadge"
import { PeriodSelector } from "./PeriodSelector"

export interface NdaEvidenceDataProp {
	appParams: { team: string; environment: string; appName: string } | null
	periodConfig: { periodType: string; periodStart: string } | null
	downloads: Array<{
		id: string
		format: string
		fileName: string
		sizeBytes: number | null
		source: string
		forceFetchJustification: string | null
		performedBy: string
		performedAt: string
	}>
}

interface ActivityProp {
	id: string
	type: string
	status: string
	completedAt: string | null
	createdAt: string
}

interface Props {
	activity: ActivityProp
	evidenceData: NdaEvidenceDataProp
	isDraft: boolean
}

export function DeploymentEvidenceSection({ activity, evidenceData, isDraft }: Props) {
	const config = getProviderUiConfig("deployments")
	const revalidator = useRevalidator()
	const { appParams, periodConfig, downloads } = evidenceData

	if (!appParams) {
		return (
			<VStack gap="space-4">
				<Heading size="medium" level="3">
					{config.heading}
				</Heading>
				<Alert variant="warning">{config.noInstancesWarning}</Alert>
				{downloads.length > 0 && <NdaDownloadsTable downloads={downloads} />}
			</VStack>
		)
	}

	return (
		<VStack gap="space-4">
			<Heading size="medium" level="3">
				{config.heading}
			</Heading>

			{!periodConfig ? (
				<>
					<PeriodSelector activityId={activity.id} onSaved={() => revalidator.revalidate()} />
					{downloads.length > 0 && <NdaDownloadsTable downloads={downloads} />}
				</>
			) : (
				<DeploymentStatusPanel
					activity={activity}
					appParams={appParams}
					periodConfig={periodConfig}
					downloads={downloads}
					isDraft={isDraft}
					config={config}
				/>
			)}
		</VStack>
	)
}

// ─── Status Panel (shown after period is selected) ──────────────────────────

interface StatusPanelProps {
	activity: ActivityProp
	appParams: { team: string; environment: string; appName: string }
	periodConfig: { periodType: string; periodStart: string }
	downloads: NdaEvidenceDataProp["downloads"]
	isDraft: boolean
	config: ReturnType<typeof getProviderUiConfig>
}

function DeploymentStatusPanel({ activity, appParams, periodConfig, downloads, isDraft, config }: StatusPanelProps) {
	const statusFetcher = useFetcher<EvidenceStatusResponse | { error: string }>()
	const generateFetcher = useFetcher()
	const downloadFetcher = useFetcher()
	const revalidator = useRevalidator()

	const [jobId, setJobId] = useState<string | null>(null)
	const [jobStatus, setJobStatus] = useState<string | null>(null)
	const [generateError, setGenerateError] = useState<string | null>(null)
	const [pollError, setPollError] = useState<string | null>(null)
	const pollIntervalRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const pollFailCountRef = useRef(0)
	const MAX_POLL_FAILURES = 3

	// Fetch status on mount
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentionally mount-only
	useEffect(() => {
		if (statusFetcher.state === "idle" && !statusFetcher.data) {
			const params = new URLSearchParams({
				providerType: "deployments",
				activityId: activity.id,
				team: appParams.team,
				environment: appParams.environment,
				appName: appParams.appName,
				periodType: periodConfig.periodType,
				periodStart: periodConfig.periodStart,
			})
			statusFetcher.load(`/api/evidence-status?${params.toString()}`)
		}
	}, []) // eslint-disable-line react-hooks/exhaustive-deps

	const refreshStatus = useCallback(() => {
		const params = new URLSearchParams({
			providerType: "deployments",
			activityId: activity.id,
			team: appParams.team,
			environment: appParams.environment,
			appName: appParams.appName,
			periodType: periodConfig.periodType,
			periodStart: periodConfig.periodStart,
		})
		statusFetcher.load(`/api/evidence-status?${params.toString()}`)
	}, [activity.id, appParams, periodConfig, statusFetcher])

	// Handle generate response
	useEffect(() => {
		if (generateFetcher.data && typeof generateFetcher.data === "object") {
			const data = generateFetcher.data as { jobId?: string; error?: string; conflict?: boolean }
			if (data.jobId) {
				setJobId(data.jobId)
				setJobStatus("pending")
				setGenerateError(null)
				setPollError(null)
			} else if (data.error || data.conflict) {
				setGenerateError(
					data.conflict
						? "Det finnes allerede en rapport for denne perioden."
						: (data.error ?? "Ukjent feil ved rapportgenerering"),
				)
			}
		}
	}, [generateFetcher.data])

	// Revalidate after successful download
	// biome-ignore lint/correctness/useExhaustiveDependencies: trigger on downloadFetcher state change
	useEffect(() => {
		if (downloadFetcher.state === "idle" && downloadFetcher.data) {
			const result = downloadFetcher.data as { success?: boolean }
			if (result.success) {
				revalidator.revalidate()
			}
		}
	}, [downloadFetcher.state, downloadFetcher.data])

	// Poll job status with setTimeout loop (prevents overlapping requests)
	useEffect(() => {
		if (!jobId || jobStatus === "completed" || jobStatus === "failed") {
			return
		}

		let cancelled = false
		pollFailCountRef.current = 0

		const pollJob = async () => {
			try {
				const formData = new FormData()
				formData.set("providerType", "deployments")
				formData.set("activityId", activity.id)
				formData.set("team", appParams.team)
				formData.set("environment", appParams.environment)
				formData.set("appName", appParams.appName)
				formData.set("periodType", periodConfig.periodType)
				formData.set("periodStart", periodConfig.periodStart)
				formData.set("jobId", jobId)
				formData.set("intent", "poll-job")
				const response = await fetch("/api/evidence-download", {
					method: "POST",
					body: formData,
				})
				if (response.ok) {
					pollFailCountRef.current = 0
					const result = (await response.json()) as { status: string; reportId?: string }
					setJobStatus(result.status)
					if (result.status === "completed") {
						refreshStatus()
						revalidator.revalidate()
						return
					}
				} else {
					pollFailCountRef.current++
					if (pollFailCountRef.current >= MAX_POLL_FAILURES) {
						setPollError("Kunne ikke sjekke jobbstatus. Prøv å oppdatere status manuelt.")
						setJobStatus("failed")
						return
					}
				}
			} catch {
				pollFailCountRef.current++
				if (pollFailCountRef.current >= MAX_POLL_FAILURES) {
					setPollError("Mistet kontakt med serveren under polling. Prøv å oppdatere status manuelt.")
					setJobStatus("failed")
					return
				}
			}
			if (!cancelled) {
				pollIntervalRef.current = setTimeout(pollJob, 10_000)
			}
		}

		pollJob()

		return () => {
			cancelled = true
			if (pollIntervalRef.current) {
				clearTimeout(pollIntervalRef.current)
			}
		}
	}, [jobId, jobStatus, activity.id, appParams, periodConfig, refreshStatus, revalidator])

	const status = statusFetcher.data
	const statusError = status != null && "error" in status && !("providerType" in status) ? status.error : null
	const validStatus = status != null && "providerType" in status ? status : null
	const isLoadingStatus = statusFetcher.state === "loading"
	const isGenerating = generateFetcher.state !== "idle" || jobStatus === "pending" || jobStatus === "processing"

	return (
		<VStack gap="space-4">
			<HStack gap="space-4" align="center">
				<Tag variant="neutral" size="small">
					{appParams.team}/{appParams.appName} ({appParams.environment})
				</Tag>
				<Tag variant="info" size="small">
					{periodConfig.periodType === "yearly" && "Årlig"}
					{periodConfig.periodType === "tertiary" && "Tertialsvis"}
					{periodConfig.periodType === "quarterly" && "Kvartalsvis"}
					{periodConfig.periodType === "monthly" && "Månedlig"}
					{" — "}
					{periodConfig.periodStart}
				</Tag>
				<Button variant="tertiary" size="xsmall" onClick={refreshStatus} loading={isLoadingStatus}>
					Oppdater status
				</Button>
			</HStack>

			{isLoadingStatus && !validStatus && !statusError && (
				<HStack gap="space-2" align="center">
					<Loader size="small" />
					<BodyShort size="small">{config.loadingMessage}</BodyShort>
				</HStack>
			)}

			{statusError && (
				<Alert variant="warning" size="small">
					{statusError}
				</Alert>
			)}

			{validStatus && (
				<>
					{validStatus.metadata?.error && (
						<Alert variant="warning" size="small">
							{validStatus.metadata.error as string}
						</Alert>
					)}

					{!validStatus.metadata?.error && <DeploymentStats metadata={validStatus.metadata} />}

					{validStatus.items.length > 0 && (
						<Table size="small">
							<Table.Header>
								<Table.Row>
									<Table.HeaderCell>Bevistype</Table.HeaderCell>
									<Table.HeaderCell>Status</Table.HeaderCell>
									<Table.HeaderCell>Formater</Table.HeaderCell>
									<Table.HeaderCell />
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{validStatus.items.map((item) => (
									<Table.Row key={item.id}>
										<Table.DataCell>{item.label}</Table.DataCell>
										<Table.DataCell>
											<EvidenceStatusBadge status={item.status} />
										</Table.DataCell>
										<Table.DataCell>{(item.formats ?? []).join(", ").toUpperCase()}</Table.DataCell>
										<Table.DataCell>
											{item.canDownload && isDraft && (
												<ExistingReportActions
													metadata={validStatus.metadata}
													downloadFetcher={downloadFetcher}
													activity={activity}
													appParams={appParams}
													periodConfig={periodConfig}
												/>
											)}
										</Table.DataCell>
									</Table.Row>
								))}
							</Table.Body>
						</Table>
					)}

					{isDraft && !validStatus.metadata?.error && (
						<HStack gap="space-2">
							<Button
								size="small"
								variant="secondary"
								onClick={() => {
									const formData = new FormData()
									formData.set("providerType", "deployments")
									formData.set("activityId", activity.id)
									formData.set("team", appParams.team)
									formData.set("environment", appParams.environment)
									formData.set("appName", appParams.appName)
									formData.set("periodType", periodConfig.periodType)
									formData.set("periodStart", periodConfig.periodStart)
									formData.set("intent", "generate-report")
									generateFetcher.submit(formData, {
										method: "post",
										action: "/api/evidence-download",
									})
								}}
								loading={isGenerating}
								disabled={isGenerating}
							>
								{isGenerating ? "Genererer rapport…" : "Generer ny rapport"}
							</Button>
						</HStack>
					)}

					{isGenerating && jobStatus && (
						<HStack gap="space-2" align="center">
							<Loader size="small" />
							<BodyShort size="small">
								{jobStatus === "pending" && "Rapportgenerering startet, venter på behandling…"}
								{jobStatus === "processing" && "Rapport genereres… dette kan ta opptil ett minutt."}
							</BodyShort>
						</HStack>
					)}

					{jobStatus === "failed" && (
						<Alert variant="error" size="small">
							{pollError ?? "Rapportgenerering feilet. Prøv igjen."}
						</Alert>
					)}

					{generateError && (
						<Alert variant="warning" size="small">
							{generateError}
						</Alert>
					)}
				</>
			)}

			{downloads.length > 0 && <NdaDownloadsTable downloads={downloads} />}
		</VStack>
	)
}

// ─── Deployment Statistics ──────────────────────────────────────────────────

function DeploymentStats({ metadata }: { metadata: Record<string, unknown> }) {
	const deployments = metadata.deployments as
		| {
				total: number
				approved: number
				pending: number
				notApproved: number
				approvedPercent: number
				withChangeOrigin: number
				changeOriginPercent: number
		  }
		| undefined

	if (!deployments) return null

	return (
		<ReadMore header="Leveransestatistikk" size="small" defaultOpen>
			<Table size="small">
				<Table.Body>
					<Table.Row>
						<Table.DataCell>Totalt antall leveranser</Table.DataCell>
						<Table.DataCell align="right">{deployments.total}</Table.DataCell>
					</Table.Row>
					<Table.Row>
						<Table.DataCell>Godkjente (fire øyne)</Table.DataCell>
						<Table.DataCell align="right">
							{deployments.approved} ({deployments.approvedPercent}%)
						</Table.DataCell>
					</Table.Row>
					<Table.Row>
						<Table.DataCell>Ikke godkjente</Table.DataCell>
						<Table.DataCell align="right">{deployments.notApproved}</Table.DataCell>
					</Table.Row>
					<Table.Row>
						<Table.DataCell>Ventende</Table.DataCell>
						<Table.DataCell align="right">{deployments.pending}</Table.DataCell>
					</Table.Row>
					<Table.Row>
						<Table.DataCell>Med endringsopphav</Table.DataCell>
						<Table.DataCell align="right">
							{deployments.withChangeOrigin} ({deployments.changeOriginPercent}%)
						</Table.DataCell>
					</Table.Row>
				</Table.Body>
			</Table>
		</ReadMore>
	)
}

// ─── Existing Report Actions ────────────────────────────────────────────────

function ExistingReportActions({
	metadata,
	downloadFetcher,
	activity,
	appParams,
	periodConfig,
}: {
	metadata: Record<string, unknown>
	downloadFetcher: ReturnType<typeof useFetcher>
	activity: ActivityProp
	appParams: { team: string; environment: string; appName: string }
	periodConfig: { periodType: string; periodStart: string }
}) {
	const existingReports = (metadata.existingReports ?? []) as Array<{
		reportId: string
		generatedAt: string
		availableFormats: string[]
	}>

	if (existingReports.length === 0) return null

	const isDownloading = downloadFetcher.state !== "idle"

	return (
		<HStack gap="space-2">
			{existingReports.map((report) =>
				report.availableFormats.map((format) => (
					<Button
						key={`${report.reportId}-${format}`}
						size="xsmall"
						variant="tertiary"
						loading={isDownloading}
						onClick={() => {
							const formData = new FormData()
							formData.set("intent", "download-from-api")
							formData.set("providerType", "deployments")
							formData.set("activityId", activity.id)
							formData.set("evidenceType", "deployment_evidence_report")
							formData.set("format", format)
							formData.set("team", appParams.team)
							formData.set("environment", appParams.environment)
							formData.set("appName", appParams.appName)
							formData.set("periodType", periodConfig.periodType)
							formData.set("periodStart", periodConfig.periodStart)
							formData.set("reportId", report.reportId)
							downloadFetcher.submit(formData, {
								method: "post",
								action: "/api/evidence-download",
							})
						}}
					>
						Hent {format.toUpperCase()}
					</Button>
				)),
			)}
		</HStack>
	)
}

// ─── Downloads Table ────────────────────────────────────────────────────────

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

function NdaDownloadsTable({ downloads }: { downloads: NdaEvidenceDataProp["downloads"] }) {
	return (
		<VStack gap="space-2">
			<Heading size="small" level="4">
				Nedlastede rapporter ({downloads.length})
			</Heading>
			{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable table needs keyboard access */}
			<section className="table-scroll" tabIndex={0} aria-label="Nedlastede leveranserapporter">
				<Table size="small">
					<Table.Header>
						<Table.Row>
							<Table.HeaderCell>Filnavn</Table.HeaderCell>
							<Table.HeaderCell>Format</Table.HeaderCell>
							<Table.HeaderCell>Størrelse</Table.HeaderCell>
							<Table.HeaderCell>Kilde</Table.HeaderCell>
							<Table.HeaderCell>Hentet av</Table.HeaderCell>
							<Table.HeaderCell>Tidspunkt</Table.HeaderCell>
							<Table.HeaderCell />
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{downloads.map((d) => (
							<Table.Row key={d.id}>
								<Table.DataCell>{d.fileName}</Table.DataCell>
								<Table.DataCell>
									<Tag variant="neutral" size="xsmall">
										{d.format.toUpperCase()}
									</Tag>
								</Table.DataCell>
								<Table.DataCell>{formatFileSize(d.sizeBytes)}</Table.DataCell>
								<Table.DataCell>
									<Tag variant={d.source === "m2m_api" ? "info" : "neutral"} size="xsmall">
										{d.source === "m2m_api" ? "Automatisk" : "Manuell"}
									</Tag>
								</Table.DataCell>
								<Table.DataCell>
									<Detail>{d.performedBy}</Detail>
								</Table.DataCell>
								<Table.DataCell>
									<Detail>{formatDate(d.performedAt)}</Detail>
								</Table.DataCell>
								<Table.DataCell>
									<a href={`/api/evidence-file/${d.id}`} download>
										Last ned
									</a>
								</Table.DataCell>
							</Table.Row>
						))}
					</Table.Body>
				</Table>
			</section>
			{downloads.some((d) => d.forceFetchJustification) && (
				<Alert variant="info" size="small">
					Noen rapporter ble hentet med begrunnelse selv om godkjenningskrav ikke var oppfylt.
				</Alert>
			)}
		</VStack>
	)
}
