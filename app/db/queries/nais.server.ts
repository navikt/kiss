import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm"
import { db } from "../connection.server"
import {
	type AuthIntegrationType,
	accessPolicyAcknowledgments,
	applicationAccessPolicyRules,
	applicationAuthIntegrations,
	applicationEnvironments,
	applicationPersistence,
	applicationTeamMappings,
	type LinkSuggestionMatchType,
	type LinkSuggestionStatus,
	linkSuggestions,
	monitoredApplications,
	naisDiscoveredApps,
	naisTeams,
	type PersistenceType,
	sectionIgnoredApplications,
} from "../schema/applications"
import { auditLog } from "../schema/audit"
import { applicationOracleInstances, auditEvidenceSnapshots } from "../schema/audit-evidence"
import { complianceAssessmentHistory, complianceAssessments } from "../schema/compliance"
import { deploymentVerificationSummaries } from "../schema/deployment-audit"
import { devTeams, sections } from "../schema/organization"
import { screeningAnswers } from "../schema/screening"
import { writeAuditLog } from "./audit.server"

/** Get all Nais teams. */
export async function getNaisTeams() {
	return db.select().from(naisTeams).orderBy(naisTeams.slug)
}

/** Get a single Nais team by slug with its apps, environments, and persistence. */
export async function getNaisTeamDetail(slug: string) {
	const [team] = await db.select().from(naisTeams).where(eq(naisTeams.slug, slug)).limit(1)
	if (!team) return null

	// Get section info if linked
	let sectionName: string | null = null
	let sectionSlug: string | null = null
	if (team.sectionId) {
		const [section] = await db.select().from(sections).where(eq(sections.id, team.sectionId)).limit(1)
		sectionName = section?.name ?? null
		sectionSlug = section?.slug ?? null
	}

	// Get apps for this team via applicationEnvironments (excludes linked/child apps)
	const envRows = await db
		.select({
			appId: applicationEnvironments.applicationId,
			appName: monitoredApplications.name,
			cluster: applicationEnvironments.cluster,
			namespace: applicationEnvironments.namespace,
			discoveredAt: applicationEnvironments.discoveredAt,
		})
		.from(applicationEnvironments)
		.innerJoin(monitoredApplications, eq(applicationEnvironments.applicationId, monitoredApplications.id))
		.where(and(eq(applicationEnvironments.naisTeamId, team.id), isNull(monitoredApplications.primaryApplicationId)))
		.orderBy(monitoredApplications.name, applicationEnvironments.cluster)

	// Group by app, collect environments
	const appMap = new Map<
		string,
		{ appId: string; appName: string; environments: Array<{ cluster: string; namespace: string }> }
	>()
	for (const row of envRows) {
		const existing = appMap.get(row.appId)
		if (existing) {
			existing.environments.push({ cluster: row.cluster, namespace: row.namespace })
		} else {
			appMap.set(row.appId, {
				appId: row.appId,
				appName: row.appName,
				environments: [{ cluster: row.cluster, namespace: row.namespace }],
			})
		}
	}

	const appIds = [...appMap.keys()]
	const persistenceMap = await getAppsPersistence(appIds)

	const apps = [...appMap.values()].map((app) => ({
		...app,
		persistence: (persistenceMap.get(app.appId) ?? []).map((p) => ({
			type: p.type,
			name: p.name,
			version: p.version,
		})),
	}))

	return { team, sectionName, sectionSlug, apps }
}

/** Get app count per Nais team (excludes linked/child apps). */
export async function getNaisTeamAppCounts(): Promise<Map<string, number>> {
	const rows = await db
		.select({
			naisTeamId: applicationEnvironments.naisTeamId,
			count: sql<number>`count(DISTINCT ${applicationEnvironments.applicationId})`,
		})
		.from(applicationEnvironments)
		.innerJoin(monitoredApplications, eq(applicationEnvironments.applicationId, monitoredApplications.id))
		.where(isNull(monitoredApplications.primaryApplicationId))
		.groupBy(applicationEnvironments.naisTeamId)

	const map = new Map<string, number>()
	for (const row of rows) {
		if (row.naisTeamId) map.set(row.naisTeamId, Number(row.count))
	}
	return map
}

/** Update a Nais team status. */
export async function updateNaisTeamStatus(slug: string, status: "monitored" | "ignored", reviewedBy: string) {
	await db.update(naisTeams).set({ status, reviewedBy, reviewedAt: new Date() }).where(eq(naisTeams.slug, slug))
	await writeAuditLog({
		action: "nais_team_status_updated",
		entityType: "nais_team",
		entityId: slug,
		newValue: status,
		performedBy: reviewedBy,
	})
}

/** Upsert a Nais team — insert if new, skip if already exists. Returns true if new. */
export async function upsertNaisTeam(slug: string, displayName?: string | null, appCount?: number): Promise<boolean> {
	const [existing] = await db.select().from(naisTeams).where(eq(naisTeams.slug, slug)).limit(1)
	if (existing) {
		const updates: Record<string, unknown> = {}
		if (displayName && displayName !== existing.displayName) updates.displayName = displayName
		if (appCount !== undefined && appCount !== existing.appCount) updates.appCount = appCount
		if (Object.keys(updates).length > 0) {
			await db.update(naisTeams).set(updates).where(eq(naisTeams.slug, slug))
		}
		return false
	}
	await db.insert(naisTeams).values({ slug, displayName, appCount: appCount ?? 0 })
	return true
}

