import { fetchNaisApps, fetchNaisTeams } from "./nais.server"

export async function syncNaisTeams(token: string): Promise<{ discovered: number; new: number }> {
	const teams = await fetchNaisTeams(token)

	console.log(`[nais-sync] Discovered ${teams.length} teams from Nais`)
	for (const team of teams) {
		console.log(`[nais-sync]   - ${team.slug}${team.purpose ? `: ${team.purpose}` : ""}`)
	}

	// TODO: persist discovered teams into the database
	return { discovered: teams.length, new: teams.length }
}

export async function syncNaisApps(token: string, teamSlug: string): Promise<{ discovered: number; new: number }> {
	const apps = await fetchNaisApps(token, teamSlug)

	console.log(`[nais-sync] Discovered ${apps.length} apps for team ${teamSlug}`)
	for (const app of apps) {
		console.log(`[nais-sync]   - ${app.name} (${app.cluster}/${app.namespace})`)
	}

	// TODO: persist discovered apps into the database
	return { discovered: apps.length, new: apps.length }
}
