import { getClientCredentialToken } from "./azure.server"
import { logger } from "./logger.server"
import {
	getMockEvidence,
	getMockEvidenceCatalog,
	getMockEvidenceInstances,
	getMockEvidenceStatus,
	getMockInstances,
	getMockRoles,
	getMockSummary,
} from "./oracle-revisjon.mock.server"

const ORACLE_REVISJON_SCOPE = process.env.ORACLE_REVISJON_SCOPE
const ORACLE_REVISJON_BASE_URL = process.env.ORACLE_REVISJON_BASE_URL

// --- Types ---

export interface OracleInstance {
	id: string
	name: string
	type: string
	group: string | null
}

export interface AuditEvidenceResult {
	query: string
	columns: string[]
	rows: unknown[][]
}

export interface AuditEvidenceSection {
	id: string
	title: string
	description: string
	result: AuditEvidenceResult
	summary: string
	error: string | null
}

export interface AuditEvidence {
	collectedAt: string
	instanceId: string
	instanceGroup: string | null
	overallStatus: "OK" | "PARTIAL" | "FAILED"
	sections: AuditEvidenceSection[]
}

export type AuditConclusion = "AV" | "MANGELFULL" | "FULLSTENDIG" | "UKJENT"
export type FindingSeverity = "KRITISK" | "ADVARSEL" | "INFO"

export interface AuditFinding {
	severity: FindingSeverity
	message: string
}

export interface AuditEvidenceSummary {
	instanceGroup: string | null
	conclusion: AuditConclusion
	reason: string
	unifiedAuditingEnabled: boolean
	activePolicyCount: number
	auditedObjectCount: number
	unauditedTableCount: number
	excludedUserCount: number
	policiesWithoutFailureAudit: number
	hasAuditTrailData: boolean
	findings: AuditFinding[]
}

// --- Internal helpers ---

function isDevMode(): boolean {
	return !ORACLE_REVISJON_BASE_URL
}

async function fetchWithAuth(path: string, headers: Record<string, string> = {}): Promise<Response> {
	if (!ORACLE_REVISJON_SCOPE) {
		throw new Error("ORACLE_REVISJON_SCOPE is not configured")
	}
	if (!ORACLE_REVISJON_BASE_URL) {
		throw new Error("ORACLE_REVISJON_BASE_URL is not configured")
	}

	const token = await getClientCredentialToken(ORACLE_REVISJON_SCOPE)

	const url = `${ORACLE_REVISJON_BASE_URL}${path}`
	logger.debug("Fetching oracle-revisjon", { url })

	const response = await fetch(url, {
		headers: {
			Authorization: `Bearer ${token}`,
			...headers,
		},
	})

	if (!response.ok) {
		const text = await response.text()
		logger.error("oracle-revisjon request failed", {
			url,
			status: response.status,
			body: text,
		})
		throw new Error(`oracle-revisjon request failed: ${response.status} ${text}`)
	}

	return response
}

export interface OracleRolesResponse {
	instanceId: string
	roles: OracleRole[]
}

export interface OracleRole {
	name: string
	authType: string | null
	common: boolean | null
	oracleMaintained: boolean | null
	hasNavAnsattGrantee?: boolean | null
}

/** Rolle som skal kritikalitetsvurderes: egendefinert, eller brukt av Nav-ansatte */
export function shouldAssessRole(role: OracleRole): boolean {
	return role.oracleMaintained !== true || role.hasNavAnsattGrantee !== false
}

// --- In-memory cache (TTL 1 hour) ---

const SUMMARY_CACHE_TTL_MS = 60 * 60 * 1000
const ROLES_CACHE_TTL_MS = 60 * 60 * 1000
const summaryCache = new Map<string, { data: AuditEvidenceSummary | null; fetchedAt: number }>()
const rolesCache = new Map<string, { data: OracleRolesResponse; fetchedAt: number }>()

function getCachedSummary(instanceId: string): AuditEvidenceSummary | null | undefined {
	const entry = summaryCache.get(instanceId)
	if (!entry) return undefined
	if (Date.now() - entry.fetchedAt > SUMMARY_CACHE_TTL_MS) {
		summaryCache.delete(instanceId)
		return undefined
	}
	return entry.data
}

function getCachedRoles(instanceId: string): OracleRolesResponse | undefined {
	const entry = rolesCache.get(instanceId)
	if (!entry) return undefined
	if (Date.now() - entry.fetchedAt > ROLES_CACHE_TTL_MS) {
		rolesCache.delete(instanceId)
		return undefined
	}
	return entry.data
}

function setCachedSummary(instanceId: string, data: AuditEvidenceSummary | null) {
	summaryCache.set(instanceId, { data, fetchedAt: Date.now() })
}

// --- Public API ---