/** Sync discovered app names for a Nais team. Deletes removed apps, upserts current ones. */
export async function syncDiscoveredApps(teamSlug: string, appNames: string[]): Promise<void> {
	const [team] = await db.select({ id: naisTeams.id }).from(naisTeams).where(eq(naisTeams.slug, teamSlug)).limit(1)
	if (!team) return

	await db.transaction(async (tx) => {
		// Delete all existing discovered apps for this team
		await tx.delete(naisDiscoveredApps).where(eq(naisDiscoveredApps.naisTeamId, team.id))

		if (appNames.length === 0) return

		// Deduplicate names (shouldn't happen, but be safe)
		const unique = [...new Set(appNames)]

		await tx.insert(naisDiscoveredApps).values(
			unique.map((name) => ({
				name,
				naisTeamId: team.id,
			})),
		)
	})
}

/** Upsert a monitored application — insert if new, skip if exists. Returns the app. */
export async function upsertMonitoredApp(name: string, createdBy: string): Promise<{ id: string; isNew: boolean }> {
	const [existing] = await db.select().from(monitoredApplications).where(eq(monitoredApplications.name, name)).limit(1)
	if (existing) return { id: existing.id, isNew: false }

	const [app] = await db.insert(monitoredApplications).values({ name, createdBy, updatedBy: createdBy }).returning()
	return { id: app.id, isNew: true }
}

/** Upsert an application environment mapping. Returns true if new. */
export async function upsertAppEnvironment(
	applicationId: string,
	cluster: string,
	namespace: string,
	naisTeamId: string | null,
	imageName?: string | null,
	gitRepository?: string | null,
): Promise<boolean> {
	const [existing] = await db
		.select()
		.from(applicationEnvironments)
		.where(
			sql`${applicationEnvironments.applicationId} = ${applicationId}
				AND ${applicationEnvironments.cluster} = ${cluster}
				AND ${applicationEnvironments.namespace} = ${namespace}`,
		)
		.limit(1)
	if (existing) {
		const updates: Record<string, string> = {}
		if (imageName && imageName !== existing.imageName) updates.imageName = imageName
		if (gitRepository && gitRepository !== existing.gitRepository) updates.gitRepository = gitRepository
		if (Object.keys(updates).length > 0) {
			await db.update(applicationEnvironments).set(updates).where(eq(applicationEnvironments.id, existing.id))
		}
		return false
	}

	await db
		.insert(applicationEnvironments)
		.values({ applicationId, cluster, namespace, naisTeamId, imageName, gitRepository })
	return true
}

/** Get the last sync timestamp from audit log. */
export async function getLastSyncTimestamp(): Promise<Date | null> {
	const [row] = await db
		.select({ performedAt: auditLog.performedAt })
		.from(auditLog)
		.where(eq(auditLog.action, "nais_sync_completed"))
		.orderBy(desc(auditLog.performedAt))
		.limit(1)
	return row?.performedAt ?? null
}

/** Link a Nais team to a section. */
export async function linkNaisTeamToSection(naisTeamSlug: string, sectionId: string, performedBy: string) {
	const [section] = await db.select().from(sections).where(eq(sections.id, sectionId)).limit(1)
	await db.update(naisTeams).set({ sectionId }).where(eq(naisTeams.slug, naisTeamSlug))
	await writeAuditLog({
		action: "nais_team_section_linked",
		entityType: "nais_team",
		entityId: naisTeamSlug,
		newValue: section?.name ?? sectionId,
		performedBy,
	})
}

/** Unlink a Nais team from a section. */
export async function unlinkNaisTeamFromSection(naisTeamSlug: string, performedBy: string) {
	const [team] = await db.select().from(naisTeams).where(eq(naisTeams.slug, naisTeamSlug)).limit(1)
	const [prevSection] = team?.sectionId
		? await db.select().from(sections).where(eq(sections.id, team.sectionId)).limit(1)
		: [null]
	await db.update(naisTeams).set({ sectionId: null }).where(eq(naisTeams.slug, naisTeamSlug))
	await writeAuditLog({
		action: "nais_team_section_unlinked",
		entityType: "nais_team",
		entityId: naisTeamSlug,
		previousValue: prevSection?.name ?? null,
		performedBy,
	})
}

/** Get Nais teams linked to a section. */
export async function getNaisTeamsForSection(sectionId: string) {
	return db.select().from(naisTeams).where(eq(naisTeams.sectionId, sectionId)).orderBy(naisTeams.slug)
}

/** Get unlinked Nais teams (no sectionId, status=monitored). */
export async function getUnlinkedNaisTeams() {
	return db
		.select()
		.from(naisTeams)
		.where(and(isNull(naisTeams.sectionId), eq(naisTeams.status, "monitored")))
		.orderBy(naisTeams.slug)
}

/**
 * Get apps belonging to Nais teams linked to a section that are
 * NOT yet linked to any dev team and NOT ignored.
 */
