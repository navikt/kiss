import { and, eq, isNull, sql } from "drizzle-orm"
import { db } from "../connection.server"
import {
	applicationEnvironments,
	applicationTeamMappings,
	monitoredApplications,
	naisTeams,
} from "../schema/applications"
import { sections } from "../schema/organization"
import { writeAuditLog } from "./audit.server"

/** Get all Nais teams. */
export async function getNaisTeams() {
	return db.select().from(naisTeams).orderBy(naisTeams.slug)
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
	if (existing) return false

	await db.insert(applicationEnvironments).values({ applicationId, cluster, namespace, naisTeamId })
	return true
}

/** Get the last sync timestamp from Nais teams table. */
export async function getLastSyncTimestamp(): Promise<Date | null> {
	const [row] = await db.select({ maxDate: sql<Date>`MAX(${naisTeams.discoveredAt})` }).from(naisTeams)
	return row?.maxDate ?? null
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

	// Deduplicate by appId and filter out already-linked apps
	const seen = new Set<string>()
	const unassigned: Array<{ appId: string; appName: string; naisTeamSlug: string; environments: string[] }> = []

	for (const row of envApps) {
		if (linkedAppIds.has(row.appId)) continue
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
