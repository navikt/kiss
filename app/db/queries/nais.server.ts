import { and, desc, eq, isNull, sql } from "drizzle-orm"
import { db } from "../connection.server"
import {
	applicationEnvironments,
	applicationPersistence,
	applicationTeamMappings,
	monitoredApplications,
	naisTeams,
	type PersistenceType,
	sectionIgnoredApplications,
} from "../schema/applications"
import { auditLog } from "../schema/audit"
import { devTeams, sections } from "../schema/organization"
import { writeAuditLog } from "./audit.server"

/** Get all Nais teams. */
export async function getNaisTeams() {
	return db.select().from(naisTeams).orderBy(naisTeams.slug)
}

/** Get a single Nais team by slug with its apps, environments, and persistence. */
export async function getNaisTeamDetail(slug: string) {
	const [team] = await db.select().from(naisTeams).where(eq(naisTeams.slug, slug)).limit(1)
	if (!team) return null

	// Get section name if linked
	let sectionName: string | null = null
	if (team.sectionId) {
		const [section] = await db.select().from(sections).where(eq(sections.id, team.sectionId)).limit(1)
		sectionName = section?.name ?? null
	}

	// Get apps for this team via applicationEnvironments
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
		.where(eq(applicationEnvironments.naisTeamId, team.id))
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

	return { team, sectionName, apps }
}

/** Get app count per Nais team. */
export async function getNaisTeamAppCounts(): Promise<Map<string, number>> {
	const rows = await db
		.select({
			naisTeamId: applicationEnvironments.naisTeamId,
			count: sql<number>`count(DISTINCT ${applicationEnvironments.applicationId})`,
		})
		.from(applicationEnvironments)
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
export async function upsertNaisTeam(slug: string, displayName?: string | null): Promise<boolean> {
	const [existing] = await db.select().from(naisTeams).where(eq(naisTeams.slug, slug)).limit(1)
	if (existing) {
		if (displayName && displayName !== existing.displayName) {
			await db.update(naisTeams).set({ displayName }).where(eq(naisTeams.slug, slug))
		}
		return false
	}
	await db.insert(naisTeams).values({ slug, displayName })
	return true
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
		if (imageName && imageName !== existing.imageName) {
			await db.update(applicationEnvironments).set({ imageName }).where(eq(applicationEnvironments.id, existing.id))
		}
		return false
	}

	await db.insert(applicationEnvironments).values({ applicationId, cluster, namespace, naisTeamId, imageName })
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

	// Get all apps from those nais teams' environments
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
		.where(sql`${applicationEnvironments.naisTeamId} IN (${sql.join(naisTeamIds, sql`, `)})`)

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

/** Get persistence resources for an application. */
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
			naisTeamSlug: naisTeams.slug,
			discoveredAt: applicationEnvironments.discoveredAt,
		})
		.from(applicationEnvironments)
		.leftJoin(naisTeams, eq(applicationEnvironments.naisTeamId, naisTeams.id))
		.where(eq(applicationEnvironments.applicationId, applicationId))
		.orderBy(applicationEnvironments.cluster)

	const persistence = await getAppPersistence(applicationId)

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

	return { app, environments, persistence, teams: teamMappings, primaryApp, linkedApps }
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

/** Find potential link candidates based on matching Docker images. */
export async function findLinkCandidates() {
	// Get all environments with image names
	const envs = await db
		.select({
			appId: applicationEnvironments.applicationId,
			appName: monitoredApplications.name,
			imageName: applicationEnvironments.imageName,
			cluster: applicationEnvironments.cluster,
			primaryApplicationId: monitoredApplications.primaryApplicationId,
		})
		.from(applicationEnvironments)
		.innerJoin(monitoredApplications, eq(applicationEnvironments.applicationId, monitoredApplications.id))
		.where(sql`${applicationEnvironments.imageName} IS NOT NULL`)

	// Group by image name
	const imageGroups = new Map<string, Set<string>>()
	const appInfo = new Map<string, { name: string; cluster: string; primaryApplicationId: string | null }>()

	for (const env of envs) {
		if (!env.imageName) continue
		const group = imageGroups.get(env.imageName) ?? new Set()
		group.add(env.appId)
		imageGroups.set(env.imageName, group)
		if (!appInfo.has(env.appId)) {
			appInfo.set(env.appId, {
				name: env.appName,
				cluster: env.cluster,
				primaryApplicationId: env.primaryApplicationId,
			})
		}
	}

	// Find groups with multiple apps that aren't already linked
	const candidates: Array<{
		imageName: string
		apps: Array<{ id: string; name: string; cluster: string; isProd: boolean; alreadyLinked: boolean }>
	}> = []

	for (const [imageName, appIds] of imageGroups) {
		if (appIds.size < 2) continue
		const apps = [...appIds]
			.map((id) => {
				const info = appInfo.get(id)
				if (!info) return null
				return {
					id,
					name: info.name,
					cluster: info.cluster,
					isProd: info.cluster.startsWith("prod"),
					alreadyLinked: info.primaryApplicationId !== null,
				}
			})
			.filter((a) => a !== null)
		// Skip if all are already linked
		const unlinked = apps.filter((a) => !a.alreadyLinked)
		if (unlinked.length < 2) continue
		candidates.push({ imageName, apps: apps.sort((a, b) => (a.isProd === b.isProd ? 0 : a.isProd ? -1 : 1)) })
	}

	return candidates
}
