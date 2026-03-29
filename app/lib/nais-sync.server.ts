import { upsertAppEnvironment, upsertMonitoredApp, upsertNaisTeam } from "~/db/queries/nais.server"
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
 * Returns null if another pod already holds the lock.
 */
export async function syncNaisTeams(token: string): Promise<SyncResult | null> {
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
 * Returns null if another pod already holds the lock.
 */
export async function syncNaisAppsForTeam(
	token: string,
	teamSlug: string,
	naisTeamId: string,
): Promise<SyncResult | null> {
	return withAdvisoryLock(`nais-sync-apps-${teamSlug}`, async () => {
		const apps = await fetchNaisApps(token, teamSlug)
		let newApps = 0
		let newEnvs = 0

		for (const app of apps) {
			const { id: appId, isNew } = await upsertMonitoredApp(app.name, SYNC_PERFORMER)
			if (isNew) newApps++

			const envIsNew = await upsertAppEnvironment(appId, app.cluster, app.namespace, naisTeamId)
			if (envIsNew) newEnvs++
		}

		console.log(`[nais-sync] Apps for ${teamSlug}: ${apps.length} discovered, ${newApps} new apps, ${newEnvs} new envs`)
		return { discovered: apps.length, new: newApps, skipped: apps.length - newApps }
	})
}

/**
 * Full sync: discover teams, then discover apps for each monitored team.
 * Uses advisory lock at top level to prevent overlapping full syncs.
 */
export async function runFullNaisSync(token: string): Promise<{
	teams: SyncResult
	apps: { teamSlug: string; result: SyncResult }[]
} | null> {
	return withAdvisoryLock("nais-full-sync", async () => {
		// Step 1: Sync teams
		const teamsResult = await syncNaisTeams(token)
		if (!teamsResult) return { teams: { discovered: 0, new: 0, skipped: 0 }, apps: [] }

		// Step 2: Sync apps for each monitored team
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

		return { teams: teamsResult, apps: appResults }
	})
}
