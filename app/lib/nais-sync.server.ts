import { writeAuditLog } from "~/db/queries/audit.server"
import {
	upsertAppAuthIntegration,
	upsertAppEnvironment,
	upsertAppPersistence,
	upsertMonitoredApp,
	upsertNaisTeam,
} from "~/db/queries/nais.server"
import { withAdvisoryLock } from "./lock.server"
import { fetchNaisApps, fetchNaisTeams } from "./nais.server"

const SYNC_PERFORMER = "nais-sync"

export interface SyncResult {
	discovered: number
	new: number
	skipped: number
}

/**
 * Sync Nais teams. Uses an advisory lock so only one pod runs this at a time.
 * Token is optional — omit when using local Nais API proxy.
 */
export async function syncNaisTeams(token?: string): Promise<SyncResult | null> {
	return withAdvisoryLock("nais-sync-teams", async () => {
		const teams = await fetchNaisTeams(token)
		let newCount = 0

		for (const team of teams) {
			const isNew = await upsertNaisTeam(team.slug, team.purpose)
			if (isNew) newCount++
		}

		console.log(`[nais-sync] Teams: ${teams.length} discovered, ${newCount} new`)
		return { discovered: teams.length, new: newCount, skipped: teams.length - newCount }
	})
}

/**
 * Sync apps for all monitored Nais teams. Uses an advisory lock per team.
 * Token is optional — omit when using local Nais API proxy.
 */
export async function syncNaisAppsForTeam(
	token: string | undefined,
	teamSlug: string,
	naisTeamId: string,
): Promise<SyncResult | null> {
	return withAdvisoryLock(`nais-sync-apps-${teamSlug}`, async () => {
		const apps = await fetchNaisApps(token, teamSlug)
		let newApps = 0
		let newEnvs = 0
		let newPersistence = 0

		for (const app of apps) {
			const { id: appId, isNew } = await upsertMonitoredApp(app.name, SYNC_PERFORMER)
			if (isNew) newApps++

			const envIsNew = await upsertAppEnvironment(appId, app.cluster, app.namespace, naisTeamId, app.image)
			if (envIsNew) newEnvs++

			for (const res of app.persistence) {
				const isNewRes = await upsertAppPersistence(appId, res.type, res.name, {
					version: res.version,
					tier: res.tier,
					highAvailability: res.highAvailability,
					auditLogging: res.auditLogging,
					auditLogUrl: res.auditLogUrl,
				})
				if (isNewRes) newPersistence++
			}

			for (const auth of app.authIntegrations) {
				await upsertAppAuthIntegration(appId, auth.type, {
					allowAllUsers: auth.allowAllUsers,
					claimsExtra: auth.claimsExtra,
					groups: auth.groups,
				})
			}
		}

		console.log(
			`[nais-sync] Apps for ${teamSlug}: ${apps.length} discovered, ${newApps} new apps, ${newEnvs} new envs, ${newPersistence} new persistence`,
		)
		return { discovered: apps.length, new: newApps, skipped: apps.length - newApps }
	})
}

/**
 * Full sync: discover teams, then discover apps for each monitored team.
 * Token is optional — omit when using local Nais API proxy.
 */
export async function runFullNaisSync(token?: string): Promise<{
	teams: SyncResult
	apps: { teamSlug: string; result: SyncResult }[]
} | null> {
	return withAdvisoryLock("nais-full-sync", async () => {
		const teamsResult = await syncNaisTeams(token)
		if (!teamsResult) return { teams: { discovered: 0, new: 0, skipped: 0 }, apps: [] }

		const { getNaisTeams } = await import("~/db/queries/nais.server")
		const allTeams = await getNaisTeams()
		const monitoredTeams = allTeams.filter((t) => t.status === "monitored")

		const appResults: { teamSlug: string; result: SyncResult }[] = []
		for (const team of monitoredTeams) {
			const result = await syncNaisAppsForTeam(token, team.slug, team.id)
			if (result) {
				appResults.push({ teamSlug: team.slug, result })
			}
		}

		const syncResult = { teams: teamsResult, apps: appResults }

		const totalNewApps = appResults.reduce((sum, r) => sum + r.result.new, 0)
		const totalDiscoveredApps = appResults.reduce((sum, r) => sum + r.result.discovered, 0)
		await writeAuditLog({
			action: "nais_sync_completed",
			entityType: "nais_sync",
			entityId: "full-sync",
			newValue: JSON.stringify({
				teams: teamsResult.discovered,
				newTeams: teamsResult.new,
				monitoredTeams: monitoredTeams.length,
				apps: totalDiscoveredApps,
				newApps: totalNewApps,
			}),
			performedBy: SYNC_PERFORMER,
		})

		return syncResult
	})
}
