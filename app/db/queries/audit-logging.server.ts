import { and, desc, eq, inArray, isNull } from "drizzle-orm"
import type { AuditEvidenceSummary } from "~/lib/oracle-revisjon.server"
import { db } from "../connection.server"
import {
	applicationEnvironments,
	applicationPersistence,
	applicationTeamMappings,
	devTeamNaisTeamMappings,
	monitoredApplications,
	naisTeams,
	sectionIgnoredApplications,
} from "../schema/applications"
import { auditLog } from "../schema/audit"
import { applicationOracleInstances } from "../schema/audit-evidence"
import type { AuditConclusion } from "../schema/audit-logging"
import { persistenceAuditConfirmations, persistenceAuditSummaries } from "../schema/audit-logging"
import { devTeams, sections } from "../schema/organization"

// ─── Types ──────────────────────────────────────────────────────────────────

export type AuditLoggingStatus = "active" | "partial" | "inactive" | "unknown" | "confirmed"

export interface AuditOverviewRow {
	persistenceId: string
	appId: string
	appName: string
	teamName: string | null
	teamSlug: string | null
	persistenceType: string
	persistenceName: string
	auditLogging: boolean | null
	summary: {
		conclusion: string
		reason: string | null
		fetchedAt: Date
		findings: Array<{ severity: string; message: string }> | null
	} | null
	confirmation: {
		id: string
		enabledAt: string
		description: string
		evidenceUrl: string
		confirmedBy: string
		confirmedAt: Date
	} | null
	status: AuditLoggingStatus
}

// ─── Database types that should appear in the overview ──────────────────────

const DATABASE_TYPES = ["cloud_sql_postgres", "nais_postgres", "on_prem_postgres", "oracle", "opensearch"] as const

// ─── Unified status computation ─────────────────────────────────────────────

export function computeAuditStatus(
	persistenceType: string,
	auditLogging: boolean | null,
	summaryConclusion: string | null,
	hasActiveConfirmation: boolean,
): AuditLoggingStatus {
	// Oracle with summary data from oracle-revisjon
	if (persistenceType === "oracle" && summaryConclusion) {
		switch (summaryConclusion) {
			case "FULLSTENDIG":
				return "active"
			case "MANGELFULL":
				return "partial"
			case "AV":
				return "inactive"
			default:
				return hasActiveConfirmation ? "confirmed" : "unknown"
		}
	}

	// Cloud SQL with auditLogging flag from Nais
	if (persistenceType === "cloud_sql_postgres" && auditLogging !== null) {
		return auditLogging ? "active" : "inactive"
	}

	// Manual confirmation for any type
	if (hasActiveConfirmation) {
		return "confirmed"
	}

	return "unknown"
}

// ─── Cached Oracle audit summaries for app detail page ──────────────────────

/**
 * Resolve the Oracle instance ID for a persistence entry.
 * Priority: explicit link > auto-match from configured instances > name fallback.
 */
function resolveOracleInstanceId(
	entry: { name: string; applicationId: string; oracleInstanceId: string | null },
	instancesByApp: Map<string, string[]>,
): string {
	// 1. Explicit link set on the persistence entry
	if (entry.oracleInstanceId) return entry.oracleInstanceId

	// 2. Auto-match: if the app has exactly one configured Oracle instance, use it
	const appInstances = instancesByApp.get(entry.applicationId)
	if (appInstances?.length === 1) return appInstances[0]

	// 3. Check if any configured instance matches the persistence name (case-insensitive)
	if (appInstances) {
		const match = appInstances.find((id) => id.toLowerCase() === entry.name.toLowerCase())
		if (match) return match
	}

	// 4. Fallback to persistence name
	return entry.name
}

/**
 * Get Oracle audit summaries for an app's persistence entries.
 * Reads from the `persistence_audit_summaries` DB cache first.
 * On cache miss, fetches from the oracle-revisjon API, stores in DB, then returns.
 *
 * Instance ID resolution (in priority order):
 * 1. `oracleInstanceId` on the persistence entry (explicit link)
 * 2. Configured Oracle instances from `application_oracle_instances` (auto-match)
 * 3. Persistence `name` (fallback)
 */