export async function getUnassignedAppsForSection(sectionId: string) {
	// Get nais teams linked to this section
	const sectionNaisTeams = await db.select().from(naisTeams).where(eq(naisTeams.sectionId, sectionId))
	if (sectionNaisTeams.length === 0) return []

	const naisTeamIds = sectionNaisTeams.map((t) => t.id)

	// Get all apps from those nais teams' environments (excludes linked/child apps)
	const envApps = await db
		.select({
			appId: applicationEnvironments.applicationId,
			appName: monitoredApplications.name,
			cluster: applicationEnvironments.cluster,
			namespace: applicationEnvironments.namespace,
			naisTeamSlug: naisTeams.slug,
		})
		.from(applicationEnvironments)
		.innerJoin(monitoredApplications, eq(applicationEnvironments.applicationId, monitoredApplications.id))
		.innerJoin(naisTeams, eq(applicationEnvironments.naisTeamId, naisTeams.id))
		.where(
			and(
				sql`${applicationEnvironments.naisTeamId} IN (${sql.join(naisTeamIds, sql`, `)})`,
				isNull(monitoredApplications.primaryApplicationId),
			),
		)

	// Get apps that already have a dev team mapping
	const linkedAppIds = new Set(
		(await db.select({ appId: applicationTeamMappings.applicationId }).from(applicationTeamMappings)).map(
			(r) => r.appId,
		),
	)

	// Get apps ignored for this section
	const ignoredAppIds = new Set(
		(
			await db
				.select({ appId: sectionIgnoredApplications.applicationId })
				.from(sectionIgnoredApplications)
				.where(eq(sectionIgnoredApplications.sectionId, sectionId))
		).map((r) => r.appId),
	)

	// Deduplicate by appId and filter out already-linked and ignored apps
	const seen = new Set<string>()
	const unassigned: Array<{ appId: string; appName: string; naisTeamSlug: string; environments: string[] }> = []

	for (const row of envApps) {
		if (linkedAppIds.has(row.appId)) continue
		if (ignoredAppIds.has(row.appId)) continue
		if (seen.has(row.appId)) {
			const existing = unassigned.find((a) => a.appId === row.appId)
			if (existing && !existing.environments.includes(row.cluster)) {
				existing.environments.push(row.cluster)
			}
			continue
		}
		seen.add(row.appId)
		unassigned.push({
			appId: row.appId,
			appName: row.appName,
			naisTeamSlug: row.naisTeamSlug,
			environments: [row.cluster],
		})
	}

	return unassigned.sort((a, b) => a.appName.localeCompare(b.appName))
}

/** Get ignored apps for a section. */
export async function getIgnoredAppsForSection(sectionId: string) {
	return db
		.select({
			id: sectionIgnoredApplications.id,
			appId: sectionIgnoredApplications.applicationId,
			appName: monitoredApplications.name,
			reason: sectionIgnoredApplications.reason,
			ignoredAt: sectionIgnoredApplications.ignoredAt,
			ignoredBy: sectionIgnoredApplications.ignoredBy,
		})
		.from(sectionIgnoredApplications)
		.innerJoin(monitoredApplications, eq(sectionIgnoredApplications.applicationId, monitoredApplications.id))
		.where(eq(sectionIgnoredApplications.sectionId, sectionId))
		.orderBy(monitoredApplications.name)
}

/** Ignore an app for a section. */
export async function ignoreAppForSection(
	sectionId: string,
	applicationId: string,
	ignoredBy: string,
	reason?: string,
) {
	await db.insert(sectionIgnoredApplications).values({
		sectionId,
		applicationId,
		reason: reason || null,
		ignoredBy,
	})
	await writeAuditLog({
		action: "section_app_ignored",
		entityType: "section_ignored_application",
		entityId: applicationId,
		newValue: JSON.stringify({ sectionId, applicationId, reason }),
		metadata: { sectionId },
		performedBy: ignoredBy,
	})
}

/** Unignore an app for a section. */
export async function unignoreAppForSection(sectionId: string, applicationId: string, performedBy: string) {
	await db
		.delete(sectionIgnoredApplications)
		.where(
			and(
				eq(sectionIgnoredApplications.sectionId, sectionId),
				eq(sectionIgnoredApplications.applicationId, applicationId),
			),
		)
	await writeAuditLog({
		action: "section_app_unignored",
		entityType: "section_ignored_application",
		entityId: applicationId,
		previousValue: JSON.stringify({ sectionId, applicationId }),
		metadata: { sectionId },
		performedBy,
	})
}

/** Upsert a persistence resource for an application. */
export async function upsertAppPersistence(
	applicationId: string,
	type: PersistenceType,
	name: string,
	opts?: {
		version?: string | null
		tier?: string | null
		highAvailability?: boolean | null
		auditLogging?: boolean | null
		auditLogUrl?: string | null
	},
): Promise<boolean> {
	const [existing] = await db
		.select()
		.from(applicationPersistence)
		.where(
			and(
				eq(applicationPersistence.applicationId, applicationId),
				eq(applicationPersistence.type, type),
				eq(applicationPersistence.name, name),
			),
		)
		.limit(1)

	if (existing) {
		await db
			.update(applicationPersistence)
			.set({
				version: opts?.version ?? existing.version,
				tier: opts?.tier ?? existing.tier,
				highAvailability: opts?.highAvailability ?? existing.highAvailability,
				auditLogging: opts?.auditLogging ?? existing.auditLogging,
				auditLogUrl: opts?.auditLogUrl ?? existing.auditLogUrl,
				updatedAt: new Date(),
			})
			.where(eq(applicationPersistence.id, existing.id))
		return false
	}

	await db.insert(applicationPersistence).values({
		applicationId,
		type,
		name,
		version: opts?.version ?? null,
		tier: opts?.tier ?? null,
		highAvailability: opts?.highAvailability ?? null,
		auditLogging: opts?.auditLogging ?? null,
		auditLogUrl: opts?.auditLogUrl ?? null,
	})
	return true
}

/** Upsert an auth integration for an application. */
export async function upsertAppAuthIntegration(
	applicationId: string,
	type: AuthIntegrationType,
	opts?: {
		allowAllUsers?: boolean | null
		claimsExtra?: string[] | null
		groups?: string[] | null
		sidecarEnabled?: boolean | null
		inboundRules?: Array<{ application: string; namespace?: string; cluster?: string }> | null
	},
): Promise<boolean> {
	const [existing] = await db
		.select()
		.from(applicationAuthIntegrations)
		.where(
			and(eq(applicationAuthIntegrations.applicationId, applicationId), eq(applicationAuthIntegrations.type, type)),
		)
		.limit(1)

	const claimsExtraStr = opts?.claimsExtra?.length ? JSON.stringify(opts.claimsExtra) : null
	const groupsStr = opts?.groups?.length ? JSON.stringify(opts.groups) : null
	const inboundRulesStr = opts?.inboundRules?.length ? JSON.stringify(opts.inboundRules) : null

	if (existing) {
		await db
			.update(applicationAuthIntegrations)
			.set({
				enabled: true,
				allowAllUsers: opts?.allowAllUsers ?? existing.allowAllUsers,
				claimsExtra: claimsExtraStr ?? existing.claimsExtra,
				groups: groupsStr ?? existing.groups,
				sidecarEnabled: opts?.sidecarEnabled ?? existing.sidecarEnabled,
				inboundRules: inboundRulesStr ?? existing.inboundRules,
				updatedAt: new Date(),
			})
			.where(eq(applicationAuthIntegrations.id, existing.id))
		return false
	}

	await db.insert(applicationAuthIntegrations).values({
		applicationId,
		type,
		allowAllUsers: opts?.allowAllUsers ?? null,
		claimsExtra: claimsExtraStr,
		groups: groupsStr,
		sidecarEnabled: opts?.sidecarEnabled ?? null,
		inboundRules: inboundRulesStr,
	})
	return true
}

