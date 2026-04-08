import { getClientCredentialToken } from "./azure.server"
import { logger } from "./logger.server"

const ORACLE_REVISJON_SCOPE = process.env.ORACLE_REVISJON_SCOPE
const ORACLE_REVISJON_BASE_URL = process.env.ORACLE_REVISJON_BASE_URL

// --- Types ---

export interface OracleInstance {
	id: string
	name: string
	schema: string
	type: string
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
	overallStatus: "OK" | "PARTIAL" | "FAILED"
	sections: AuditEvidenceSection[]
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

function getMockInstances(): OracleInstance[] {
	const schemas = [
		{ prefix: "pen", schema: "PEN", type: "pensjon" },
		{ prefix: "sam", schema: "SAM", type: "samordning" },
		{ prefix: "tp", schema: "TP", type: "tjenestepensjon" },
	]
	const environments = ["", "_q0", "_q1", "_q5"]

	return schemas.flatMap(({ prefix, schema, type }) =>
		environments.map((env) => ({
			id: `${prefix}${env}`,
			name: `${prefix}${env}`.toUpperCase(),
			schema: `${schema}${env.toUpperCase()}`,
			type,
		})),
	)
}

function getMockEvidence(instanceId: string): AuditEvidence {
	return {
		collectedAt: new Date().toISOString(),
		instanceId,
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

// --- Public API ---

export async function getOracleInstances(): Promise<OracleInstance[]> {
	if (isDevMode()) {
		logger.warn("ORACLE_REVISJON_BASE_URL not set — returning mock instances")
		return getMockInstances()
	}

	const response = await fetchWithAuth("/api/m2m/audit/evidence/instances")
	return (await response.json()) as OracleInstance[]
}

export async function getAuditEvidence(instanceId: string): Promise<AuditEvidence> {
	if (isDevMode()) {
		logger.warn("ORACLE_REVISJON_BASE_URL not set — returning mock audit evidence", { instanceId })
		return getMockEvidence(instanceId)
	}

	const response = await fetchWithAuth("/api/m2m/audit/evidence", {
		"X-Instance-Id": instanceId,
	})
	return (await response.json()) as AuditEvidence
}

export async function getAuditEvidenceExcel(instanceId: string): Promise<Buffer> {
	if (isDevMode()) {
		logger.warn("ORACLE_REVISJON_BASE_URL not set — returning empty buffer as mock Excel", { instanceId })
		return Buffer.alloc(0)
	}

	const response = await fetchWithAuth("/api/m2m/audit/evidence/excel", {
		"X-Instance-Id": instanceId,
	})
	const arrayBuffer = await response.arrayBuffer()
	return Buffer.from(arrayBuffer)
}