export async function getOracleAuditSummariesForApp(
	persistenceEntries: Array<{
		id: string
		name: string
		type: string
		applicationId: string
		oracleInstanceId: string | null
	}>,
): Promise<Record<string, AuditEvidenceSummary>> {
	const oracleEntries = persistenceEntries.filter((p) => p.type === "oracle")
	if (oracleEntries.length === 0) return {}

	// Look up configured Oracle instances for auto-matching
	const appIds = [...new Set(oracleEntries.map((e) => e.applicationId))]
	const configuredInstances = await db
		.select({
			applicationId: applicationOracleInstances.applicationId,
			instanceId: applicationOracleInstances.instanceId,
		})
		.from(applicationOracleInstances)
		.where(inArray(applicationOracleInstances.applicationId, appIds))

	// Group configured instances by app
	const instancesByApp = new Map<string, string[]>()
	for (const inst of configuredInstances) {
		const list = instancesByApp.get(inst.applicationId) ?? []
		list.push(inst.instanceId)
		instancesByApp.set(inst.applicationId, list)
	}

	const persistenceIds = oracleEntries.map((p) => p.id)

	// Read cached summaries from DB
	const cached = await db
		.select()
		.from(persistenceAuditSummaries)
		.where(inArray(persistenceAuditSummaries.persistenceId, persistenceIds))

	const cachedMap = new Map(cached.map((c) => [c.persistenceId, c]))

	const result: Record<string, AuditEvidenceSummary> = {}

	// Populate from cache and track misses
	const misses: Array<{ id: string; instanceId: string }> = []
	for (const entry of oracleEntries) {
		const cachedEntry = cachedMap.get(entry.id)
		if (cachedEntry) {
			result[entry.id] = dbSummaryToApiSummary(cachedEntry)
		} else {
			const instanceId = resolveOracleInstanceId(entry, instancesByApp)
			misses.push({ id: entry.id, instanceId })
		}
	}

	if (misses.length === 0) return result

	// Lazy-import to avoid circular dependencies
	const { getOracleInstances, getAuditEvidenceSummary } = await import("~/lib/oracle-revisjon.server")

	const allOracleInstances = await getOracleInstances()
	const knownInstanceIds = new Set(allOracleInstances.map((i) => i.id))

	const fetchResults = await Promise.allSettled(
		misses
			.filter((p) => knownInstanceIds.has(p.instanceId))
			.map(async (p) => {
				const summary = await getAuditEvidenceSummary(p.instanceId)
				return { persistenceId: p.id, summary }
			}),
	)

	const now = new Date()
	for (const fetchResult of fetchResults) {
		if (fetchResult.status !== "fulfilled" || !fetchResult.value.summary) continue

		const { persistenceId, summary } = fetchResult.value
		result[persistenceId] = summary

		// Store in DB for future cache hits
		await db
			.insert(persistenceAuditSummaries)
			.values({
				persistenceId,
				conclusion: summary.conclusion as AuditConclusion,
				reason: summary.reason,
				unifiedAuditingEnabled: summary.unifiedAuditingEnabled,
				activePolicyCount: summary.activePolicyCount,
				auditedObjectCount: summary.auditedObjectCount,
				unauditedTableCount: summary.unauditedTableCount,
				excludedUserCount: summary.excludedUserCount,
				policiesWithoutFailureAudit: summary.policiesWithoutFailureAudit,
				hasAuditTrailData: summary.hasAuditTrailData,
				findings: summary.findings,
				fetchedAt: now,
				lastSyncAttemptedAt: now,
				createdBy: "on-demand-fetch",
				updatedBy: "on-demand-fetch",
			})
			.onConflictDoUpdate({
				target: persistenceAuditSummaries.persistenceId,
				set: {
					conclusion: summary.conclusion as AuditConclusion,
					reason: summary.reason,
					unifiedAuditingEnabled: summary.unifiedAuditingEnabled,
					activePolicyCount: summary.activePolicyCount,
					auditedObjectCount: summary.auditedObjectCount,
					unauditedTableCount: summary.unauditedTableCount,
					excludedUserCount: summary.excludedUserCount,
					policiesWithoutFailureAudit: summary.policiesWithoutFailureAudit,
					hasAuditTrailData: summary.hasAuditTrailData,
					findings: summary.findings,
					fetchedAt: now,
					lastSyncAttemptedAt: now,
					updatedAt: now,
					updatedBy: "on-demand-fetch",
				},
			})
	}

	return result
}

