/**
 * NDA audit-reports API client.
 *
 * Provides M2M-authenticated access to the NDA audit-reports API for
 * generating and downloading deployment audit reports (leveranserapporter).
 *
 * Separate from deployment-audit.server.ts which handles deployment
 * verification status (four-eyes, change origin tracking).
 */

import { getClientCredentialToken } from "./azure.server"
import { loggedFetch } from "./http-logger.server"
import { logger } from "./logger.server"

const NDA_AUDIT_REPORTS_SCOPE = process.env.NDA_AUDIT_REPORTS_SCOPE ?? process.env.DEPLOYMENT_AUDIT_SCOPE
const NDA_AUDIT_REPORTS_BASE_URL = process.env.NDA_AUDIT_REPORTS_BASE_URL ?? process.env.DEPLOYMENT_AUDIT_BASE_URL

function isDevMode(): boolean {
	if (!NDA_AUDIT_REPORTS_BASE_URL) {
		if (process.env.NODE_ENV === "production") {
			throw new Error("NDA_AUDIT_REPORTS_BASE_URL er ikke satt i produksjon")
		}
		return true
	}
	return false
}

// ─── Types ──────────────────────────────────────────────────────────────────

export { PERIOD_TYPES, type PeriodType } from "~/lib/period-validation"

import type { PeriodType } from "~/lib/period-validation"

export interface NdaAppMetadata {
	team: string
	environment: string
	name: string
	auditStartDate: string | null
	applicationGroup: {
		name: string
		apps: Array<{ team: string; environment: string; name: string }>
	} | null
}

export interface NdaReportSummary {
	reportId: string
	periodType: PeriodType
	periodLabel: string
	periodStart: string
	periodEnd: string
	generatedAt: string
	generatedBy: string | null
	totalDeployments: number
	approvedCount: number
	withChangeOriginCount: number | null
	contentHash: string
	availableFormats: string[]
}

export interface NdaStatusResponse {
	app: NdaAppMetadata
	period: {
		type: PeriodType
		label: string
		start: string
		end: string
	}
	deployments: {
		total: number
		approved: number
		pending: number
		notApproved: number
		approvedPercent: number
		withChangeOrigin: number
		changeOriginPercent: number
	}
	existingReports: NdaReportSummary[]
	availableFormats: string[]
}

export interface NdaListResponse {
	app: NdaAppMetadata
	reports: NdaReportSummary[]
}

export interface NdaGenerateResponse {
	app: NdaAppMetadata
	jobId: string
	status: "pending" | "completed"
	reportId: string | null
	message: string
}

export interface NdaJobResponse {
	app: NdaAppMetadata
	jobId: string
	status: "pending" | "processing" | "completed" | "failed"
	createdAt: string
	completedAt: string | null
	error: string | null
	reportId: string | null
	report: NdaReportSummary | null
}

// ─── HTTP client ────────────────────────────────────────────────────────────

function buildAppBasePath(team: string, env: string, app: string): string {
	return `/api/v1/apps/${encodeURIComponent(team)}/${encodeURIComponent(env)}/${encodeURIComponent(app)}/audit-reports`
}

async function fetchWithAuth(path: string, options?: RequestInit): Promise<Response> {
	if (!NDA_AUDIT_REPORTS_SCOPE) {
		throw new Error("NDA_AUDIT_REPORTS_SCOPE is not configured")
	}
	if (!NDA_AUDIT_REPORTS_BASE_URL) {
		throw new Error("NDA_AUDIT_REPORTS_BASE_URL is not configured")
	}

	const token = await getClientCredentialToken(NDA_AUDIT_REPORTS_SCOPE)
	const url = `${NDA_AUDIT_REPORTS_BASE_URL}${path}`

	const headers = new Headers(options?.headers as HeadersInit | undefined)
	headers.set("Authorization", `Bearer ${token}`)

	return loggedFetch(url, { ...options, headers }, { area: "nda-audit" })
}

async function handleErrorResponse(response: Response, context: string): Promise<never> {
	const text = await response.text().catch(() => "")
	let errorMessage: string
	try {
		const json = JSON.parse(text) as { error?: string }
		errorMessage = json.error ?? text
	} catch {
		errorMessage = text
	}
	logger.error(`NDA audit-reports ${context} failed`, {
		status: response.status,
		error: errorMessage,
	})
	throw new Error(`NDA audit-reports ${context}: ${response.status} — ${errorMessage}`)
}