/** Get auth integrations for an application. */
export async function getAppAuthIntegrations(applicationId: string) {
	return db
		.select()
		.from(applicationAuthIntegrations)
		.where(eq(applicationAuthIntegrations.applicationId, applicationId))
		.orderBy(applicationAuthIntegrations.type)
}
export async function getAppPersistence(applicationId: string) {
	return db
		.select()
		.from(applicationPersistence)
		.where(eq(applicationPersistence.applicationId, applicationId))
		.orderBy(applicationPersistence.type, applicationPersistence.name)
}

/** Get persistence resources for multiple applications (batch). */
export async function getAppsPersistence(applicationIds: string[]) {
	if (applicationIds.length === 0) return new Map<string, (typeof applicationPersistence.$inferSelect)[]>()

	const rows = await db
		.select()
		.from(applicationPersistence)
		.where(
			sql`${applicationPersistence.applicationId} IN (${sql.join(
				applicationIds.map((id) => sql`${id}`),
				sql`, `,
			)})`,
		)
		.orderBy(applicationPersistence.type, applicationPersistence.name)

	const map = new Map<string, (typeof applicationPersistence.$inferSelect)[]>()
	for (const row of rows) {
		const list = map.get(row.applicationId) ?? []
		list.push(row)
		map.set(row.applicationId, list)
	}
	return map
}

/** Link an Oracle persistence entry to an Oracle instance ID. */
export async function linkPersistenceToOracleInstance(persistenceId: string, oracleInstanceId: string | null) {
	await db
		.update(applicationPersistence)
		.set({ oracleInstanceId, updatedAt: new Date() })
		.where(eq(applicationPersistence.id, persistenceId))
}

/** Get application detail with environments, persistence, and linked apps. */
export async function getApplicationDetail(applicationId: string) {
	const [app] = await db
		.select()
		.from(monitoredApplications)
		.where(eq(monitoredApplications.id, applicationId))
		.limit(1)
	if (!app) return null

	const environments = await db
		.select({
			id: applicationEnvironments.id,
			cluster: applicationEnvironments.cluster,
			namespace: applicationEnvironments.namespace,
			imageName: applicationEnvironments.imageName,
			gitRepository: applicationEnvironments.gitRepository,
			naisTeamSlug: naisTeams.slug,
			discoveredAt: applicationEnvironments.discoveredAt,
		})
		.from(applicationEnvironments)
		.leftJoin(naisTeams, eq(applicationEnvironments.naisTeamId, naisTeams.id))
		.where(eq(applicationEnvironments.applicationId, applicationId))
		.orderBy(applicationEnvironments.cluster)

	const persistence = await getAppPersistence(applicationId)
	const authIntegrations = await getAppAuthIntegrations(applicationId)
	const accessPolicyRules = await getAccessPolicyRules(applicationId)

	const teamMappings = await db
		.select({ teamId: devTeams.id, teamName: devTeams.name, teamSlug: devTeams.slug })
		.from(applicationTeamMappings)
		.innerJoin(devTeams, eq(applicationTeamMappings.devTeamId, devTeams.id))
		.where(eq(applicationTeamMappings.applicationId, applicationId))

	// Get primary application if this is a linked app
	let primaryApp: { id: string; name: string } | null = null
	if (app.primaryApplicationId) {
		const [primary] = await db
			.select({ id: monitoredApplications.id, name: monitoredApplications.name })
			.from(monitoredApplications)
			.where(eq(monitoredApplications.id, app.primaryApplicationId))
			.limit(1)
		primaryApp = primary ?? null
	}

	// Get linked apps if this is a primary
	const linkedApps = await db
		.select({ id: monitoredApplications.id, name: monitoredApplications.name })
		.from(monitoredApplications)
		.where(eq(monitoredApplications.primaryApplicationId, applicationId))
		.orderBy(monitoredApplications.name)

	return {
		app,
		environments,
		persistence,
		authIntegrations,
		accessPolicyRules,
		teams: teamMappings,
		primaryApp,
		linkedApps,
	}
}

/** Link an application to a primary application. */
export async function linkApplication(linkedId: string, primaryId: string, performedBy: string) {
	const [linked] = await db
		.select({ name: monitoredApplications.name })
		.from(monitoredApplications)
		.where(eq(monitoredApplications.id, linkedId))
		.limit(1)
	const [primary] = await db
		.select({ name: monitoredApplications.name })
		.from(monitoredApplications)
		.where(eq(monitoredApplications.id, primaryId))
		.limit(1)

	await db
		.update(monitoredApplications)
		.set({ primaryApplicationId: primaryId, updatedBy: performedBy, updatedAt: new Date() })
		.where(eq(monitoredApplications.id, linkedId))

	await writeAuditLog({
		action: "application_linked",
		entityType: "monitored_application",
		entityId: linkedId,
		newValue: JSON.stringify({ primaryId, primaryName: primary?.name, linkedName: linked?.name }),
		performedBy,
	})
}