function dbSummaryToApiSummary(row: typeof persistenceAuditSummaries.$inferSelect): AuditEvidenceSummary {
	return {
		conclusion: row.conclusion,
		reason: row.reason ?? "",
		unifiedAuditingEnabled: row.unifiedAuditingEnabled ?? false,
		activePolicyCount: row.activePolicyCount ?? 0,
		auditedObjectCount: row.auditedObjectCount ?? 0,
		unauditedTableCount: row.unauditedTableCount ?? 0,
		excludedUserCount: row.excludedUserCount ?? 0,
		policiesWithoutFailureAudit: row.policiesWithoutFailureAudit ?? 0,
		hasAuditTrailData: row.hasAuditTrailData ?? false,
		findings: (row.findings ?? []) as AuditEvidenceSummary["findings"],
	}
}

// ─── Section app discovery (matches getSectionDetail logic) ─────────────────

async function getSectionAppIds(sectionId: string): Promise<Set<string>> {
	const appIds = new Set<string>()

	// Path 1: Apps directly mapped to dev teams in this section
	const directRows = await db
		.selectDistinct({ appId: applicationTeamMappings.applicationId })
		.from(applicationTeamMappings)
		.innerJoin(devTeams, eq(applicationTeamMappings.devTeamId, devTeams.id))
		.innerJoin(monitoredApplications, eq(applicationTeamMappings.applicationId, monitoredApplications.id))
		.where(and(eq(devTeams.sectionId, sectionId), isNull(monitoredApplications.primaryApplicationId)))
	for (const row of directRows) appIds.add(row.appId)

	// Path 2: Apps from Nais teams linked to dev teams in this section
	const linkedNaisTeamRows = await db
		.selectDistinct({ naisTeamId: devTeamNaisTeamMappings.naisTeamId })
		.from(devTeamNaisTeamMappings)
		.innerJoin(devTeams, eq(devTeamNaisTeamMappings.devTeamId, devTeams.id))
		.where(eq(devTeams.sectionId, sectionId))

	const linkedNaisTeamIds = linkedNaisTeamRows.map((r) => r.naisTeamId)

	// Path 3: Apps from Nais teams directly assigned to this section
	const sectionNaisTeamRows = await db
		.select({ id: naisTeams.id })
		.from(naisTeams)
		.where(eq(naisTeams.sectionId, sectionId))

	const sectionNaisTeamIds = sectionNaisTeamRows.map((r) => r.id)

	const allNaisTeamIds = [...new Set([...linkedNaisTeamIds, ...sectionNaisTeamIds])]

	if (allNaisTeamIds.length > 0) {
		const naisAppRows = await db
			.selectDistinct({ appId: applicationEnvironments.applicationId })
			.from(applicationEnvironments)
			.innerJoin(monitoredApplications, eq(applicationEnvironments.applicationId, monitoredApplications.id))
			.where(
				and(
					inArray(applicationEnvironments.naisTeamId, allNaisTeamIds),
					isNull(monitoredApplications.primaryApplicationId),
				),
			)
		for (const row of naisAppRows) appIds.add(row.appId)
	}

	// Exclude ignored apps
	const ignoredRows = await db
		.select({ appId: sectionIgnoredApplications.applicationId })
		.from(sectionIgnoredApplications)
		.where(eq(sectionIgnoredApplications.sectionId, sectionId))
	for (const row of ignoredRows) appIds.delete(row.appId)

	return appIds
}

// ─── Section audit overview query ───────────────────────────────────────────