export async function getOracleInstances(): Promise<OracleInstance[]> {
	if (isDevMode()) {
		logger.warn("ORACLE_REVISJON_BASE_URL not set — returning mock instances")
		return getMockInstances()
	}

	const response = await fetchWithAuth("/api/m2m/evidence/instances")
	return (await response.json()) as OracleInstance[]
}

export async function getAuditEvidence(instanceId: string): Promise<AuditEvidence> {
	if (isDevMode()) {
		logger.warn("ORACLE_REVISJON_BASE_URL not set — returning mock audit evidence", { instanceId })
		return getMockEvidence(instanceId)
	}

	const response = await fetchWithAuth(`/api/m2m/${encodeURIComponent(instanceId)}/evidence/audit`)
	return (await response.json()) as AuditEvidence
}

export async function getAuditEvidenceExcel(instanceId: string): Promise<Buffer> {
	if (isDevMode()) {
		logger.warn("ORACLE_REVISJON_BASE_URL not set — returning empty buffer as mock Excel", { instanceId })
		return Buffer.alloc(0)
	}

	const response = await fetchWithAuth(`/api/m2m/${encodeURIComponent(instanceId)}/evidence/audit/excel`)
	const arrayBuffer = await response.arrayBuffer()
	return Buffer.from(arrayBuffer)
}

export async function getAuditEvidenceSummary(instanceId: string): Promise<AuditEvidenceSummary | null> {
	if (isDevMode()) {
		logger.warn("ORACLE_REVISJON_BASE_URL not set — returning mock summary", { instanceId })
		return getMockSummary(instanceId)
	}

	const cached = getCachedSummary(instanceId)
	if (cached !== undefined) return cached

	try {
		const response = await fetchWithAuth(`/api/m2m/${encodeURIComponent(instanceId)}/evidence/audit/summary`)

		if (response.status === 204) {
			logger.info("Audit evidence summary not available (204)", { instanceId })
			setCachedSummary(instanceId, null)
			return null
		}

		const summary = (await response.json()) as AuditEvidenceSummary
		setCachedSummary(instanceId, summary)
		return summary
	} catch {
		// fetchWithAuth already logs the error details
		return null
	}
}

export async function getOracleRoles(instanceId: string): Promise<OracleRolesResponse | null> {
	if (isDevMode()) {
		logger.warn("ORACLE_REVISJON_BASE_URL not set — returning mock roles", { instanceId })
		return getMockRoles(instanceId)
	}

	const cached = getCachedRoles(instanceId)
	if (cached) {
		return cached
	}

	try {
		if (!ORACLE_REVISJON_SCOPE || !ORACLE_REVISJON_BASE_URL) {
			return null
		}

		const response = await fetchWithAuth(`/api/m2m/${encodeURIComponent(instanceId)}/roles`)
		const data = (await response.json()) as OracleRolesResponse
		rolesCache.set(instanceId, { data, fetchedAt: Date.now() })
		return data
	} catch {
		// fetchWithAuth already logs the error details
		return null
	}
}

// ─── Evidence API (v2) — Status and download endpoints ───────────────────

export const ORACLE_EVIDENCE_TYPES = ["audit", "profiles", "roles", "users", "period"] as const
export type OracleEvidenceType = (typeof ORACLE_EVIDENCE_TYPES)[number]

export interface EvidenceInstanceInfo {
	id: string
	name: string
	type: string
}

export interface EvidenceCatalogEntry {
	type: string
	title: string
	description: string
	formats: string[]
	requiresPeriod: boolean
	periodConstraints: { maxDays: number; maxStatements: number } | null
}

export interface EvidenceCatalog {
	evidenceTypes: EvidenceCatalogEntry[]
}

export interface ReviewProgress {
	fromUtc: string
	toUtc: string
	totalStatements: number
	reviewedStatements: number
	unreviewedStatements: number
	reviewProgress: number
	syncWatermarkUtc: string | null
	periodFullySynced: boolean
}

export interface EvidenceTypeStatus {
	type: string
	title: string
	status: "OK" | "PARTIAL" | "FAILED"
	formats: string[]
	available: boolean
	error: string | null
	review: ReviewProgress | null
}

export interface EvidenceStatus {
	instanceId: string
	instanceName: string
	collectedAt: string
	reviewUrl: string | null
	evidenceTypes: EvidenceTypeStatus[]
}

// --- Cache for evidence status ---

const EVIDENCE_STATUS_CACHE_TTL_MS = 2 * 60 * 1000
const EVIDENCE_STATUS_CACHE_MAX_SIZE = 100
const evidenceStatusCache = new Map<string, { data: EvidenceStatus; fetchedAt: number }>()

function pruneExpiredCacheEntries(): void {
	const now = Date.now()
	for (const [key, entry] of evidenceStatusCache) {
		if (now - entry.fetchedAt >= EVIDENCE_STATUS_CACHE_TTL_MS) {
			evidenceStatusCache.delete(key)
		}
	}
}

