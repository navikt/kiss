import { getClientCredentialToken } from "./azure.server"
import { logger } from "./logger.server"

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

// --- Mock data ---

const MOCK_ORACLE_GROUP = "1e97cbc6-0687-4d23-aebd-c611035279c1"

function getMockInstances(): OracleInstance[] {
	const instanceTypes = [
		{ prefix: "pen", type: "pensjon" },
		{ prefix: "sam", type: "samordning" },
		{ prefix: "tp", type: "tjenestepensjon" },
	]
	const environments = ["", "_q0", "_q1", "_q5"]

	return instanceTypes.flatMap(({ prefix, type }) =>
		environments.map((env) => ({
			id: `${prefix}${env}`,
			name: `${prefix}${env}`.toUpperCase(),
			type,
			group: env === "" ? MOCK_ORACLE_GROUP : null,
		})),
	)
}

function getMockEvidence(instanceId: string): AuditEvidence {
	const instance = getMockInstances().find((i) => i.id === instanceId)
	return {
		collectedAt: new Date().toISOString(),
		instanceId,
		instanceGroup: instance?.group ?? null,
		overallStatus: "OK",
		sections: [
			{
				id: "unified-audit-status",
				title: "Unified Auditing Status",
				description: "Verifiserer at Unified Auditing er aktivert på Oracle-instansen",
				result: {
					query: "SELECT VALUE FROM V$OPTION WHERE PARAMETER = 'Unified Auditing'",
					columns: ["PARAMETER", "VALUE"],
					rows: [["Unified Auditing", "TRUE"]],
				},
				summary: "Unified Auditing er aktivert",
				error: null,
			},
			{
				id: "password-policy",
				title: "Password Policy",
				description: "Kontrollerer passordpolicy og profiler for databasebrukere",
				result: {
					query: "SELECT PROFILE, RESOURCE_NAME, LIMIT FROM DBA_PROFILES WHERE RESOURCE_TYPE = 'PASSWORD'",
					columns: ["PROFILE", "RESOURCE_NAME", "LIMIT"],
					rows: [
						["DEFAULT", "PASSWORD_LIFE_TIME", "180"],
						["DEFAULT", "PASSWORD_REUSE_MAX", "12"],
						["DEFAULT", "PASSWORD_LOCK_TIME", "1"],
						["DEFAULT", "FAILED_LOGIN_ATTEMPTS", "5"],
						["DEFAULT", "PASSWORD_VERIFY_FUNCTION", "ORA12C_STRONG_VERIFY_FUNCTION"],
					],
				},
				summary: "Passordpolicy er konfigurert i henhold til krav",
				error: null,
			},
			{
				id: "tablespace-encryption",
				title: "Tablespace Encryption",
				description: "Verifiserer at tablespace-kryptering (TDE) er aktivert",
				result: {
					query: "SELECT TABLESPACE_NAME, ENCRYPTED FROM DBA_TABLESPACES WHERE CONTENTS = 'PERMANENT'",
					columns: ["TABLESPACE_NAME", "ENCRYPTED"],
					rows: [
						["SYSTEM", "YES"],
						["SYSAUX", "YES"],
						["USERS", "YES"],
						["UNDOTBS1", "YES"],
					],
				},
				summary: "Alle permanente tablespaces er kryptert",
				error: null,
			},
			{
				id: "privileged-users",
				title: "Privileged Users",
				description: "Lister brukere med DBA- eller SYSDBA-rettigheter",
				result: {
					query: "SELECT GRANTEE, GRANTED_ROLE FROM DBA_ROLE_PRIVS WHERE GRANTED_ROLE IN ('DBA','SYSDBA')",
					columns: ["GRANTEE", "GRANTED_ROLE"],
					rows: [
						["SYS", "DBA"],
						["SYSTEM", "DBA"],
					],
				},
				summary: "2 brukere med DBA-rettigheter — kun systemkontoer",
				error: null,
			},
		],
	}
}

function getMockSummary(instanceId: string): AuditEvidenceSummary {
	const conclusions: AuditConclusion[] = ["FULLSTENDIG", "MANGELFULL", "AV", "UKJENT"]
	const hash = [...instanceId].reduce((acc, c) => acc + c.charCodeAt(0), 0)
	const conclusion = conclusions[hash % conclusions.length]
	const instance = getMockInstances().find((i) => i.id === instanceId)

	const findingsMap: Record<AuditConclusion, AuditFinding[]> = {
		FULLSTENDIG: [{ severity: "INFO", message: "Alle tabeller i skjemaet har audit-dekning" }],
		MANGELFULL: [
			{ severity: "ADVARSEL", message: "1 policy(er) logger ikke mislykkede handlinger (FAILURE)" },
			{
				severity: "ADVARSEL",
				message: `12 tabell(er) i ${instanceId.toUpperCase()}-skjemaet mangler audit-dekning`,
			},
		],
		AV: [{ severity: "KRITISK", message: "Unified Auditing er ikke aktivert" }],
		UKJENT: [{ severity: "INFO", message: "Kunne ikke hente data fra kritiske seksjoner" }],
	}

	const reasonMap: Record<AuditConclusion, string> = {
		FULLSTENDIG: "Unified Auditing er aktivert med full dekning av alle tabeller.",
		MANGELFULL: "Unified Auditing er aktivert med 3 aktive policy(er), men 12 tabell(er) mangler dekning.",
		AV: "Unified Auditing er ikke aktivert på denne instansen.",
		UKJENT: "Kunne ikke fastslå status — kritiske dataseksjoner feilet ved innhenting.",
	}

	return {
		instanceGroup: instance?.group ?? null,
		conclusion,
		reason: reasonMap[conclusion],
		unifiedAuditingEnabled: conclusion !== "AV",
		activePolicyCount: conclusion === "AV" ? 0 : 3,
		auditedObjectCount: conclusion === "FULLSTENDIG" ? 57 : 45,
		unauditedTableCount: conclusion === "MANGELFULL" ? 12 : 0,
		excludedUserCount: 0,
		policiesWithoutFailureAudit: conclusion === "MANGELFULL" ? 1 : 0,
		hasAuditTrailData: conclusion !== "AV",
		findings: findingsMap[conclusion],
	}
}

function getMockRoles(instanceId: string): OracleRolesResponse {
	return {
		instanceId,
		roles: [
			{ name: "CONNECT", authType: "NONE", common: true, oracleMaintained: true, hasNavAnsattGrantee: true },
			{ name: "DBA", authType: "NONE", common: true, oracleMaintained: true, hasNavAnsattGrantee: false },
			{ name: "RESOURCE", authType: "NONE", common: true, oracleMaintained: true, hasNavAnsattGrantee: false },
			{ name: "APP_USER", authType: "NONE", common: false, oracleMaintained: false, hasNavAnsattGrantee: true },
			{ name: "BATCH_ROLE", authType: "NONE", common: false, oracleMaintained: false, hasNavAnsattGrantee: false },
		],
	}
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

		const response = await fetchWithAuth(`/api/m2m/${encodeURIComponent(instanceId)}/evidence/roles`)
		const data = (await response.json()) as OracleRolesResponse
		rolesCache.set(instanceId, { data, fetchedAt: Date.now() })
		return data
	} catch {
		// fetchWithAuth already logs the error details
		return null
	}
}