export async function getSectionAuditOverview(sectionSlug: string): Promise<AuditOverviewRow[]> {
	const [section] = await db.select({ id: sections.id }).from(sections).where(eq(sections.slug, sectionSlug)).limit(1)
	if (!section) return []

	const sectionAppIds = await getSectionAppIds(section.id)
	if (sectionAppIds.size === 0) return []

	// Get all persistence entries with database types for section apps
	const persistenceRows = await db
		.select({
			persistenceId: applicationPersistence.id,
			appId: monitoredApplications.id,
			appName: monitoredApplications.name,
			persistenceType: applicationPersistence.type,
			persistenceName: applicationPersistence.name,
			auditLogging: applicationPersistence.auditLogging,
			// Summary fields
			summaryConclusion: persistenceAuditSummaries.conclusion,
			summaryReason: persistenceAuditSummaries.reason,
			summaryFetchedAt: persistenceAuditSummaries.fetchedAt,
			summaryFindings: persistenceAuditSummaries.findings,
			// Confirmation fields
			confirmationId: persistenceAuditConfirmations.id,
			confirmationEnabledAt: persistenceAuditConfirmations.enabledAt,
			confirmationDescription: persistenceAuditConfirmations.description,
			confirmationEvidenceUrl: persistenceAuditConfirmations.evidenceUrl,
			confirmationConfirmedBy: persistenceAuditConfirmations.confirmedBy,
			confirmationConfirmedAt: persistenceAuditConfirmations.confirmedAt,
		})
		.from(applicationPersistence)
		.innerJoin(monitoredApplications, eq(applicationPersistence.applicationId, monitoredApplications.id))
		.leftJoin(persistenceAuditSummaries, eq(applicationPersistence.id, persistenceAuditSummaries.persistenceId))
		.leftJoin(
			persistenceAuditConfirmations,
			and(
				eq(applicationPersistence.id, persistenceAuditConfirmations.persistenceId),
				isNull(persistenceAuditConfirmations.revokedAt),
			),
		)
		.where(
			and(
				inArray(applicationPersistence.applicationId, [...sectionAppIds]),
				inArray(applicationPersistence.type, [...DATABASE_TYPES]),
			),
		)
		.orderBy(monitoredApplications.name, applicationPersistence.type)

	// Look up team name for each app (best-effort, may be null for unassigned apps)
	const appTeamMap = new Map<string, { teamName: string; teamSlug: string }>()
	const teamRows = await db
		.select({
			appId: applicationTeamMappings.applicationId,
			teamName: devTeams.name,
			teamSlug: devTeams.slug,
		})
		.from(applicationTeamMappings)
		.innerJoin(devTeams, and(eq(applicationTeamMappings.devTeamId, devTeams.id), eq(devTeams.sectionId, section.id)))
		.where(inArray(applicationTeamMappings.applicationId, [...sectionAppIds]))
	for (const row of teamRows) {
		if (!appTeamMap.has(row.appId)) {
			appTeamMap.set(row.appId, { teamName: row.teamName, teamSlug: row.teamSlug })
		}
	}

	return persistenceRows.map((row) => {
		const team = appTeamMap.get(row.appId)
		return {
			persistenceId: row.persistenceId,
			appId: row.appId,
			appName: row.appName,
			teamName: team?.teamName ?? null,
			teamSlug: team?.teamSlug ?? null,
			persistenceType: row.persistenceType,
			persistenceName: row.persistenceName,
			auditLogging: row.auditLogging,
			summary: row.summaryConclusion
				? {
						conclusion: row.summaryConclusion,
						reason: row.summaryReason,
						fetchedAt: row.summaryFetchedAt ?? new Date(),
						findings: row.summaryFindings,
					}
				: null,
			confirmation: row.confirmationId
				? {
						id: row.confirmationId,
						enabledAt: row.confirmationEnabledAt ?? "",
						description: row.confirmationDescription ?? "",
						evidenceUrl: row.confirmationEvidenceUrl ?? "",
						confirmedBy: row.confirmationConfirmedBy ?? "",
						confirmedAt: row.confirmationConfirmedAt ?? new Date(),
					}
				: null,
			status: computeAuditStatus(
				row.persistenceType,
				row.auditLogging,
				row.summaryConclusion,
				row.confirmationId !== null,
			),
		}
	})
}

// ─── Manual confirmation CRUD ───────────────────────────────────────────────

export async function createAuditConfirmation(params: {
	persistenceId: string
	enabledAt: string
	description: string
	evidenceUrl: string
	performedBy: string
	metadata?: Record<string, unknown>
}) {
	return db.transaction(async (tx) => {
		const [confirmation] = await tx
			.insert(persistenceAuditConfirmations)
			.values({
				persistenceId: params.persistenceId,
				enabledAt: params.enabledAt,
				description: params.description,
				evidenceUrl: params.evidenceUrl,
				confirmedBy: params.performedBy,
				createdBy: params.performedBy,
				updatedBy: params.performedBy,
			})
			.returning()

		await tx.insert(auditLog).values({
			action: "audit_confirmation_created",
			entityType: "persistence_audit_confirmation",
			entityId: confirmation.id,
			newValue: JSON.stringify({
				persistenceId: params.persistenceId,
				enabledAt: params.enabledAt,
				description: params.description,
				evidenceUrl: params.evidenceUrl,
			}),
			metadata: params.metadata ? JSON.stringify(params.metadata) : null,
			performedBy: params.performedBy,
		})

		return confirmation
	})
}

