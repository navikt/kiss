import { and, desc, eq, isNull, sql } from "drizzle-orm"
import { db } from "../connection.server"
import { applicationEnvironments, monitoredApplications, naisTeams } from "../schema/applications"
import { auditLog } from "../schema/audit"
import { sectionEnvironments, sections } from "../schema/organization"
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
	// Import getAppsPersistence late to avoid circular dependency
	const { getAppsPersistence } = await import("./nais-persistence.server")
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

/** Get all environments for a section with included status. */
export async function getSectionEnvironments(sectionId: string): Promise<{ cluster: string; included: boolean }[]> {
	const rows = await db
		.select({ cluster: sectionEnvironments.cluster, included: sectionEnvironments.included })
		.from(sectionEnvironments)
		.where(eq(sectionEnvironments.sectionId, sectionId))
		.orderBy(sectionEnvironments.cluster)
	return rows
}

/** Get excluded environments for a section (clusters with included=false). */
export async function getExcludedEnvironments(sectionId: string): Promise<Set<string>> {
	const rows = await db
		.select({ cluster: sectionEnvironments.cluster })
		.from(sectionEnvironments)
		.where(and(eq(sectionEnvironments.sectionId, sectionId), eq(sectionEnvironments.included, false)))
	return new Set(rows.map((r) => r.cluster))
}

/** Exclude a cluster for a section (idempotent). */
export async function excludeEnvironment(sectionId: string, cluster: string, performedBy: string) {
	await db
		.update(sectionEnvironments)
		.set({ included: false, updatedBy: performedBy, updatedAt: new Date() })
		.where(and(eq(sectionEnvironments.sectionId, sectionId), eq(sectionEnvironments.cluster, cluster)))
	await writeAuditLog({
		action: "section_environment_excluded",
		entityType: "section",
		entityId: sectionId,
		newValue: JSON.stringify({ cluster }),
		performedBy,
	})
}

/** Include (re-enable) a cluster for a section (idempotent). */
export async function includeEnvironment(sectionId: string, cluster: string, performedBy: string) {
	await db
		.update(sectionEnvironments)
		.set({ included: true, updatedBy: performedBy, updatedAt: new Date() })
		.where(and(eq(sectionEnvironments.sectionId, sectionId), eq(sectionEnvironments.cluster, cluster)))
	await writeAuditLog({
		action: "section_environment_included",
		entityType: "section",
		entityId: sectionId,
		previousValue: JSON.stringify({ cluster }),
		performedBy,
	})
}
