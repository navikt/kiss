import type { NdaReportGenerationState } from "~/db/schema/routines"

export const NDA_REPORT_GENERATION_STALE_MS = 5 * 60 * 1000

export function getNdaReportGenerationDeadline(state: Pick<NdaReportGenerationState, "updatedAt">): number {
	const updatedAt = state.updatedAt ? Date.parse(state.updatedAt) : Number.NaN
	return Number.isNaN(updatedAt) ? 0 : updatedAt + NDA_REPORT_GENERATION_STALE_MS
}

export function isNdaReportGenerationInProgress(
	state: Pick<NdaReportGenerationState, "status" | "updatedAt">,
	now: number = Date.now(),
): boolean {
	if (state.status !== "starting" && state.status !== "pending") return false
	return now < getNdaReportGenerationDeadline(state)
}

export function isNdaReportGenerationStale(
	state: Pick<NdaReportGenerationState, "status" | "updatedAt">,
	now: number = Date.now(),
): boolean {
	return (state.status === "starting" || state.status === "pending") && !isNdaReportGenerationInProgress(state, now)
}

export function isNdaReportReadyForApp(
	state: NdaReportGenerationState | undefined,
	app: { team: string; environment: string; appName: string },
	period: { periodType: string; periodStart: string },
): boolean {
	const report = state?.report
	if (state?.status !== "ready" || !report) return false
	if (state.team !== app.team || state.environment !== app.environment || state.appName !== app.appName) return false
	if (report.periodType !== period.periodType || report.periodStart !== period.periodStart) return false
	const formats = new Set(report.availableFormats.map((format) => format.toLowerCase()))
	return formats.has("pdf") && (formats.has("excel") || formats.has("xlsx"))
}
