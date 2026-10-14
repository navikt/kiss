/**
 * Deployment evidence section for NDA audit reports.
 *
 * Shows generated report snapshots and saves the report files as evidence when
 * the review is completed.
 */

import { Alert, BodyShort, Button, Detail, Heading, HStack, Link, Loader, Table, Tag, VStack } from "@navikt/ds-react"
import { useCallback, useEffect, useState } from "react"
import { useFetcher, useRevalidator } from "react-router"
import type { NdaReportGenerationState, NdaReportSnapshot, PeriodConfig } from "~/db/schema/routines"
import {
	getNdaReportGenerationDeadline,
	isNdaReportGenerationInProgress,
	isNdaReportGenerationStale,
} from "~/lib/nda-report-generation"
import { PeriodSelector } from "./PeriodSelector"

export interface NdaEvidenceDataProp {
	apps: Array<{ applicationId: string; team: string; environment: string; appName: string }>
	periodConfig: PeriodConfig | null
	downloads: Array<{
		id: string
		format: string
		fileName: string
		sizeBytes: number | null
		source: string
		forceFetchJustification: string | null
		performedBy: string
		performedAt: string
		team: string
		environment: string
		appName: string
		periodType: string
		periodStart: string
		reportId: string | null
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
	preview?: boolean
}

type GenerationMode = "initial" | "refresh"
type GenerationResponse = { success?: boolean; error?: string }

export function DeploymentEvidenceSection({ activity, evidenceData, isDraft, preview = false }: Props) {
	const { revalidate } = useRevalidator()
	const generationFetcher = useFetcher<GenerationResponse>()
	const { apps, periodConfig, downloads } = evidenceData
	const generation = periodConfig?.reportGeneration
	const generationStates = generation?.apps ?? []
	const hasPending = generationStates.some((app) => isNdaReportGenerationInProgress(app))
	const allReady =
		apps.length > 0 &&
		apps.every((app) =>
			generationStates.some(
				(state) => state.applicationId === app.applicationId && state.status === "ready" && state.report !== null,
			),
		)
	const [pollErrors, setPollErrors] = useState<Record<string, string>>({})
	const canGenerate = isDraft && !preview && activity.status === "pending"
	const isSubmitting = generationFetcher.state !== "idle"

	const startGeneration = useCallback(
		(config: { periodType: string; periodStart: string }, mode: GenerationMode) => {
			const formData = new FormData()
			formData.set("intent", "generate-report-set")
			formData.set("providerType", "deployments")
			formData.set("activityId", activity.id)
			formData.set("periodType", config.periodType)
			formData.set("periodStart", config.periodStart)
			formData.set("mode", mode)
			generationFetcher.submit(formData, { method: "post", action: "/api/evidence-download" })
			setPollErrors({})
		},
		[activity.id, generationFetcher],
	)

	useEffect(() => {
		if (generationFetcher.state === "idle" && generationFetcher.data) {
			if (generationFetcher.data.success) revalidate()
		}
	}, [generationFetcher.data, generationFetcher.state, revalidate])

	const handlePollError = useCallback((applicationId: string, error: string | null) => {
		setPollErrors((previous) => {
			if (error === null) {
				if (!(applicationId in previous)) return previous
				const next = { ...previous }
				delete next[applicationId]
				return next
			}
			return { ...previous, [applicationId]: error }
		})
	}, [])

	if (apps.length === 0) {
		return (
			<VStack gap="space-16">
				<Heading size="medium" level="3">
					Leveranserapporter fra NDA
				</Heading>
				<Alert variant="warning" size="small">
					Ingen applikasjoner er koblet til denne gjennomgangen.
				</Alert>
				{downloads.length > 0 && (
					<NdaDownloadsTable downloads={downloads} apps={apps} periodConfig={periodConfig} preview={preview} />
				)}
			</VStack>
		)
	}

	return (
		<VStack gap="space-16">
			<Heading size="medium" level="3">
				Leveranserapporter fra NDA
			</Heading>

			{canGenerate ? (
				<PeriodSelector
					currentPeriod={periodConfig}
					onSelectPeriod={(selectedPeriod) => startGeneration(selectedPeriod, "initial")}
					isSubmitting={isSubmitting}
					onRefresh={periodConfig ? () => startGeneration(periodConfig, "refresh") : undefined}
					refreshLabel={hasPending ? "Genererer rapporter" : "Generer rapporter for valgt periode"}
					refreshLoading={isSubmitting || hasPending}
					refreshDisabled={hasPending}
					periodLocked={hasPending}
				/>
			) : periodConfig ? (
				<Tag variant="info" size="small" style={{ alignSelf: "flex-start" }}>
					Valgt periode · {formatSelectedPeriod(periodConfig.periodType, periodConfig.periodStart)}
				</Tag>
			) : (
				<BodyShort>Ingen periode er valgt for denne aktiviteten.</BodyShort>
			)}

			{periodConfig && isDraft && generationStates.length > 0 && (
				<ReportSnapshotsTable
					apps={apps}
					states={generationStates}
					pollErrors={pollErrors}
					activityId={activity.id}
					periodConfig={periodConfig}
					canRetry={canGenerate}
					onPollError={handlePollError}
				/>
			)}
			{allReady && (
				<Alert variant="success" size="small">
					{isDraft
						? "Rapportene er hentet fra NDA for valgt periode. PDF og Excel lagres som bevis når gjennomgangen fullføres."
						: "Rapportene er hentet fra NDA for valgt periode og lagret som bevis."}
				</Alert>
			)}
			{generationFetcher.data?.error && (
				<Alert variant="error" size="small">
					{generationFetcher.data.error}
				</Alert>
			)}
			{canGenerate && !allReady && (
				<Alert variant="warning" size="small">
					Du kan ikke fullføre gjennomgangen før rapporter er generert for alle applikasjonene.
				</Alert>
			)}

			{!isDraft && downloads.length > 0 && (
				<VStack gap="space-8">
					<Heading size="small" level="4">
						Rapportfiler lagret som bevis ({downloads.length})
					</Heading>
					<NdaDownloadsTable downloads={downloads} apps={apps} periodConfig={periodConfig} preview={preview} />
				</VStack>
			)}
		</VStack>
	)
}

function ReportSnapshotsTable({
	apps,
	states,
	pollErrors,
	activityId,
	periodConfig,
	canRetry,
	onPollError,
}: {
	apps: NdaEvidenceDataProp["apps"]
	states: NdaReportGenerationState[]
	pollErrors: Record<string, string>
	activityId: string
	periodConfig: PeriodConfig
	canRetry: boolean
	onPollError: (applicationId: string, error: string | null) => void
}) {
	return (
		<VStack gap="space-8">
			<Heading size="small" level="4">
				Rapporter for valgt periode
			</Heading>
			{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable table needs keyboard access */}
			<section className="table-scroll" tabIndex={0} aria-label="Rapportstatus per applikasjon">
				<Table size="small">
					<Table.Header>
						<Table.Row>
							<Table.HeaderCell>Applikasjon</Table.HeaderCell>
							<Table.HeaderCell>Status</Table.HeaderCell>
							<Table.HeaderCell>Rapport</Table.HeaderCell>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{apps.map((app) => {
							const state = states.find((item) => item.applicationId === app.applicationId)
							const readyReport =
								state?.status === "ready" && state.report ? { attemptId: state.attemptId, report: state.report } : null
							return (
								<Table.Row key={app.applicationId}>
									<Table.DataCell>
										<BodyShort size="small" weight="semibold">
											{app.appName}
										</BodyShort>
										<Detail>
											{app.team} · {app.environment}
										</Detail>
									</Table.DataCell>
									<Table.DataCell>
										<ReportGenerationStatus
											state={state}
											pollError={pollErrors[app.applicationId]}
											activityId={activityId}
											periodConfig={periodConfig}
											canRetry={canRetry}
											onPollError={(error) => onPollError(app.applicationId, error)}
											onRetryStatus={() => onPollError(app.applicationId, null)}
										/>
									</Table.DataCell>
									<Table.DataCell>
										{readyReport ? (
											<VStack gap="space-8" align="start">
												<NdaReportMetrics report={readyReport.report} />
												<HStack gap="space-16" wrap>
													{readyReport.report.availableFormats.map((format) => (
														<HStack key={format} gap="space-8" align="center">
															<Detail>
																<Link
																	href={buildReportPreviewUrl({
																		activityId,
																		applicationId: app.applicationId,
																		attemptId: readyReport.attemptId,
																		reportId: readyReport.report.reportId,
																		format,
																	})}
																	target="_blank"
																	rel="noopener noreferrer"
																	aria-label={`Vis ${format.toUpperCase()}-rapport for ${app.appName} i ny fane`}
																>
																	{format.toUpperCase()}
																</Link>
															</Detail>
														</HStack>
													))}
												</HStack>
											</VStack>
										) : (
											<Detail>Vises når rapporten er ferdig</Detail>
										)}
									</Table.DataCell>
								</Table.Row>
							)
						})}
					</Table.Body>
				</Table>
			</section>
		</VStack>
	)
}

function ReportGenerationStatus({
	state,
	pollError,
	activityId,
	periodConfig,
	canRetry,
	onPollError,
	onRetryStatus,
}: {
	state: NdaReportGenerationState | undefined
	pollError: string | undefined
	activityId: string
	periodConfig: PeriodConfig
	canRetry: boolean
	onPollError: (error: string | null) => void
	onRetryStatus: () => void
}) {
	const { revalidate } = useRevalidator()
	const jobId = state?.jobId
	const team = state?.team
	const environment = state?.environment
	const appName = state?.appName
	const deadline = state ? getNdaReportGenerationDeadline(state) : 0
	const isPolling =
		canRetry &&
		!pollError &&
		state?.status === "pending" &&
		isNdaReportGenerationInProgress(state) &&
		jobId !== null &&
		jobId !== undefined

	useEffect(() => {
		if (!isPolling || !jobId || !team || !environment || !appName) return
		let cancelled = false
		let timeout: ReturnType<typeof setTimeout> | undefined
		let failures = 0

		const poll = async () => {
			if (Date.now() >= deadline) {
				revalidate()
				return
			}
			try {
				const formData = new FormData()
				formData.set("intent", "poll-job")
				formData.set("providerType", "deployments")
				formData.set("activityId", activityId)
				formData.set("team", team)
				formData.set("environment", environment)
				formData.set("appName", appName)
				formData.set("periodType", periodConfig.periodType)
				formData.set("periodStart", periodConfig.periodStart)
				formData.set("jobId", jobId)
				const response = await fetch("/api/evidence-download", { method: "POST", body: formData })
				if (cancelled) return
				if (response.status === 409) {
					revalidate()
					return
				}
				if (!response.ok) {
					failures++
					if (failures >= 3) {
						onPollError("Kunne ikke sjekke rapportstatus. Prøv å sjekke igjen.")
						return
					}
				} else {
					failures = 0
					const result: unknown = await response.json()
					if (cancelled) return
					if (
						typeof result === "object" &&
						result !== null &&
						"status" in result &&
						(result.status === "completed" || result.status === "failed")
					) {
						onPollError(null)
						revalidate()
						return
					}
					const requestedDelay =
						typeof result === "object" &&
						result !== null &&
						"retryAfterSeconds" in result &&
						typeof result.retryAfterSeconds === "number" &&
						Number.isFinite(result.retryAfterSeconds) &&
						result.retryAfterSeconds > 0
							? result.retryAfterSeconds * 1000
							: 10_000
					const delay = Math.max(0, Math.min(requestedDelay, deadline - Date.now()))
					if (!cancelled) timeout = setTimeout(poll, delay)
					return
				}
			} catch (error) {
				if (cancelled) return
				failures++
				if (failures >= 3) {
					onPollError(
						error instanceof Error
							? "Mistet kontakt med serveren under rapportgenerering. Prøv å sjekke igjen."
							: "Kunne ikke sjekke rapportstatus. Prøv å sjekke igjen.",
					)
					return
				}
			}
			if (!cancelled) timeout = setTimeout(poll, 10_000)
		}

		poll()
		return () => {
			cancelled = true
			if (timeout) clearTimeout(timeout)
		}
	}, [
		activityId,
		isPolling,
		jobId,
		onPollError,
		periodConfig.periodStart,
		periodConfig.periodType,
		revalidate,
		team,
		environment,
		appName,
		deadline,
	])

	if (pollError) {
		return (
			<VStack gap="space-8" align="start">
				<Alert variant="error" size="small">
					{pollError}
				</Alert>
				<Button type="button" size="small" variant="tertiary" onClick={onRetryStatus}>
					Sjekk status igjen
				</Button>
			</VStack>
		)
	}
	if (state?.status === "failed") {
		return (
			<VStack gap="space-8" align="start">
				<Tag variant="error" size="small">
					Kunne ikke hente rapport
				</Tag>
				{state.error && <Detail>{state.error}</Detail>}
			</VStack>
		)
	}
	if (state && isNdaReportGenerationStale(state)) {
		return (
			<VStack gap="space-8" align="start">
				<Tag variant="error" size="small">
					Rapportgenerering ble ikke fullført
				</Tag>
				<Detail>Generer rapportene på nytt.</Detail>
			</VStack>
		)
	}
	if (state?.status === "ready")
		return (
			<Tag variant="success" size="small">
				Klar
			</Tag>
		)
	if (state?.status === "pending") {
		return (
			<HStack gap="space-8" align="center">
				<Loader size="small" title="Henter rapport fra NDA" />
				<BodyShort size="small">Henter rapport fra NDA</BodyShort>
			</HStack>
		)
	}
	if (state?.status === "starting") {
		return (
			<HStack gap="space-8" align="center">
				<Loader size="small" title="Starter rapportgenerering" />
				<BodyShort size="small">Starter rapportgenerering</BodyShort>
			</HStack>
		)
	}
	return <Detail>Venter på rapportgenerering</Detail>
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

function NdaReportMetrics({ report }: { report: NdaReportSnapshot }) {
	return (
		<VStack gap="space-8" align="start">
			<Detail>
				{report.approvedCount.toLocaleString("nb-NO")} av {report.totalDeployments.toLocaleString("nb-NO")} leveranser{" "}
				godkjent
			</Detail>
			{report.withChangeOriginCount !== null && (
				<Detail>
					{report.withChangeOriginCount.toLocaleString("nb-NO")} av {report.totalDeployments.toLocaleString("nb-NO")}{" "}
					leveranser har endringsopphav
				</Detail>
			)}
		</VStack>
	)
}

type NdaEvidenceDownload = NdaEvidenceDataProp["downloads"][number]

function groupNdaEvidenceDownloads(downloads: NdaEvidenceDownload[], periodConfig: PeriodConfig | null) {
	const groups = new Map<string, { first: NdaEvidenceDownload; downloads: NdaEvidenceDownload[] }>()

	for (const download of downloads) {
		const hasAppIdentity = Boolean(download.team && download.environment && download.appName)
		const reportIdentity = download.reportId ?? (hasAppIdentity ? "same-period" : download.id)
		const key = JSON.stringify([
			download.team,
			download.environment,
			download.appName,
			download.periodType,
			download.periodStart,
			reportIdentity,
		])
		const group = groups.get(key)
		if (group) {
			group.downloads.push(download)
		} else {
			groups.set(key, { first: download, downloads: [download] })
		}
	}

	return [...groups.entries()].map(([key, group]) => {
		const report = group.first.reportId
			? (periodConfig?.reportGeneration?.apps.find(
					(state) =>
						state.status === "ready" &&
						state.report?.reportId === group.first.reportId &&
						state.team === group.first.team &&
						state.environment === group.first.environment &&
						state.appName === group.first.appName,
				)?.report ?? null)
			: null
		return { key, ...group, report }
	})
}

function NdaDownloadsTable({
	downloads,
	apps,
	periodConfig,
	preview = false,
}: {
	downloads: NdaEvidenceDataProp["downloads"]
	apps: NdaEvidenceDataProp["apps"]
	periodConfig: PeriodConfig | null
	preview?: boolean
}) {
	if (downloads.length === 0) return null
	const reportGroups = groupNdaEvidenceDownloads(downloads, periodConfig)

	return (
		<VStack gap="space-8">
			{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable table needs keyboard access */}
			<section className="table-scroll" tabIndex={0} aria-label="Rapportfiler lagret som bevis">
				<Table size="small">
					<Table.Header>
						<Table.Row>
							<Table.HeaderCell>Applikasjon</Table.HeaderCell>
							<Table.HeaderCell>Rapport</Table.HeaderCell>
							<Table.HeaderCell>Format</Table.HeaderCell>
							<Table.HeaderCell>Registrert</Table.HeaderCell>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{reportGroups.map((group) => {
							const download = group.first
							const isHistorical = !apps.some(
								(app) =>
									download.team === app.team &&
									download.environment === app.environment &&
									download.appName === app.appName,
							)
							const periodDetail = getDownloadPeriodDetail(download, periodConfig)
							const registrationDetails = [
								...new Set(group.downloads.map((file) => `${file.performedBy} · ${formatDate(file.performedAt)}`)),
							]

							return (
								<Table.Row key={group.key}>
									<Table.DataCell>
										<BodyShort size="small" weight="semibold">
											{download.appName}
										</BodyShort>
										<Detail>
											{download.team} · {download.environment}
										</Detail>
										{isHistorical && <Detail>Tidligere applikasjonsoppsett</Detail>}
									</Table.DataCell>
									<Table.DataCell>
										{group.report ? <NdaReportMetrics report={group.report} /> : <Detail>–</Detail>}
									</Table.DataCell>
									<Table.DataCell>
										<HStack gap="space-16" wrap>
											{group.downloads.map((file) =>
												preview ? (
													<Detail key={file.id}>{file.format.toUpperCase()}</Detail>
												) : (
													<Detail key={file.id}>
														<Link
															href={`/api/evidence-file/${file.id}?view=true`}
															target="_blank"
															rel="noopener noreferrer"
															aria-label={`Vis ${file.format.toUpperCase()}-rapport for ${download.appName} i ny fane`}
														>
															{file.format.toUpperCase()}
														</Link>
													</Detail>
												),
											)}
										</HStack>
									</Table.DataCell>
									<Table.DataCell>
										<VStack gap="space-8">
											{periodDetail && <Detail>{periodDetail}</Detail>}
											{registrationDetails.map((registration) => (
												<Detail key={registration}>{registration}</Detail>
											))}
										</VStack>
									</Table.DataCell>
								</Table.Row>
							)
						})}
					</Table.Body>
				</Table>
			</section>
			{downloads.some((download) => download.forceFetchJustification) && (
				<Alert variant="info" size="small">
					Noen rapporter ble hentet med begrunnelse selv om godkjenningskrav ikke var oppfylt.
				</Alert>
			)}
		</VStack>
	)
}

function buildReportPreviewUrl(params: {
	activityId: string
	applicationId: string
	attemptId: string
	reportId: string
	format: string
}): string {
	const query = new URLSearchParams(params)
	return `/api/evidence-report-preview?${query.toString()}`
}

function periodLabel(periodType: string): string {
	const labels: Record<string, string> = {
		yearly: "Årlig",
		tertiary: "Tertialsvis",
		quarterly: "Kvartalsvis",
		monthly: "Månedlig",
	}
	return labels[periodType] ?? periodType
}

function formatSelectedPeriod(periodType: string, periodStart: string): string {
	const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(periodStart)
	if (!match) return `${periodLabel(periodType)} · ${periodStart}`

	const year = Number(match[1])
	const month = Number(match[2])
	if (month < 1 || month > 12) return `${periodLabel(periodType)} · ${periodStart}`
	if (periodType === "quarterly") return `${Math.floor((month - 1) / 3) + 1}. kvartal ${year}`
	if (periodType === "tertiary") return `${Math.floor((month - 1) / 4) + 1}. tertial ${year}`
	if (periodType === "yearly") return String(year)
	if (periodType === "monthly") {
		const monthName = new Intl.DateTimeFormat("nb-NO", { month: "long", timeZone: "UTC" }).format(
			new Date(Date.UTC(year, month - 1, 1)),
		)
		return `${monthName} ${year}`
	}
	return `${periodLabel(periodType)} · ${periodStart}`
}

function getDownloadPeriodDetail(
	download: NdaEvidenceDataProp["downloads"][number],
	periodConfig: PeriodConfig | null,
): string | null {
	const period = `${periodLabel(download.periodType)} · ${download.periodStart}`
	if (!periodConfig) return period
	if (download.periodType !== periodConfig.periodType || download.periodStart !== periodConfig.periodStart) {
		return `${period} · Annen periode`
	}
	return null
}