/** Unlink an application from its primary. */
export async function unlinkApplication(applicationId: string, performedBy: string) {
	const [app] = await db
		.select({
			name: monitoredApplications.name,
			primaryApplicationId: monitoredApplications.primaryApplicationId,
		})
		.from(monitoredApplications)
		.where(eq(monitoredApplications.id, applicationId))
		.limit(1)

	await db
		.update(monitoredApplications)
		.set({ primaryApplicationId: null, updatedBy: performedBy, updatedAt: new Date() })
		.where(eq(monitoredApplications.id, applicationId))

	await writeAuditLog({
		action: "application_unlinked",
		entityType: "monitored_application",
		entityId: applicationId,
		previousValue: JSON.stringify({
			primaryId: app?.primaryApplicationId,
			appName: app?.name,
		}),
		performedBy,
	})
}

/** Rename an application. */
export async function renameApplication(appId: string, newName: string, performedBy: string) {
	const [app] = await db
		.select({ name: monitoredApplications.name })
		.from(monitoredApplications)
		.where(eq(monitoredApplications.id, appId))
		.limit(1)

	await db
		.update(monitoredApplications)
		.set({ name: newName, updatedBy: performedBy, updatedAt: new Date() })
		.where(eq(monitoredApplications.id, appId))

	await writeAuditLog({
		action: "application_renamed",
		entityType: "monitored_application",
		entityId: appId,
		previousValue: JSON.stringify({ name: app?.name }),
		newValue: JSON.stringify({ name: newName }),
		performedBy,
	})
}

/** Promote a linked app to become the new primary in a group.
 *  - newPrimaryId becomes the primary (primaryApplicationId = null)
 *  - currentPrimaryId becomes a child of the new primary
 *  - All other children of currentPrimaryId are moved to point to newPrimaryId
 */
export async function promoteToPrimary(newPrimaryId: string, currentPrimaryId: string, performedBy: string) {
	const [newPrimary] = await db
		.select({ name: monitoredApplications.name })
		.from(monitoredApplications)
		.where(eq(monitoredApplications.id, newPrimaryId))
		.limit(1)
	const [currentPrimary] = await db
		.select({ name: monitoredApplications.name })
		.from(monitoredApplications)
		.where(eq(monitoredApplications.id, currentPrimaryId))
		.limit(1)

	await db.transaction(async (tx) => {
		// Promote the new primary: clear its primaryApplicationId
		await tx
			.update(monitoredApplications)
			.set({ primaryApplicationId: null, updatedBy: performedBy, updatedAt: new Date() })
			.where(eq(monitoredApplications.id, newPrimaryId))

		// Move all existing children of the old primary to point to the new primary
		await tx
			.update(monitoredApplications)
			.set({ primaryApplicationId: newPrimaryId, updatedBy: performedBy, updatedAt: new Date() })
			.where(eq(monitoredApplications.primaryApplicationId, currentPrimaryId))

		// Demote the old primary: make it a child of the new primary
		await tx
			.update(monitoredApplications)
			.set({ primaryApplicationId: newPrimaryId, updatedBy: performedBy, updatedAt: new Date() })
			.where(eq(monitoredApplications.id, currentPrimaryId))
	})

	await writeAuditLog({
		action: "application_primary_changed",
		entityType: "monitored_application",
		entityId: newPrimaryId,
		previousValue: JSON.stringify({
			primaryId: currentPrimaryId,
			primaryName: currentPrimary?.name,
		}),
		newValue: JSON.stringify({
			primaryId: newPrimaryId,
			primaryName: newPrimary?.name,
		}),
		performedBy,
	})
}

/** Delete an application that has no linked apps and no Nais environments. */
export async function deleteApplication(appId: string, performedBy: string) {
	const [app] = await db
		.select({ name: monitoredApplications.name })
		.from(monitoredApplications)
		.where(eq(monitoredApplications.id, appId))
		.limit(1)
	if (!app) throw new Error("Applikasjon ikke funnet")

	// Verify no linked apps
	const [linked] = await db
		.select({ id: monitoredApplications.id })
		.from(monitoredApplications)
		.where(eq(monitoredApplications.primaryApplicationId, appId))
		.limit(1)
	if (linked) throw new Error("Kan ikke slette applikasjon med lenkede applikasjoner")

	// Verify no environments
	const [env] = await db
		.select({ id: applicationEnvironments.id })
		.from(applicationEnvironments)
		.where(eq(applicationEnvironments.applicationId, appId))
		.limit(1)
	if (env) throw new Error("Kan ikke slette applikasjon som finnes på Nais")

	await db.transaction(async (tx) => {
		// Delete compliance history (references assessments, not the app directly)
		const assessmentIds = await tx
			.select({ id: complianceAssessments.id })
			.from(complianceAssessments)
			.where(eq(complianceAssessments.applicationId, appId))
		if (assessmentIds.length > 0) {
			await tx.delete(complianceAssessmentHistory).where(
				inArray(
					complianceAssessmentHistory.assessmentId,
					assessmentIds.map((a) => a.id),
				),
			)
		}
		await tx.delete(complianceAssessments).where(eq(complianceAssessments.applicationId, appId))

		// Delete from all FK tables
		await tx.delete(applicationTeamMappings).where(eq(applicationTeamMappings.applicationId, appId))
		await tx.delete(applicationPersistence).where(eq(applicationPersistence.applicationId, appId))
		await tx.delete(sectionIgnoredApplications).where(eq(sectionIgnoredApplications.applicationId, appId))
		await tx
			.delete(linkSuggestions)
			.where(or(eq(linkSuggestions.primaryAppId, appId), eq(linkSuggestions.secondaryAppId, appId)))
		await tx.delete(applicationAuthIntegrations).where(eq(applicationAuthIntegrations.applicationId, appId))
		await tx.delete(applicationAccessPolicyRules).where(eq(applicationAccessPolicyRules.applicationId, appId))
		await tx.delete(accessPolicyAcknowledgments).where(eq(accessPolicyAcknowledgments.applicationId, appId))
		await tx.delete(screeningAnswers).where(eq(screeningAnswers.applicationId, appId))
		await tx.delete(deploymentVerificationSummaries).where(eq(deploymentVerificationSummaries.applicationId, appId))
		await tx.delete(applicationOracleInstances).where(eq(applicationOracleInstances.applicationId, appId))
		await tx.delete(auditEvidenceSnapshots).where(eq(auditEvidenceSnapshots.applicationId, appId))
		// applicationTechnologyElements has onDelete: cascade, handled by DB

		// Delete the application itself
		await tx.delete(monitoredApplications).where(eq(monitoredApplications.id, appId))
	})

	await writeAuditLog({
		action: "application_deleted",
		entityType: "monitored_application",
		entityId: appId,
		previousValue: JSON.stringify({ name: app.name }),
		performedBy,
	})
}
/** Extract base application name by stripping environment suffixes like -q0, -q1, -q2, -q5, -popp etc. */
export function extractBaseName(appName: string): string | null {
	const match = appName.match(/^(.+)-(?:popp|q\d+)$/)
	return match ? match[1] : null
}

