import { and, desc, eq, inArray, isNull, notExists, sql } from "drizzle-orm"
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
import { devTeams, sectionEnvironments, sections } from "../schema/organization"

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

/**
 * Beregner samlet audit-status for en persistens basert på: Oracle-revisjonsdata,
 * Nais auditLogging-flagg, eller manuell bekreftelse. Ren funksjon.
 */
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

// ─── Ensure persistence entries for Oracle instances ─────────────────────────

/**
 * Sørg for at det finnes aktive `application_persistence`-rader for de gitte
 * Oracle-instansene under `appId`. Hver instans behandles atomisk i sin egen
 * transaksjon med `SELECT ... FOR UPDATE` for å hindre TOCTOU-duplikater
 * mellom samtidige kall (loadere kjører parallelt med actions).
 *
 * Hvis det allerede finnes en aktiv rad: ingen endring. Hvis kun en arkivert
 * rad finnes: reaktiveres (audit-logges som `persistence_unarchived` med
 * `metadata.reason = "oracle_instance_ensure"`). Hvis ingen rad finnes:
 * opprettes en ny aktiv rad. Returnerer alle berørte (nye eller reaktiverte)
 * rader.
 */
export async function ensureOraclePersistenceEntries(appId: string, instanceIds: string[], performedBy: string) {
	const { writeAuditLog } = await import("./audit.server")
	const results: (typeof applicationPersistence.$inferSelect)[] = []
	for (const instanceId of instanceIds) {
		const affected = await ensureOneOraclePersistenceEntry(appId, instanceId, performedBy, writeAuditLog)
		if (affected) results.push(affected)
	}
	return results
}

async function ensureOneOraclePersistenceEntry(
	appId: string,
	instanceId: string,
	performedBy: string,
	writeAuditLog: typeof import("./audit.server").writeAuditLog,
): Promise<typeof applicationPersistence.$inferSelect | null> {
	try {
		return await db.transaction(async (tx) => {
			// Deterministisk utvelgelse: foretrekk aktive rader (`archived_at IS NULL`)
			// før eventuelle arkiverte duplikater. `FOR UPDATE` låser raden slik at
			// to samtidige kall ikke ender opp med å reaktivere/sette inn duplikat.
			const [existing] = await tx
				.select()
				.from(applicationPersistence)
				.where(
					and(
						eq(applicationPersistence.applicationId, appId),
						eq(applicationPersistence.type, "oracle"),
						eq(applicationPersistence.name, instanceId),
					),
				)
				.orderBy(sql`${applicationPersistence.archivedAt} NULLS FIRST`, applicationPersistence.discoveredAt)
				.for("update")
				.limit(1)

			if (existing?.archivedAt) {
				const previousArchivedAt = existing.archivedAt
				const [restored] = await tx
					.update(applicationPersistence)
					.set({ archivedAt: null, archivedBy: null, updatedAt: new Date() })
					.where(eq(applicationPersistence.id, existing.id))
					.returning()
				await writeAuditLog(
					{
						action: "persistence_unarchived",
						entityType: "application_persistence",
						entityId: existing.id,
						previousValue: JSON.stringify({
							type: existing.type,
							name: existing.name,
							archivedAt: previousArchivedAt,
						}),
						newValue: JSON.stringify({ type: existing.type, name: existing.name }),
						metadata: { applicationId: appId, reason: "oracle_instance_ensure" },
						performedBy,
					},
					tx,
				)
				return restored
			}

			if (existing) return null

			const [row] = await tx
				.insert(applicationPersistence)
				.values({
					applicationId: appId,
					type: "oracle",
					name: instanceId,
					oracleInstanceId: instanceId,
				})
				.returning()
			return row ?? null
		})
	} catch (err: unknown) {
		// Concurrent INSERT race: en annen transaksjon vant innsettingen mot
		// partial unique-indeksen `application_persistence_active_unique_idx`.
		// Behandle som no-op — den vinnende transaksjonens rad er nå den
		// aktive, og denne kalleren har ingen ny rad å rapportere.
		if (isUniqueViolation(err)) return null
		throw err
	}
}

