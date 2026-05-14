import { randomUUID } from "node:crypto"
import { writeAuditLog } from "~/db/queries/audit.server"
import {
	archiveMissingEnvironmentAccessPolicyRules,
	createAccessPolicySyncSummaryCollector,
	getMonitoredAppsForNaisTeam,
	syncDiscoveredApps,
	upsertAccessPolicyRulesForEnvironment,
	upsertAppAuthIntegration,
	upsertAppEnvironment,
	upsertAppPersistence,
	upsertMonitoredApp,
	upsertNaisTeam,
} from "~/db/queries/nais.server"
import type { AuthIntegrationType } from "~/db/schema/applications"
import { withAdvisoryLock } from "./lock.server"
import { logger } from "./logger.server"
import type { NaisAuthIntegration } from "./nais.server"
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
			const isNew = await upsertNaisTeam(team.slug, team.purpose, team.appCount)
			if (isNew) newCount++

			// Store discovered app names for all teams (not just monitored)
			if (team.appNames && team.appNames.length > 0) {
				await syncDiscoveredApps(team.slug, team.appNames)
			}
		}

		logger.info(`[nais-sync] Teams: ${teams.length} discovered, ${newCount} new`)
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
	jobId?: string,
): Promise<SyncResult | null> {
	return withAdvisoryLock(`nais-sync-apps-${teamSlug}`, async () => {
		const syncRunId = randomUUID()
		const apps = await fetchNaisApps(token, teamSlug)
		let newApps = 0
		let newEnvs = 0
		let newPersistence = 0
		const accessPolicySummary = createAccessPolicySyncSummaryCollector()

		// Accumulate auth integrations across all environments per (appId, type)
		// so we call upsertAppAuthIntegration once per unique integration.
		// Different environments can have different inboundRules/groups/claimsExtra,
		// causing constant flip-flop updates if called per environment.
		const appAuthIntegrations = new Map<string, Map<AuthIntegrationType, NaisAuthIntegration>>()
		const appSeenEnvironmentIds = new Map<string, string[]>()
		const appNames = new Map<string, string>()
		const teamKnownAppsBeforeSync = await getMonitoredAppsForNaisTeam(naisTeamId)

		for (const app of apps) {
			const { id: appId, isNew } = await upsertMonitoredApp(app.name, SYNC_PERFORMER, naisTeamId)
			if (isNew) newApps++
			appNames.set(appId, app.name)

			const gitRepository = app.deployInfo?.repository ? `https://github.com/${app.deployInfo.repository}` : null
			const envResult = await upsertAppEnvironment(
				appId,
				app.cluster,
				app.namespace,
				naisTeamId,
				app.image,
				gitRepository,
			)
			if (envResult.isNew) newEnvs++
			const seenEnvIds = appSeenEnvironmentIds.get(appId) ?? []
			seenEnvIds.push(envResult.id)
			appSeenEnvironmentIds.set(appId, seenEnvIds)

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

			// Collect auth integrations per (appId, type) across environments
			for (const auth of app.authIntegrations) {
				if (!appAuthIntegrations.has(appId)) {
					appAuthIntegrations.set(appId, new Map())
				}
				const byType = appAuthIntegrations.get(appId) ?? new Map()
				const existing = byType.get(auth.type)
				if (!existing) {
					byType.set(auth.type, auth)
				} else {
					byType.set(auth.type, mergeAuthIntegrations(existing, auth))
				}
			}

			await upsertAccessPolicyRulesForEnvironment(
				appId,
				envResult.id,
				"inbound",
				app.accessPolicyInbound ?? [],
				SYNC_PERFORMER,
				{
					appName: app.name,
					teamSlug,
					sourceCluster: app.cluster,
					sourceClusters: [app.cluster],
					syncRunId,
					syncJobId: jobId,
					accessPolicySyncSummary: accessPolicySummary,
				},
			)
		}

		const appsToCleanup = new Map<string, string>()
		for (const { appId, appName } of teamKnownAppsBeforeSync) {
			appsToCleanup.set(appId, appName)
		}
		const teamKnownAppsAfterSync = await getMonitoredAppsForNaisTeam(naisTeamId)
		for (const { appId, appName } of teamKnownAppsAfterSync) {
			appsToCleanup.set(appId, appName)
		}

		for (const [appId, appName] of appsToCleanup) {
			const seenEnvironmentIds = appSeenEnvironmentIds.get(appId) ?? []
			await archiveMissingEnvironmentAccessPolicyRules(
				appId,
				naisTeamId,
				seenEnvironmentIds,
				["inbound"],
				SYNC_PERFORMER,
				{
					appName: appNames.get(appId) ?? appName,
					teamSlug,
					syncRunId,
					syncJobId: jobId,
					accessPolicySyncSummary: accessPolicySummary,
				},
			)
		}

		// Upsert auth integrations once per (app, type) with merged data.
		for (const [appId, byType] of appAuthIntegrations) {
			for (const [, auth] of byType) {
				await upsertAppAuthIntegration(appId, auth.type, {
					allowAllUsers: auth.allowAllUsers,
					claimsExtra: auth.claimsExtra,
					groups: auth.groups,
					sidecarEnabled: auth.sidecarEnabled,
					inboundRules: auth.inboundRules,
				})
			}
		}

		if (
			accessPolicySummary.addedRules > 0 ||
			accessPolicySummary.removedRules > 0 ||
			accessPolicySummary.cutovers > 0
		) {
			await writeAuditLog({
				action: "access_policy_rules_synced",
				entityType: "nais_sync",
				entityId: teamSlug,
				newValue: JSON.stringify({
					teamSlug,
					syncRunId,
					applicationsChanged: accessPolicySummary.applicationIds.size,
					environmentsChanged: accessPolicySummary.applicationEnvironmentIds.size,
					directions: [...accessPolicySummary.directions].sort(),
					addedRules: accessPolicySummary.addedRules,
					removedRules: accessPolicySummary.removedRules,
					cutovers: accessPolicySummary.cutovers,
				}),
				metadata: {
					teamSlug,
					syncRunId,
					applicationsChanged: accessPolicySummary.applicationIds.size,
					environmentsChanged: accessPolicySummary.applicationEnvironmentIds.size,
				},
				performedBy: SYNC_PERFORMER,
				syncJobId: jobId,
			})
		}

		logger.info(
			`[nais-sync] Apps for ${teamSlug}: ${apps.length} discovered, ${newApps} new apps, ${newEnvs} new envs, ${newPersistence} new persistence`,
		)
		return { discovered: apps.length, new: newApps, skipped: apps.length - newApps }
	})
}