export type MatchType = "image_match" | "name_pattern" | "both"

export interface LinkCandidate {
	matchType: MatchType
	confidence: number
	apps: Array<{
		id: string
		name: string
		cluster: string
		isProd: boolean
		alreadyLinked: boolean
	}>
}

export async function findLinkCandidates(): Promise<LinkCandidate[]> {
	// Get all apps with their environments
	const allApps = await db
		.select({
			appId: monitoredApplications.id,
			appName: monitoredApplications.name,
			primaryApplicationId: monitoredApplications.primaryApplicationId,
		})
		.from(monitoredApplications)

	const envs = await db
		.select({
			appId: applicationEnvironments.applicationId,
			imageName: applicationEnvironments.imageName,
			cluster: applicationEnvironments.cluster,
		})
		.from(applicationEnvironments)

	// Build app info map
	const appInfo = new Map<
		string,
		{
			name: string
			clusters: string[]
			imageNames: string[]
			primaryApplicationId: string | null
		}
	>()

	for (const app of allApps) {
		appInfo.set(app.appId, {
			name: app.appName,
			clusters: [],
			imageNames: [],
			primaryApplicationId: app.primaryApplicationId,
		})
	}

	for (const env of envs) {
		const info = appInfo.get(env.appId)
		if (!info) continue
		if (env.cluster && !info.clusters.includes(env.cluster)) info.clusters.push(env.cluster)
		if (env.imageName && !info.imageNames.includes(env.imageName)) info.imageNames.push(env.imageName)
	}

	// --- Strategy 1: Image-based matching ---
	const imageGroups = new Map<string, Set<string>>()
	for (const [appId, info] of appInfo) {
		for (const img of info.imageNames) {
			const group = imageGroups.get(img) ?? new Set()
			group.add(appId)
			imageGroups.set(img, group)
		}
	}

	// --- Strategy 2: Name-pattern matching ---
	const nameGroups = new Map<string, Set<string>>()
	for (const [appId, info] of appInfo) {
		const baseName = extractBaseName(info.name)
		if (baseName) {
			// Find the app with the base name
			for (const [otherId, otherInfo] of appInfo) {
				if (otherId === appId) continue
				if (otherInfo.name === baseName) {
					const key = baseName
					const group = nameGroups.get(key) ?? new Set()
					group.add(appId)
					group.add(otherId)
					nameGroups.set(key, group)
				}
			}
		}
	}

	// --- Merge strategies ---
	const candidateMap = new Map<string, LinkCandidate>()

	function makeAppEntry(id: string) {
		const info = appInfo.get(id)
		if (!info) return null
		return {
			id,
			name: info.name,
			cluster: info.clusters[0] ?? "unknown",
			isProd: info.clusters.some((c) => c.startsWith("prod")),
			alreadyLinked: info.primaryApplicationId !== null,
		}
	}

	function candidateKey(appIds: Set<string>) {
		return [...appIds].sort().join(",")
	}

	// Process image-based groups
	for (const [, appIds] of imageGroups) {
		if (appIds.size < 2) continue
		const key = candidateKey(appIds)
		const apps = [...appIds].map(makeAppEntry).filter((a) => a !== null)
		const unlinked = apps.filter((a) => !a.alreadyLinked)
		if (unlinked.length < 2) continue

		candidateMap.set(key, {
			matchType: "image_match",
			confidence: 0.95,
			apps: apps.sort((a, b) => (a.isProd === b.isProd ? 0 : a.isProd ? -1 : 1)),
		})
	}

	// Process name-based groups
	for (const [, appIds] of nameGroups) {
		if (appIds.size < 2) continue
		const key = candidateKey(appIds)
		const existing = candidateMap.get(key)
		if (existing) {
			// Both signals → upgrade to "both"
			existing.matchType = "both"
			existing.confidence = 0.99
		} else {
			const apps = [...appIds].map(makeAppEntry).filter((a) => a !== null)
			const unlinked = apps.filter((a) => !a.alreadyLinked)
			if (unlinked.length < 2) continue

			candidateMap.set(key, {
				matchType: "name_pattern",
				confidence: 0.8,
				apps: apps.sort((a, b) => (a.isProd === b.isProd ? 0 : a.isProd ? -1 : 1)),
			})
		}
	}

	return [...candidateMap.values()].sort((a, b) => b.confidence - a.confidence)
}

