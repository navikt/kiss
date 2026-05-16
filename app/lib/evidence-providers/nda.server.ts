/**
 * NDA (deployment audit) evidence provider.
 *
 * Implements the EvidenceProvider interface for NDA audit-reports API.
 * Supports async report generation via requestGeneration() + getJobStatus().
 */

import { logger } from "~/lib/logger.server"
import {
	downloadNdaAuditReport,
	generateNdaAuditReport,
	getNdaAuditJobStatus,
	getNdaAuditStatus,
	listNdaAuditReports,
	type NdaReportSummary,
	type NdaStatusResponse,
	type PeriodType,
} from "~/lib/nda-audit-reports.server"
import { formatPeriodLabel, getPeriodEndDate } from "~/lib/period-format"
import type {
	EvidenceFile,
	EvidenceJobResult,
	EvidenceProvider,
	EvidenceStatusItem,
	EvidenceStatusResponse,
} from "./types"

/** NDA-specific parameters for status and download calls */
export interface NdaProviderParams {
	team: string
	environment: string
	appName: string
	periodType: PeriodType
	periodStart: string
}

function assertNdaParams(params: Record<string, unknown>): NdaProviderParams {
	const { team, environment, appName, periodType, periodStart } = params
	if (typeof team !== "string" || !team) {
		throw new Error("NDA provider requires 'team' parameter")
	}
	if (typeof environment !== "string" || !environment) {
		throw new Error("NDA provider requires 'environment' parameter")
	}
	if (typeof appName !== "string" || !appName) {
		throw new Error("NDA provider requires 'appName' parameter")
	}
	if (typeof periodType !== "string" || !periodType) {
		throw new Error("NDA provider requires 'periodType' parameter")
	}
	if (typeof periodStart !== "string" || !periodStart) {
		throw new Error("NDA provider requires 'periodStart' parameter")
	}
	return { team, environment, appName, periodType: periodType as PeriodType, periodStart }
}

function mapDeploymentStatusItem(
	status: NdaStatusResponse,
	existingReports: NdaReportSummary[],
	selectedPeriodLabel: string,
): EvidenceStatusItem {
	const { deployments } = status
	const hasReport = existingReports.length > 0
	const allApproved = deployments.notApproved === 0 && deployments.pending === 0

	let itemStatus: EvidenceStatusItem["status"]
	if (hasReport) {
		itemStatus = "ok"
	} else if (deployments.total === 0) {
		itemStatus = "not_available"
	} else if (allApproved) {
		itemStatus = "ok"
	} else if (deployments.approvedPercent >= 80) {
		itemStatus = "partial"
	} else {
		itemStatus = "failed"
	}

	return {
		id: "deployment_evidence_report",
		label: `Leveranserapport — ${selectedPeriodLabel}`,
		status: itemStatus,
		formats: status.availableFormats,
		canDownload: hasReport,
		details: {
			deployments: {
				total: deployments.total,
				approved: deployments.approved,
				pending: deployments.pending,
				notApproved: deployments.notApproved,
				approvedPercent: deployments.approvedPercent,
				withChangeOrigin: deployments.withChangeOrigin,
				changeOriginPercent: deployments.changeOriginPercent,
			},
			existingReports: existingReports.map((r) => ({
				reportId: r.reportId,
				periodLabel: r.periodLabel,
				generatedAt: r.generatedAt,
				generatedBy: r.generatedBy,
				totalDeployments: r.totalDeployments,
				approvedCount: r.approvedCount,
				availableFormats: r.availableFormats,
			})),
		},
	}
}

export class NdaEvidenceProvider implements EvidenceProvider {
	readonly type = "deployments" as const

	async getStatus(params: Record<string, unknown>): Promise<EvidenceStatusResponse | null> {
		const { team, environment, appName, periodType, periodStart } = assertNdaParams(params)
		const selectedPeriodLabel = formatPeriodLabel(periodType, periodStart)
		const selectedPeriodEnd = getPeriodEndDate(periodType, periodStart)

		try {
			const [status, reportList] = await Promise.all([
				getNdaAuditStatus(team, environment, appName),
				listNdaAuditReports(team, environment, appName),
			])

			const periodReports = reportList.reports.filter(
				(r) => r.periodType === periodType && r.periodStart === periodStart,
			)

			return {
				providerType: "deployments",
				sourceLabel: `${team}/${appName} (${environment})`,
				collectedAt: new Date().toISOString(),
				externalUrl: null,
				items: [mapDeploymentStatusItem(status, periodReports, selectedPeriodLabel)],
				metadata: {
					team,
					environment,
					appName,
					period: {
						type: periodType,
						label: selectedPeriodLabel,
						start: periodStart,
						end: selectedPeriodEnd,
					},
					observedPeriodFromNda: {
						type: status.period.type,
						label: status.period.label,
						start: status.period.start,
						end: status.period.end,
					},
					deployments: status.deployments,
					existingReports: periodReports,
					auditStartDate: status.app.auditStartDate,
					applicationGroup: status.app.applicationGroup,
				},
			}
		} catch (err) {
			logger.error(
				`NDA getStatus failed [team=${team}, env=${environment}, app=${appName}], returning unavailable response`,
				err instanceof Error ? err : new Error(String(err)),
			)

			return {
				providerType: "deployments",
				sourceLabel: `${team}/${appName} (${environment})`,
				collectedAt: new Date().toISOString(),
				externalUrl: null,
				items: [],
				metadata: {
					team,
					environment,
					appName,
					error: "Leveranserapport-tjenesten er ikke tilgjengelig. Prøv igjen senere.",
				},
			}
		}
	}

	async downloadFile(params: Record<string, unknown>, itemId: string, format: string): Promise<EvidenceFile> {
		const { team, environment, appName } = assertNdaParams(params)

		// itemId is the reportId for NDA downloads
		if (!itemId || itemId === "deployment_evidence_report") {
			throw new Error("NDA download requires a specific reportId as itemId")
		}

		return downloadNdaAuditReport(team, environment, appName, itemId, format)
	}

	async requestGeneration(params: Record<string, unknown>, reason?: string): Promise<{ jobId: string }> {
		const { team, environment, appName } = assertNdaParams(params)

		const result = await generateNdaAuditReport(team, environment, appName, {
			reason,
		})

		return { jobId: result.jobId }
	}

	async getJobStatus(params: Record<string, unknown>, jobId: string): Promise<EvidenceJobResult> {
		const { team, environment, appName } = assertNdaParams(params)

		const result = await getNdaAuditJobStatus(team, environment, appName, jobId)

		return {
			jobId: result.jobId,
			status: result.status,
			error: result.error,
			result: result.report
				? {
						reportId: result.reportId,
						report: result.report,
					}
				: undefined,
			retryAfterSeconds: result.retryAfterSeconds ?? undefined,
		}
	}
}