export async function updateAuditConfirmation(params: {
	confirmationId: string
	enabledAt: string
	description: string
	evidenceUrl: string
	performedBy: string
	metadata?: Record<string, unknown>
}) {
	return db.transaction(async (tx) => {
		const [existing] = await tx
			.select()
			.from(persistenceAuditConfirmations)
			.where(
				and(
					eq(persistenceAuditConfirmations.id, params.confirmationId),
					isNull(persistenceAuditConfirmations.revokedAt),
				),
			)
			.limit(1)

		if (!existing) throw new Error(`Confirmation not found or already revoked: ${params.confirmationId}`)

		const [updated] = await tx
			.update(persistenceAuditConfirmations)
			.set({
				enabledAt: params.enabledAt,
				description: params.description,
				evidenceUrl: params.evidenceUrl,
				updatedAt: new Date(),
				updatedBy: params.performedBy,
			})
			.where(
				and(
					eq(persistenceAuditConfirmations.id, params.confirmationId),
					isNull(persistenceAuditConfirmations.revokedAt),
				),
			)
			.returning()

		if (!updated) throw new Error(`Confirmation was revoked during update: ${params.confirmationId}`)

		await tx.insert(auditLog).values({
			action: "audit_confirmation_updated",
			entityType: "persistence_audit_confirmation",
			entityId: params.confirmationId,
			previousValue: JSON.stringify({
				enabledAt: existing.enabledAt,
				description: existing.description,
				evidenceUrl: existing.evidenceUrl,
			}),
			newValue: JSON.stringify({
				enabledAt: params.enabledAt,
				description: params.description,
				evidenceUrl: params.evidenceUrl,
			}),
			metadata: params.metadata ? JSON.stringify(params.metadata) : null,
			performedBy: params.performedBy,
		})

		return updated
	})
}

export async function revokeAuditConfirmation(params: {
	confirmationId: string
	performedBy: string
	metadata?: Record<string, unknown>
}) {
	return db.transaction(async (tx) => {
		// Atomic conditional update: only revoke if not already revoked
		const [revoked] = await tx
			.update(persistenceAuditConfirmations)
			.set({
				revokedAt: new Date(),
				revokedBy: params.performedBy,
				updatedAt: new Date(),
				updatedBy: params.performedBy,
			})
			.where(
				and(
					eq(persistenceAuditConfirmations.id, params.confirmationId),
					isNull(persistenceAuditConfirmations.revokedAt),
				),
			)
			.returning()

		if (!revoked) throw new Error(`Confirmation not found or already revoked: ${params.confirmationId}`)

		await tx.insert(auditLog).values({
			action: "audit_confirmation_revoked",
			entityType: "persistence_audit_confirmation",
			entityId: params.confirmationId,
			previousValue: JSON.stringify({
				enabledAt: revoked.enabledAt,
				description: revoked.description,
				evidenceUrl: revoked.evidenceUrl,
			}),
			metadata: params.metadata ? JSON.stringify(params.metadata) : null,
			performedBy: params.performedBy,
		})

		return revoked
	})
}

// ─── Audit confirmation log for a section ───────────────────────────────────

export async function getAuditConfirmationLog(sectionSlug: string, limit = 50) {
	const [section] = await db.select({ id: sections.id }).from(sections).where(eq(sections.slug, sectionSlug)).limit(1)
	if (!section) return []

	const sectionAppIds = await getSectionAppIds(section.id)
	if (sectionAppIds.size === 0) return []

	// Get all persistence IDs for section apps
	const sectionPersistenceIds = db
		.selectDistinct({ id: applicationPersistence.id })
		.from(applicationPersistence)
		.where(inArray(applicationPersistence.applicationId, [...sectionAppIds]))

	// Get all confirmation IDs for this section's persistence
	const confirmationIds = await db
		.selectDistinct({ id: persistenceAuditConfirmations.id })
		.from(persistenceAuditConfirmations)
		.where(inArray(persistenceAuditConfirmations.persistenceId, sectionPersistenceIds))

	if (confirmationIds.length === 0) return []

	return db
		.select()
		.from(auditLog)
		.where(
			and(
				eq(auditLog.entityType, "persistence_audit_confirmation"),
				inArray(
					auditLog.entityId,
					confirmationIds.map((c) => c.id),
				),
			),
		)
		.orderBy(desc(auditLog.performedAt))
		.limit(limit)
}