// ─── Mock data (local development) ─────────────────────────────────────────

function getMockAppMetadata(team: string, env: string, app: string): NdaAppMetadata {
	return {
		team,
		environment: env,
		name: app,
		auditStartDate: "2024-01-01",
		applicationGroup: null,
	}
}

function getMockStatusResponse(
	team: string,
	env: string,
	app: string,
	periodType: PeriodType,
	periodStart: string,
): NdaStatusResponse {
	const hash = [...`${team}/${env}/${app}`].reduce((acc, c) => acc + c.charCodeAt(0), 0)
	const total = 30 + (hash % 120)
	const approved = Math.round(total * (0.85 + (hash % 15) / 100))
	const pending = Math.min(3, total - approved)
	const notApproved = total - approved - pending
	const withChangeOrigin = Math.round(total * 0.8)

	return {
		app: getMockAppMetadata(team, env, app),
		period: {
			type: periodType,
			label: periodStart.substring(0, 4),
			start: periodStart,
			end: `${periodStart.substring(0, 4)}-12-31`,
		},
		deployments: {
			total,
			approved,
			pending,
			notApproved,
			approvedPercent: Math.round((approved / total) * 1000) / 10,
			withChangeOrigin,
			changeOriginPercent: Math.round((withChangeOrigin / total) * 1000) / 10,
		},
		existingReports: [],
		availableFormats: ["pdf"],
	}
}

function getMockListResponse(team: string, env: string, app: string): NdaListResponse {
	return {
		app: getMockAppMetadata(team, env, app),
		reports: [],
	}
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Get deployment status and existing reports for a specific period.
 * Maps to `GET /api/v1/apps/{team}/{env}/{app}/audit-reports/status`
 */
export async function getNdaAuditStatus(
	team: string,
	env: string,
	app: string,
	periodType: PeriodType,
	periodStart: string,
): Promise<NdaStatusResponse> {
	if (isDevMode()) {
		logger.warn("NDA_AUDIT_REPORTS_BASE_URL not set — returning mock data", { team, env, app })
		return getMockStatusResponse(team, env, app, periodType, periodStart)
	}

	const basePath = buildAppBasePath(team, env, app)
	const params = new URLSearchParams({ periodType, periodStart })
	const response = await fetchWithAuth(`${basePath}/status?${params.toString()}`)

	if (!response.ok) {
		await handleErrorResponse(response, "status")
	}

	return (await response.json()) as NdaStatusResponse
}

/**
 * List all active (non-archived, non-superseded) reports for an app.
 * Maps to `GET /api/v1/apps/{team}/{env}/{app}/audit-reports`
 */
export async function listNdaAuditReports(team: string, env: string, app: string): Promise<NdaListResponse> {
	if (isDevMode()) {
		logger.warn("NDA_AUDIT_REPORTS_BASE_URL not set — returning mock data", { team, env, app })
		return getMockListResponse(team, env, app)
	}

	const basePath = buildAppBasePath(team, env, app)
	const response = await fetchWithAuth(basePath)

	if (!response.ok) {
		await handleErrorResponse(response, "list reports")
	}

	return (await response.json()) as NdaListResponse
}

/**
 * Request generation of a new audit report.
 * Maps to `POST /api/v1/apps/{team}/{env}/{app}/audit-reports/generate`
 *
 * Returns 202 for new job, 200 for existing job (deduplication).
 * Returns 409 if active report exists and no reason is provided.
 */
export async function generateNdaAuditReport(
	team: string,
	env: string,
	app: string,
	periodType: PeriodType,
	periodStart: string,
	options?: { format?: string; reason?: string },
): Promise<NdaGenerateResponse> {
	if (isDevMode()) {
		logger.warn("NDA_AUDIT_REPORTS_BASE_URL not set — returning mock generate response", { team, env, app })
		return {
			app: getMockAppMetadata(team, env, app),
			jobId: `mock-job-${Date.now()}`,
			status: "pending",
			reportId: null,
			message: "Mock report generation started",
		}
	}

	const basePath = buildAppBasePath(team, env, app)
	const body: Record<string, string> = { periodType, periodStart }
	if (options?.format) body.format = options.format
	if (options?.reason) body.reason = options.reason

	const response = await fetchWithAuth(`${basePath}/generate`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	})

	if (response.status === 409) {
		const json = (await response.json()) as { error: string }
		throw new NdaConflictError(json.error)
	}

	if (!response.ok && response.status !== 202) {
		await handleErrorResponse(response, "generate report")
	}

	return (await response.json()) as NdaGenerateResponse
}