/** Get link candidates filtered to apps belonging to a section (via team mappings or Nais team environments). */
export async function getLinkCandidatesForSection(sectionId: string): Promise<LinkCandidate[]> {
	// Get app IDs belonging to this section via dev team mappings
	const teamAppRows = await db
		.select({ appId: applicationTeamMappings.applicationId })
		.from(applicationTeamMappings)
		.innerJoin(devTeams, eq(applicationTeamMappings.devTeamId, devTeams.id))
		.where(eq(devTeams.sectionId, sectionId))

	// Get app IDs belonging to this section via Nais team environments
	const sectionNaisTeamRows = await db.select().from(naisTeams).where(eq(naisTeams.sectionId, sectionId))
	const naisTeamIds = sectionNaisTeamRows.map((t) => t.id)

	let naisAppRows: Array<{ appId: string }> = []
	if (naisTeamIds.length > 0) {
		naisAppRows = await db
			.selectDistinct({ appId: applicationEnvironments.applicationId })
			.from(applicationEnvironments)
			.where(sql`${applicationEnvironments.naisTeamId} IN (${sql.join(naisTeamIds, sql`, `)})`)
	}

	const sectionAppIds = new Set([...teamAppRows.map((r) => r.appId), ...naisAppRows.map((r) => r.appId)])
	if (sectionAppIds.size === 0) return []

	const allCandidates = await findLinkCandidates()

	// Filter to candidates where at least one app belongs to this section
	return allCandidates.filter((c) => c.apps.some((a) => sectionAppIds.has(a.id)))
}

// ─── Link Suggestions ────────────────────────────────────────────────────

/** Persist link candidates as suggestions in the database. Only creates new suggestions, skips existing. */
export async function persistLinkSuggestions(candidates: LinkCandidate[]) {
	let created = 0
	for (const candidate of candidates) {
		const prodApps = candidate.apps.filter((a) => a.isProd)

		// Determine primary: prefer prod, else first app
		const primary = prodApps[0] ?? candidate.apps[0]
		const secondaries = candidate.apps.filter((a) => a.id !== primary.id)

		for (const secondary of secondaries) {
			try {
				await db
					.insert(linkSuggestions)
					.values({
						primaryAppId: primary.id,
						secondaryAppId: secondary.id,
						matchType: candidate.matchType as LinkSuggestionMatchType,
						confidence: String(candidate.confidence),
						status: "pending",
					})
					.onConflictDoNothing()
				created++
			} catch {
				// Ignore constraint violations
			}
		}
	}
	return created
}

/** Get all pending link suggestions. */
export async function getPendingLinkSuggestions() {
	return db
		.select({
			id: linkSuggestions.id,
			primaryAppId: linkSuggestions.primaryAppId,
			primaryAppName: sql<string>`pa.name`,
			secondaryAppId: linkSuggestions.secondaryAppId,
			secondaryAppName: sql<string>`sa.name`,
			matchType: linkSuggestions.matchType,
			confidence: linkSuggestions.confidence,
			status: linkSuggestions.status,
			createdAt: linkSuggestions.createdAt,
		})
		.from(linkSuggestions)
		.innerJoin(sql`monitored_applications pa`, sql`pa.id = ${linkSuggestions.primaryAppId}`)
		.innerJoin(sql`monitored_applications sa`, sql`sa.id = ${linkSuggestions.secondaryAppId}`)
		.where(eq(linkSuggestions.status, "pending"))
		.orderBy(desc(linkSuggestions.createdAt))
}

/** Accept a link suggestion: links the apps and marks suggestion as accepted. */
export async function acceptLinkSuggestion(suggestionId: string, performedBy: string) {
	const [suggestion] = await db.select().from(linkSuggestions).where(eq(linkSuggestions.id, suggestionId)).limit(1)

	if (!suggestion) throw new Error("Forslag ikke funnet")

	// Link the apps
	await linkApplication(suggestion.secondaryAppId, suggestion.primaryAppId, performedBy)

	// Mark as accepted
	await db
		.update(linkSuggestions)
		.set({
			status: "accepted" as LinkSuggestionStatus,
			reviewedBy: performedBy,
			reviewedAt: new Date(),
		})
		.where(eq(linkSuggestions.id, suggestionId))
}

/** Reject a link suggestion. */
export async function rejectLinkSuggestion(suggestionId: string, performedBy: string) {
	await db
		.update(linkSuggestions)
		.set({
			status: "rejected" as LinkSuggestionStatus,
			reviewedBy: performedBy,
			reviewedAt: new Date(),
		})
		.where(eq(linkSuggestions.id, suggestionId))
}

/** Bulk-accept all suggestions above a confidence threshold. */
export async function bulkAcceptLinkSuggestions(minConfidence: number, performedBy: string) {
	const pending = await db
		.select()
		.from(linkSuggestions)
		.where(
			sql`${linkSuggestions.status} = 'pending' AND CAST(${linkSuggestions.confidence} AS REAL) >= ${minConfidence}`,
		)

	let accepted = 0
	for (const s of pending) {
		await acceptLinkSuggestion(s.id, performedBy)
		accepted++
	}
	return accepted
}

/** Create a parent application and link all variant apps to it. Accepts related suggestions. */
export async function createParentAndLinkGroup(
	parentName: string,
	variantAppIds: string[],
	performedBy: string,
): Promise<string> {
	// Create or find the parent application
	const { id: parentId } = await upsertMonitoredApp(parentName, performedBy)

	// Link all variants to the parent
	for (const appId of variantAppIds) {
		if (appId === parentId) continue
		await linkApplication(appId, parentId, performedBy)
	}

	// Accept all pending suggestions involving these apps
	const pending = await db.select().from(linkSuggestions).where(eq(linkSuggestions.status, "pending"))
	const variantSet = new Set(variantAppIds)
	for (const s of pending) {
		if (variantSet.has(s.primaryAppId) && variantSet.has(s.secondaryAppId)) {
			await db
				.update(linkSuggestions)
				.set({
					status: "accepted" as LinkSuggestionStatus,
					reviewedBy: performedBy,
					reviewedAt: new Date(),
				})
				.where(eq(linkSuggestions.id, s.id))
		}
	}

	return parentId
}