/**
 * Merge two auth integrations of the same type from different environments.
 * Arrays (inboundRules, groups, claimsExtra) are unioned.
 * Arrays (inboundRules, groups, claimsExtra) are unioned.
 * Booleans: true if any environment has true, false if any has explicit false, undefined only if both undefined.
 */
function mergeAuthIntegrations(a: NaisAuthIntegration, b: NaisAuthIntegration): NaisAuthIntegration {
	return {
		type: a.type,
		enabled: a.enabled || b.enabled,
		allowAllUsers: mergeOptionalBoolean(a.allowAllUsers, b.allowAllUsers),
		sidecarEnabled: mergeOptionalBoolean(a.sidecarEnabled, b.sidecarEnabled),
		claimsExtra: mergeStringArrays(a.claimsExtra, b.claimsExtra),
		groups: mergeStringArrays(a.groups, b.groups),
		inboundRules: mergeInboundRules(a.inboundRules, b.inboundRules),
	}
}

/** true if any is true, false if any is explicit false, undefined only when both are undefined. */
function mergeOptionalBoolean(a?: boolean, b?: boolean): boolean | undefined {
	if (a === true || b === true) return true
	if (a === false || b === false) return false
	return undefined
}

function mergeStringArrays(a?: string[], b?: string[]): string[] | undefined {
	if (!a && !b) return undefined
	const set = new Set([...(a ?? []), ...(b ?? [])])
	return set.size > 0 ? [...set] : undefined
}

function mergeInboundRules(
	a?: Array<{ application: string; namespace?: string; cluster?: string }>,
	b?: Array<{ application: string; namespace?: string; cluster?: string }>,
): Array<{ application: string; namespace?: string; cluster?: string }> | undefined {
	if (!a && !b) return undefined
	const seen = new Set<string>()
	const merged: Array<{ application: string; namespace?: string; cluster?: string }> = []
	for (const rule of [...(a ?? []), ...(b ?? [])]) {
		const key = `${rule.application}|${rule.namespace ?? ""}|${rule.cluster ?? ""}`
		if (!seen.has(key)) {
			seen.add(key)
			merged.push(rule)
		}
	}
	return merged.length > 0 ? merged : undefined
}

/**
 * Full sync: discover teams, then discover apps for each monitored team.
 * Token is optional — omit when using local Nais API proxy.
 */
export async function runFullNaisSync(
	token?: string,
	jobId?: string,
): Promise<{
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
			const result = await syncNaisAppsForTeam(token, team.slug, team.id, jobId)
			if (result) {
				appResults.push({ teamSlug: team.slug, result })
			}
		}

		const syncResult = { teams: teamsResult, apps: appResults }

		const totalNewApps = appResults.reduce((sum, r) => sum + r.result.new, 0)
		const totalDiscoveredApps = appResults.reduce((sum, r) => sum + r.result.discovered, 0)

		// Auto-generate link suggestions after sync
		const { findLinkCandidates, persistLinkSuggestions } = await import("~/db/queries/nais.server")
		const candidates = await findLinkCandidates()
		const newSuggestions = await persistLinkSuggestions(candidates)
		if (newSuggestions > 0) {
			logger.info(`[nais-sync] Created ${newSuggestions} new link suggestions`)
		}

		// Auto-assign technology elements to apps based on persistence/auth
		const { syncAllApplicationElements } = await import("~/db/queries/technology-elements.server")
		const elemChangedCount = await syncAllApplicationElements()
		logger.info(`[nais-sync] Technology elements: ${elemChangedCount} applications with changes`)

		// Refresh compliance cache for new/changed apps
		if (totalNewApps > 0 || elemChangedCount > 0) {
			const { syncAllApplicationControls } = await import("~/db/queries/application-controls.server")
			const { synced, errors } = await syncAllApplicationControls(SYNC_PERFORMER)
			logger.info(`[nais-sync] Compliance cache refreshed: ${synced} synced, ${errors} errors`)
		}

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
			syncJobId: jobId,
		})

		return syncResult
	})
}