function isUniqueViolation(err: unknown): boolean {
	return typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === "23505"
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
	preloadedKnownInstanceIds?: Set<string>,
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
		.where(
			and(inArray(applicationOracleInstances.applicationId, appIds), isNull(applicationOracleInstances.archivedAt)),
		)

	// Group configured instances by app
	const instancesByApp = new Map<string, string[]>()
	for (const inst of configuredInstances) {
		const list = instancesByApp.get(inst.applicationId) ?? []
		list.push(inst.instanceId)
		instancesByApp.set(inst.applicationId, list)
	}

	const persistenceIds = oracleEntries.map((p) => p.id)

	// Read cached summaries from DB
	const cached =
		persistenceIds.length > 0
			? await db
					.select()
					.from(persistenceAuditSummaries)
					.where(inArray(persistenceAuditSummaries.persistenceId, persistenceIds))
			: []

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
	const oracleModule = await import("~/lib/oracle-revisjon.server")

	let knownInstanceIds: Set<string>
	if (preloadedKnownInstanceIds) {
		knownInstanceIds = preloadedKnownInstanceIds
	} else {
		const allOracleInstances = await oracleModule.getOracleInstances()
		knownInstanceIds = new Set(allOracleInstances.map((i) => i.id))
	}

	const fetchResults = await Promise.allSettled(
		misses
			.filter((p) => knownInstanceIds.has(p.instanceId))
			.map(async (p) => {
				const summary = await oracleModule.getAuditEvidenceSummary(p.instanceId)
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
		instanceGroup: null,
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
		.where(
			and(
				eq(devTeams.sectionId, sectionId),
				isNull(applicationTeamMappings.archivedAt),
				isNull(monitoredApplications.primaryApplicationId),
			),
		)
	for (const row of directRows) appIds.add(row.appId)

	// Path 2: Apps from Nais teams linked to dev teams in this section
	const linkedNaisTeamRows = await db
		.selectDistinct({ naisTeamId: devTeamNaisTeamMappings.naisTeamId })
		.from(devTeamNaisTeamMappings)
		.innerJoin(devTeams, eq(devTeamNaisTeamMappings.devTeamId, devTeams.id))
		.where(and(eq(devTeams.sectionId, sectionId), isNull(devTeamNaisTeamMappings.archivedAt)))

	const linkedNaisTeamIds = linkedNaisTeamRows.map((r) => r.naisTeamId)

	// Path 3: Apps from Nais teams directly assigned to this section
	const sectionNaisTeamRows = await db
		.select({ id: naisTeams.id })
		.from(naisTeams)
		.where(eq(naisTeams.sectionId, sectionId))

	const sectionNaisTeamIds = sectionNaisTeamRows.map((r) => r.id)

	const allNaisTeamIds = [...new Set([...linkedNaisTeamIds, ...sectionNaisTeamIds])]

	if (allNaisTeamIds.length > 0) {
		// Get excluded clusters for this section
		const excludedClusters = await db
			.select({ cluster: sectionEnvironments.cluster })
			.from(sectionEnvironments)
			.where(and(eq(sectionEnvironments.sectionId, sectionId), eq(sectionEnvironments.included, false)))

		const excludedClusterList = excludedClusters.map((r) => r.cluster)

		const naisAppRows = await db
			.selectDistinct({ appId: applicationEnvironments.applicationId })
			.from(applicationEnvironments)
			.innerJoin(monitoredApplications, eq(applicationEnvironments.applicationId, monitoredApplications.id))
			.where(
				and(
					inArray(applicationEnvironments.naisTeamId, allNaisTeamIds),
					isNull(monitoredApplications.primaryApplicationId),
					excludedClusterList.length > 0
						? notExists(
								db
									.select({ cluster: sectionEnvironments.cluster })
									.from(sectionEnvironments)
									.where(
										and(
											eq(sectionEnvironments.cluster, applicationEnvironments.cluster),
											eq(sectionEnvironments.sectionId, sectionId),
											eq(sectionEnvironments.included, false),
										),
									),
							)
						: sql`TRUE`,
				),
			)
		for (const row of naisAppRows) appIds.add(row.appId)
	}

	// Exclude ignored apps
	const ignoredRows = await db
		.select({ appId: sectionIgnoredApplications.applicationId })
		.from(sectionIgnoredApplications)
		.where(and(eq(sectionIgnoredApplications.sectionId, sectionId), isNull(sectionIgnoredApplications.archivedAt)))
	for (const row of ignoredRows) appIds.delete(row.appId)

	return appIds
}

// ─── Section audit overview query ───────────────────────────────────────────

/**
 * Returnerer aggregert oversikt over audit-status for alle persistenser
 * i en seksjon (én rad per persistens med status, type og evt. bekreftelse).
 */
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
				isNull(applicationPersistence.archivedAt),
			),
		)
		.orderBy(monitoredApplications.name, applicationPersistence.type)

	// Find Oracle instances for section apps that don't have a matching persistence entry
	const oracleInstanceRows = await db
		.select({
			instanceId: applicationOracleInstances.instanceId,
			appId: monitoredApplications.id,
			appName: monitoredApplications.name,
		})
		.from(applicationOracleInstances)
		.innerJoin(monitoredApplications, eq(applicationOracleInstances.applicationId, monitoredApplications.id))
		.where(
			and(
				inArray(applicationOracleInstances.applicationId, [...sectionAppIds]),
				isNull(applicationOracleInstances.archivedAt),
			),
		)

	// Determine which Oracle instances already have a matching persistence entry
	const coveredInstancesByApp = new Map<string, Set<string>>()
	for (const row of persistenceRows) {
		if (row.persistenceType !== "oracle") continue
		const set = coveredInstancesByApp.get(row.appId) ?? new Set()
		set.add(row.persistenceName.toLowerCase())
		coveredInstancesByApp.set(row.appId, set)
	}
	// Also check oracleInstanceId links on persistence entries
	const linkedInstances = await db
		.select({
			appId: applicationPersistence.applicationId,
			oracleInstanceId: applicationPersistence.oracleInstanceId,
		})
		.from(applicationPersistence)
		.where(
			and(
				inArray(applicationPersistence.applicationId, [...sectionAppIds]),
				eq(applicationPersistence.type, "oracle"),
				isNull(applicationPersistence.archivedAt),
			),
		)
	for (const row of linkedInstances) {
		if (!row.oracleInstanceId) continue
		const set = coveredInstancesByApp.get(row.appId) ?? new Set()
		set.add(row.oracleInstanceId.toLowerCase())
		coveredInstancesByApp.set(row.appId, set)
	}

	const orphanOracleInstances = oracleInstanceRows.filter((inst) => {
		const covered = coveredInstancesByApp.get(inst.appId)
		return !covered?.has(inst.instanceId.toLowerCase())
	})

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
		.where(
			and(
				inArray(applicationTeamMappings.applicationId, [...sectionAppIds]),
				isNull(applicationTeamMappings.archivedAt),
			),
		)
	for (const row of teamRows) {
		if (!appTeamMap.has(row.appId)) {
			appTeamMap.set(row.appId, { teamName: row.teamName, teamSlug: row.teamSlug })
		}
	}

	const rows: AuditOverviewRow[] = persistenceRows.map((row) => {
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

	// Add orphan Oracle instances (configured but without persistence entries)
	// Create real persistence entries for these so caching works going forward
	for (const inst of orphanOracleInstances) {
		const [newPersistence] = await db
			.insert(applicationPersistence)
			.values({
				applicationId: inst.appId,
				type: "oracle",
				name: inst.instanceId,
				oracleInstanceId: inst.instanceId,
			})
			.returning({ id: applicationPersistence.id })

		if (!newPersistence) continue

		const team = appTeamMap.get(inst.appId)
		rows.push({
			persistenceId: newPersistence.id,
			appId: inst.appId,
			appName: inst.appName,
			teamName: team?.teamName ?? null,
			teamSlug: team?.teamSlug ?? null,
			persistenceType: "oracle",
			persistenceName: inst.instanceId.toUpperCase(),
			auditLogging: null,
			summary: null,
			confirmation: null,
			status: "unknown",
		})
	}

	rows.sort((a, b) => a.appName.localeCompare(b.appName, "nb"))
	return rows
}

// ─── Manual confirmation CRUD ───────────────────────────────────────────────

/**
 * Oppretter en manuell audit-bekreftelse for en persistens. Kjører i transaksjon
 * og skriver audit-logg-entry samtidig.
 */
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

/**
 * Tilbakekaller en audit-bekreftelse atomisk (kun hvis ikke allerede revoked).
 * Kjører i transaksjon og skriver audit-logg.
 */
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