/**
 * Check the status of a report generation job.
 * Maps to `GET /api/v1/apps/{team}/{env}/{app}/audit-reports/jobs/{jobId}`
 *
 * Returns Retry-After header when job is still processing.
 */
export async function getNdaAuditJobStatus(
	team: string,
	env: string,
	app: string,
	jobId: string,
): Promise<NdaJobResponse & { retryAfterSeconds: number | null }> {
	if (isDevMode()) {
		logger.warn("NDA_AUDIT_REPORTS_BASE_URL not set — returning mock completed job", { team, env, app, jobId })
		return {
			app: getMockAppMetadata(team, env, app),
			jobId,
			status: "completed",
			createdAt: new Date(Date.now() - 60_000).toISOString(),
			completedAt: new Date().toISOString(),
			error: null,
			reportId: `AUDIT-${new Date().getFullYear()}-${app}-mock`,
			report: {
				reportId: `AUDIT-${new Date().getFullYear()}-${app}-mock`,
				periodType: "yearly",
				periodLabel: String(new Date().getFullYear()),
				periodStart: `${new Date().getFullYear()}-01-01`,
				periodEnd: `${new Date().getFullYear()}-12-31`,
				generatedAt: new Date().toISOString(),
				generatedBy: null,
				totalDeployments: 42,
				approvedCount: 40,
				withChangeOriginCount: 35,
				contentHash: "mock-hash",
				availableFormats: ["pdf"],
			},
			retryAfterSeconds: null,
		}
	}

	const basePath = buildAppBasePath(team, env, app)
	const response = await fetchWithAuth(`${basePath}/jobs/${encodeURIComponent(jobId)}`)

	if (!response.ok) {
		await handleErrorResponse(response, "job status")
	}

	const retryAfter = response.headers.get("Retry-After")
	const retryAfterSeconds = retryAfter ? Number.parseInt(retryAfter, 10) : null

	const json = (await response.json()) as NdaJobResponse
	return { ...json, retryAfterSeconds: Number.isNaN(retryAfterSeconds) ? null : retryAfterSeconds }
}

/**
 * Download a report as PDF (binary).
 * Maps to `GET /api/v1/apps/{team}/{env}/{app}/audit-reports/{reportId}/download`
 */
export async function downloadNdaAuditReport(
	team: string,
	env: string,
	app: string,
	reportId: string,
	format = "pdf",
): Promise<{ buffer: Buffer; contentType: string; fileName: string }> {
	if (isDevMode()) {
		logger.warn("NDA_AUDIT_REPORTS_BASE_URL not set — returning mock PDF", { team, env, app, reportId })
		return {
			buffer: Buffer.from(`%PDF-1.4 mock audit report for ${app}`),
			contentType: "application/pdf",
			fileName: `${reportId}.pdf`,
		}
	}

	const basePath = buildAppBasePath(team, env, app)
	const params = new URLSearchParams({ format })
	const response = await fetchWithAuth(`${basePath}/${encodeURIComponent(reportId)}/download?${params.toString()}`)

	if (!response.ok) {
		await handleErrorResponse(response, "download report")
	}

	const buffer = Buffer.from(await response.arrayBuffer())
	const contentType = response.headers.get("content-type") ?? "application/pdf"
	const disposition = response.headers.get("content-disposition") ?? ""
	const fileNameMatch = disposition.match(/filename="?([^";\n]+)"?/)
	const fileName = fileNameMatch?.[1] ?? `${reportId}.${format}`

	return { buffer, contentType, fileName }
}

// ─── Error classes ──────────────────────────────────────────────────────────

/** Thrown when a report already exists for the period and no reason was provided. */
export class NdaConflictError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "NdaConflictError"
	}
}
