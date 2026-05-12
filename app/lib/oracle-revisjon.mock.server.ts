import type {
	AuditConclusion,
	AuditEvidence,
	AuditEvidenceSummary,
	AuditFinding,
	EvidenceCatalog,
	EvidenceInstanceInfo,
	EvidenceStatus,
	OracleInstance,
	OracleRolesResponse,
} from "./oracle-revisjon.server"

export const MOCK_ORACLE_GROUP = "1e97cbc6-0687-4d23-aebd-c611035279c1"

export function getMockInstances(): OracleInstance[] {
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

export function getMockEvidence(instanceId: string): AuditEvidence {
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

export function getMockSummary(instanceId: string): AuditEvidenceSummary {
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

export function getMockRoles(instanceId: string): OracleRolesResponse {
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

// --- Mock data for evidence API ---

export function getMockEvidenceInstances(): EvidenceInstanceInfo[] {
	return [
		{ id: "pen", name: "PESYS Prod", type: "PESYS" },
		{ id: "sam", name: "SAM Prod", type: "SAM" },
		{ id: "tp", name: "TP Prod", type: "TP" },
	]
}

export function getMockEvidenceCatalog(): EvidenceCatalog {
	return {
		evidenceTypes: [
			{
				type: "audit",
				title: "Oracle Unified Audit-konfigurasjon",
				description: "Revisjonsbevis for Oracle Unified Audit — logger, policyer, dekning, funn og konklusjon.",
				formats: ["EXCEL", "PDF"],
				requiresPeriod: false,
				periodConstraints: null,
			},
			{
				type: "profiles",
				title: "Oracle-profiler",
				description: "Revisjonsbevis for Oracle-profiler — profilparametre og innstillinger.",
				formats: ["EXCEL", "PDF"],
				requiresPeriod: false,
				periodConstraints: null,
			},
			{
				type: "roles",
				title: "Oracle-roller",
				description: "Revisjonsbevis for Oracle-roller — roller, privilegier og tilordninger.",
				formats: ["EXCEL"],
				requiresPeriod: false,
				periodConstraints: null,
			},
			{
				type: "users",
				title: "Oracle-brukere",
				description: "Revisjonsbevis for Oracle-brukere — brukere, privilegier og passordinnstillinger.",
				formats: ["EXCEL"],
				requiresPeriod: false,
				periodConstraints: null,
			},
			{
				type: "period",
				title: "Periodebasert gjennomgang",
				description: "Skriveoperasjoner i valgt periode, partisjonert i reviderte og ureviderte statements.",
				formats: ["EXCEL"],
				requiresPeriod: true,
				periodConstraints: { maxDays: 366, maxStatements: 100000 },
			},
		],
	}
}

export function getMockEvidenceStatus(instanceId: string, fromUtc?: string, toUtc?: string): EvidenceStatus {
	const instances = getMockEvidenceInstances()
	const instance = instances.find((i) => i.id === instanceId) ?? instances[0]
	const queryString = fromUtc
		? (() => {
				const params = new URLSearchParams()
				params.set("fromUtc", fromUtc)
				params.set("toUtc", toUtc ?? fromUtc)
				return `?${params.toString()}`
			})()
		: ""
	return {
		instanceId,
		instanceName: instance.name,
		collectedAt: new Date().toISOString(),
		reviewUrl: `https://pensjon-oracle-revisjon.ansatt.nav.no/${instanceId}/audit/review${queryString}`,
		evidenceTypes: [
			{
				type: "audit",
				title: "Oracle Unified Audit-konfigurasjon",
				status: "OK",
				formats: ["EXCEL", "PDF"],
				available: true,
				error: null,
				review: null,
			},
			{
				type: "profiles",
				title: "Oracle-profiler",
				status: "OK",
				formats: ["EXCEL", "PDF"],
				available: true,
				error: null,
				review: null,
			},
			{
				type: "roles",
				title: "Oracle-roller",
				status: "OK",
				formats: ["EXCEL"],
				available: true,
				error: null,
				review: null,
			},
			{
				type: "users",
				title: "Oracle-brukere",
				status: "OK",
				formats: ["EXCEL"],
				available: true,
				error: null,
				review: null,
			},
			{
				type: "period",
				title: "Periodebasert gjennomgang",
				status: fromUtc ? "OK" : "PARTIAL",
				formats: ["EXCEL"],
				available: !!fromUtc,
				error: fromUtc ? null : "Periodevalg påkrevd",
				review: fromUtc
					? {
							fromUtc,
							toUtc: toUtc ?? fromUtc,
							totalStatements: 1523,
							reviewedStatements: 1400,
							unreviewedStatements: 123,
							reviewProgress: 91.9,
							syncWatermarkUtc: new Date().toISOString(),
							periodFullySynced: true,
						}
					: null,
			},
		],
	}
}
