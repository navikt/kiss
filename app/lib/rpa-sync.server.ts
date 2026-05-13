import { writeAuditLog } from "~/db/queries/audit.server"
import { getActiveRpaGroups, markRpaGroupSynced, syncRpaGroupMembers } from "~/db/queries/rpa.server"
import { fetchGroupMembers } from "./graph.server"
import { withAdvisoryLock } from "./lock.server"
import { logger } from "./logger.server"

const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000 // 24 hours

/**
 * Sync RPA group members from Microsoft Graph API.
 * Uses per-group updatedAt to determine which groups need syncing (survives pod restarts).
 * Advisory-locked to prevent concurrent runs.
 */
export async function runRpaGroupMemberSync(): Promise<{
	groupsSynced: number
	totalAdded: number
	totalArchived: number
} | null> {
	return withAdvisoryLock("rpa-group-member-sync", async () => {
		const groups = await getActiveRpaGroups()
		if (groups.length === 0) {
			logger.info("[rpa-sync] No active RPA groups configured — skipping sync")
			return { groupsSynced: 0, totalAdded: 0, totalArchived: 0 }
		}

		// Only sync groups that haven't been synced in 24h
		const now = Date.now()
		const groupsToSync = groups.filter((g) => now - new Date(g.updatedAt).getTime() >= SYNC_INTERVAL_MS)

		if (groupsToSync.length === 0) {
			logger.debug("[rpa-sync] All groups synced recently — skipping")
			return { groupsSynced: 0, totalAdded: 0, totalArchived: 0 }
		}

		logger.info(`[rpa-sync] Syncing members for ${groupsToSync.length}/${groups.length} RPA groups`)

		let totalAdded = 0
		let totalArchived = 0
		let groupsSynced = 0

		for (const group of groupsToSync) {
			try {
				const members = await fetchGroupMembers(group.groupId)
				const result = await syncRpaGroupMembers(group.id, members)
				await markRpaGroupSynced(group.id)

				totalAdded += result.added
				totalArchived += result.archived
				groupsSynced++

				if (result.added > 0 || result.archived > 0) {
					logger.info(
						`[rpa-sync] Group "${group.groupName ?? group.groupId}": +${result.added} added, -${result.archived} archived, ${result.updated} updated`,
					)
				}
			} catch (err) {
				logger.error(
					`[rpa-sync] Failed to sync group "${group.groupName ?? group.groupId}" (${group.groupId})`,
					err instanceof Error ? err : new Error(String(err)),
				)
			}
		}

		if (groupsSynced > 0) {
			await writeAuditLog({
				action: "rpa_group_members_synced",
				entityType: "rpa_group",
				entityId: "sync",
				newValue: JSON.stringify({ groupsSynced, totalAdded, totalArchived }),
				performedBy: "system:rpa-sync",
			})
		}

		logger.info(
			`[rpa-sync] Complete: ${groupsSynced}/${groupsToSync.length} groups synced, +${totalAdded} added, -${totalArchived} archived`,
		)

		return { groupsSynced, totalAdded, totalArchived }
	})
}

/**
 * Sync members for a single RPA group. Used after adding a new group in admin UI.
 * Uses advisory lock to prevent concurrent sync with the scheduler.
 */
export async function syncSingleRpaGroup(rpaGroupId: string, entraGroupId: string, groupName: string | null) {
	return withAdvisoryLock("rpa-group-member-sync", async () => {
		const members = await fetchGroupMembers(entraGroupId)
		const result = await syncRpaGroupMembers(rpaGroupId, members)
		await markRpaGroupSynced(rpaGroupId)

		logger.info(
			`[rpa-sync] Single group "${groupName ?? entraGroupId}": +${result.added} added, ${result.updated} updated`,
		)

		return result
	})
}
