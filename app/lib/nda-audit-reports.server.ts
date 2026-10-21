/**
 * NDA audit-reports API client.
 *
 * Provides M2M-authenticated access to the NDA audit-reports API for
 * generating and downloading deployment audit reports (leveranserapporter).
 *
 * Separate from deployment-audit.server.ts which handles deployment
 * verification status (four-eyes, change origin tracking).
 */

import PDFDocument from "pdfkit"
import * as XLSX from "xlsx"
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

const NDA_GENERATE_TIMEOUT_MS = 60_000

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
		signal: AbortSignal.timeout(NDA_GENERATE_TIMEOUT_MS),
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
	periodType: PeriodType = "yearly",
	periodStart = `${new Date().getFullYear()}-01-01`,
): Promise<NdaJobResponse & { retryAfterSeconds: number | null }> {
	if (isDevMode()) {
		logger.warn("NDA_AUDIT_REPORTS_BASE_URL not set — returning mock completed job", { team, env, app, jobId })
		const [year, month] = periodStart.split("-").map(Number)
		const periodMonths = { yearly: 12, tertiary: 4, quarterly: 3, monthly: 1 }[periodType]
		const endDate = new Date(Date.UTC(year, month - 1 + periodMonths, 0)).toISOString().slice(0, 10)
		const periodLabel =
			periodType === "yearly"
				? String(year)
				: periodType === "quarterly"
					? `Q${Math.floor((month - 1) / 3) + 1} ${year}`
					: periodType === "tertiary"
						? `T${Math.floor((month - 1) / 4) + 1} ${year}`
						: new Intl.DateTimeFormat("nb-NO", { month: "long", timeZone: "UTC" }).format(
								new Date(Date.UTC(year, month - 1, 1)),
							)
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
				periodType,
				periodLabel,
				periodStart,
				periodEnd: endDate,
				generatedAt: new Date().toISOString(),
				generatedBy: null,
				totalDeployments: 42,
				approvedCount: 40,
				withChangeOriginCount: 35,
				contentHash: "mock-hash",
				availableFormats: ["pdf", "excel"],
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

const MAX_NDA_REPORT_DOWNLOAD_BYTES = 50 * 1024 * 1024

async function readResponseWithLimit(response: Response, maxBytes: number): Promise<Buffer> {
	const tooLarge = () => new Response("Rapportfilen fra NDA er for stor.", { status: 413 })
	const declaredLength = Number(response.headers.get("content-length"))
	if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
		await response.body?.cancel()
		throw tooLarge()
	}
	if (!response.body) return Buffer.alloc(0)

	const reader = response.body.getReader()
	const chunks: Buffer[] = []
	let received = 0
	for (;;) {
		const { done, value } = await reader.read()
		if (done) break
		received += value.byteLength
		if (received > maxBytes) {
			await reader.cancel()
			throw tooLarge()
		}
		chunks.push(Buffer.from(value))
	}
	return Buffer.concat(chunks, received)
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
		const isExcel = format.toLowerCase() === "excel" || format.toLowerCase() === "xlsx"
		logger.warn("NDA_AUDIT_REPORTS_BASE_URL not set — returning mock report file", { team, env, app, reportId, format })
		const mockBuffer = isExcel ? createMockExcelReport(app, reportId) : await createMockPdfReport(app, reportId)
		return {
			buffer: mockBuffer,
			contentType: isExcel ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/pdf",
			fileName: `${reportId}.${isExcel ? "xlsx" : "pdf"}`,
		}
	}

	const basePath = buildAppBasePath(team, env, app)
	const params = new URLSearchParams({ format })
	const response = await fetchWithAuth(`${basePath}/${encodeURIComponent(reportId)}/download?${params.toString()}`)

	if (!response.ok) {
		await handleErrorResponse(response, "download report")
	}

	const buffer = await readResponseWithLimit(response, MAX_NDA_REPORT_DOWNLOAD_BYTES)
	const contentType = response.headers.get("content-type") ?? "application/pdf"
	const disposition = response.headers.get("content-disposition") ?? ""
	const fileNameMatch = disposition.match(/filename="?([^";\n]+)"?/)
	const fileName = fileNameMatch?.[1] ?? `${reportId}.${format}`

	return { buffer, contentType, fileName }
}

function createMockPdfReport(app: string, reportId: string): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const document = new PDFDocument()
		const chunks: Buffer[] = []
		document.on("data", (chunk: Buffer) => chunks.push(chunk))
		document.on("end", () => resolve(Buffer.concat(chunks)))
		document.on("error", reject)
		document.fontSize(18).text("Mock NDA audit report")
		document.moveDown()
		document.fontSize(12).text(`Applikasjon: ${app}`)
		document.text(`Rapport-ID: ${reportId}`)
		document.end()
	})
}

function createMockExcelReport(app: string, reportId: string): Buffer {
	const workbook = XLSX.utils.book_new()
	const worksheet = XLSX.utils.aoa_to_sheet([
		["Applikasjon", "Rapport-ID", "Leveranser", "Godkjent"],
		[app, reportId, 0, 0],
	])
	XLSX.utils.book_append_sheet(workbook, worksheet, "Oppsummering")
	return Buffer.from(XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }))
}

// ─── Error classes ──────────────────────────────────────────────────────────

/** Thrown when a report already exists for the period and no reason was provided. */
export class NdaConflictError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "NdaConflictError"
	}
}
