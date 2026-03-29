import { eq, sql } from "drizzle-orm"
import { db } from "../connection.server"
import { applicationEnvironments, monitoredApplications, naisTeams } from "../schema/applications"
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