/** Accept all pending suggestions where both apps are in the given set. */
export async function acceptRelatedSuggestions(appIds: string[], performedBy: string) {
	const pending = await db.select().from(linkSuggestions).where(eq(linkSuggestions.status, "pending"))
	const appSet = new Set(appIds)
	for (const s of pending) {
		if (appSet.has(s.primaryAppId) && appSet.has(s.secondaryAppId)) {
			await db
				.update(linkSuggestions)
				.set({
					status: "accepted" as LinkSuggestionStatus,
					reviewedBy: performedBy,
					reviewedAt: new Date(),
				})
				.where(eq(linkSuggestions.id, s.id))
		}
	}
}

export type AppResolution = { status: "monitored"; appId: string } | { status: "discovered" } | { status: "unknown" }

/** Look up app names: first in monitoredApplications (monitored), then naisDiscoveredApps (discovered), else unknown. */
export async function resolveAppNames(names: string[]): Promise<Record<string, AppResolution>> {
	if (names.length === 0) return {}
	const result: Record<string, AppResolution> = {}

	// Step 1: Check monitored applications
	const monitored = await db
		.select({ id: monitoredApplications.id, name: monitoredApplications.name })
		.from(monitoredApplications)
		.where(inArray(monitoredApplications.name, names))
	for (const row of monitored) {
		result[row.name] = { status: "monitored", appId: row.id }
	}

	// Step 2: Check nais discovered apps for remaining names
	const remaining = names.filter((n) => !result[n])
	if (remaining.length > 0) {
		const discovered = await db
			.select({ name: naisDiscoveredApps.name })
			.from(naisDiscoveredApps)
			.where(inArray(naisDiscoveredApps.name, remaining))
		for (const row of discovered) {
			if (!result[row.name]) {
				result[row.name] = { status: "discovered" }
			}
		}
	}

	// Step 3: Mark remaining as unknown
	for (const name of names) {
		if (!result[name]) {
			result[name] = { status: "unknown" }
		}
	}

	return result
}

/** Replace all access policy rules for a given application and direction. */
export async function upsertAccessPolicyRules(
	applicationId: string,
	direction: "inbound" | "outbound",
	rules: Array<{ application: string; namespace?: string; cluster?: string }>,
) {
	await db.transaction(async (tx) => {
		// Delete existing rules for this direction
		await tx
			.delete(applicationAccessPolicyRules)
			.where(
				and(
					eq(applicationAccessPolicyRules.applicationId, applicationId),
					eq(applicationAccessPolicyRules.direction, direction),
				),
			)

		if (rules.length === 0) return

		// Deduplicate rules (same app can appear in multiple environments)
		const seen = new Set<string>()
		const uniqueRules = rules.filter((rule) => {
			const key = `${rule.application}|${rule.namespace ?? ""}|${rule.cluster ?? ""}`
			if (seen.has(key)) return false
			seen.add(key)
			return true
		})

		await tx.insert(applicationAccessPolicyRules).values(
			uniqueRules.map((rule) => ({
				applicationId,
				direction,
				ruleApplication: rule.application,
				ruleNamespace: rule.namespace ?? null,
				ruleCluster: rule.cluster ?? null,
			})),
		)
	})
}

/** Get all access policy rules for an application. */
export async function getAccessPolicyRules(applicationId: string) {
	return db
		.select()
		.from(applicationAccessPolicyRules)
		.where(eq(applicationAccessPolicyRules.applicationId, applicationId))
		.orderBy(applicationAccessPolicyRules.direction, applicationAccessPolicyRules.ruleApplication)
}

export interface AccessPolicyAcknowledgment {
	id: string
	ruleApplication: string
	comment: string
	acknowledgedBy: string
	acknowledgedAt: Date
}

/** Acknowledge an unknown app in the access policy. */
export async function acknowledgeUnknownApp(
	applicationId: string,
	ruleApplication: string,
	comment: string,
	user: string,
) {
	const [row] = await db
		.insert(accessPolicyAcknowledgments)
		.values({ applicationId, ruleApplication, comment, acknowledgedBy: user })
		.returning()
	return row
}

/** Revoke an existing acknowledgment for an unknown app. */
export async function revokeAcknowledgment(applicationId: string, ruleApplication: string, user: string) {
	await db
		.update(accessPolicyAcknowledgments)
		.set({ revokedAt: new Date(), revokedBy: user })
		.where(
			and(
				eq(accessPolicyAcknowledgments.applicationId, applicationId),
				eq(accessPolicyAcknowledgments.ruleApplication, ruleApplication),
				isNull(accessPolicyAcknowledgments.revokedAt),
			),
		)
}

/** Get all active (non-revoked) acknowledgments for an application. */
export async function getActiveAcknowledgments(applicationId: string): Promise<AccessPolicyAcknowledgment[]> {
	return db
		.select({
			id: accessPolicyAcknowledgments.id,
			ruleApplication: accessPolicyAcknowledgments.ruleApplication,
			comment: accessPolicyAcknowledgments.comment,
			acknowledgedBy: accessPolicyAcknowledgments.acknowledgedBy,
			acknowledgedAt: accessPolicyAcknowledgments.acknowledgedAt,
		})
		.from(accessPolicyAcknowledgments)
		.where(
			and(eq(accessPolicyAcknowledgments.applicationId, applicationId), isNull(accessPolicyAcknowledgments.revokedAt)),
		)
}