function getEvidenceStatusCacheKey(instanceId: string, fromUtc?: string, toUtc?: string): string {
	const safeId = instanceId.replace(/[^a-zA-Z0-9_-]/g, "_")
	const datePattern = /^\d{4}-\d{2}-\d{2}$/
	const safeFrom = fromUtc && datePattern.test(fromUtc) ? fromUtc : ""
	const safeTo = toUtc && datePattern.test(toUtc) ? toUtc : ""
	return `${safeId}:${safeFrom}:${safeTo}`
}

// --- Public evidence API ---

export async function getEvidenceInstances(): Promise<EvidenceInstanceInfo[]> {
	if (isDevMode()) {
		logger.warn("ORACLE_REVISJON_BASE_URL not set — returning mock evidence instances")
		return getMockEvidenceInstances()
	}

	const response = await fetchWithAuth("/api/m2m/evidence/instances")
	return (await response.json()) as EvidenceInstanceInfo[]
}

export async function getEvidenceCatalog(): Promise<EvidenceCatalog> {
	if (isDevMode()) {
		logger.warn("ORACLE_REVISJON_BASE_URL not set — returning mock evidence catalog")
		return getMockEvidenceCatalog()
	}

	const response = await fetchWithAuth("/api/m2m/evidence/catalog")
	return (await response.json()) as EvidenceCatalog
}

export async function getEvidenceStatus(
	instanceId: string,
	fromUtc?: string,
	toUtc?: string,
): Promise<EvidenceStatus | null> {
	if (isDevMode()) {
		logger.warn("ORACLE_REVISJON_BASE_URL not set — returning mock evidence status", { instanceId })
		return getMockEvidenceStatus(instanceId, fromUtc, toUtc)
	}

	const cacheKey = getEvidenceStatusCacheKey(instanceId, fromUtc, toUtc)
	const cached = evidenceStatusCache.get(cacheKey)
	if (cached && Date.now() - cached.fetchedAt < EVIDENCE_STATUS_CACHE_TTL_MS) {
		return cached.data
	}
	// Prune expired entries to prevent unbounded growth
	pruneExpiredCacheEntries()

	try {
		if (!ORACLE_REVISJON_SCOPE || !ORACLE_REVISJON_BASE_URL) {
			return null
		}

		const params = new URLSearchParams()
		if (fromUtc) params.set("fromUtc", fromUtc)
		if (toUtc) params.set("toUtc", toUtc)
		const qs = params.toString()
		const path = `/api/m2m/${encodeURIComponent(instanceId)}/evidence/status${qs ? `?${qs}` : ""}`

		const response = await fetchWithAuth(path)
		const data = (await response.json()) as EvidenceStatus
		evidenceStatusCache.set(cacheKey, { data, fetchedAt: Date.now() })
		// Evict oldest entries if cache exceeds max size
		if (evidenceStatusCache.size > EVIDENCE_STATUS_CACHE_MAX_SIZE) {
			const firstKey = evidenceStatusCache.keys().next().value
			if (firstKey) evidenceStatusCache.delete(firstKey)
		}
		return data
	} catch {
		logger.error("Failed to fetch evidence status", { instanceId })
		return null
	}
}

export async function downloadEvidenceFile(
	instanceId: string,
	evidenceType: OracleEvidenceType,
	format: "excel" | "pdf",
	fromUtc?: string,
	toUtc?: string,
): Promise<{ buffer: Buffer; contentType: string; fileName: string }> {
	if (isDevMode()) {
		logger.warn("ORACLE_REVISJON_BASE_URL not set — returning mock evidence file", {
			instanceId,
			evidenceType,
			format,
		})
		const ext = format === "pdf" ? "pdf" : "xlsx"
		return {
			buffer: Buffer.alloc(0),
			contentType:
				format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			fileName: `${evidenceType}-${instanceId}.${ext}`,
		}
	}

	const params = new URLSearchParams()
	if (fromUtc) params.set("fromUtc", fromUtc)
	if (toUtc) params.set("toUtc", toUtc)
	const qs = params.toString()
	const path = `/api/m2m/${encodeURIComponent(instanceId)}/evidence/${encodeURIComponent(evidenceType)}/${format}${qs ? `?${qs}` : ""}`

	const response = await fetchWithAuth(path)
	const arrayBuffer = await response.arrayBuffer()
	const contentType =
		response.headers.get("content-type") ??
		(format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")

	const contentDisposition = response.headers.get("content-disposition")
	let fileName = `${evidenceType}-${instanceId}.${format === "pdf" ? "pdf" : "xlsx"}`
	if (contentDisposition) {
		const match = contentDisposition.match(/filename="?([^";\s]+)"?/)
		if (match) fileName = match[1]
	}

	return { buffer: Buffer.from(arrayBuffer), contentType, fileName }
}
