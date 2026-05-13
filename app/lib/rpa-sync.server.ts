import { writeAuditLog } from "~/db/queries/audit.server"
import {
	getActiveRpaGroups,
	getRpaGroupUpdatedAt,
	markRpaGroupSynced,
	syncRpaGroupMembers,
} from "~/db/queries/rpa.server"
import { fetchGroupMembers } from "./graph.server"
import { withAdvisoryLock } from "./lock.server"
import { logger } from "./logger.server"

const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000 // 24 hours

/**
 * Sync RPA group members from Microsoft Graph API.
 * Uses per-group updatedAt to determine which groups need syncing (survives pod restarts).
 *
 * Architecture: Graph API calls happen OUTSIDE the advisory lock to avoid holding
 * a database connection during slow HTTP requests. The lock is only held for the
 * brief DB-write phase.
 */
export async function runRpaGroupMemberSync(): Promise<{
	groupsSynced: number
	totalAdded: number
	totalArchived: number
} | null> {
	// Phase 1: Determine which groups need syncing (quick DB read, no lock needed)
	const groups = await getActiveRpaGroups()
	if (groups.length === 0) {
		logger.info("[rpa-sync] No active RPA groups configured — skipping sync")
		return { groupsSynced: 0, totalAdded: 0, totalArchived: 0 }
	}

	const now = Date.now()
	const groupsToSync = groups.filter((g) => now - new Date(g.updatedAt).getTime() >= SYNC_INTERVAL_MS)

	if (groupsToSync.length === 0) {
		logger.debug("[rpa-sync] All groups synced recently — skipping")
		return { groupsSynced: 0, totalAdded: 0, totalArchived: 0 }
	}

	logger.info(`[rpa-sync] Syncing members for ${groupsToSync.length}/${groups.length} RPA groups`)

	// Phase 2: Fetch members from Graph API (no DB connection held)
	const fetchedGroups: Array<{
		group: (typeof groupsToSync)[number]
		members: Awaited<ReturnType<typeof fetchGroupMembers>>
	}> = []

	for (const group of groupsToSync) {
		try {
			const members = await fetchGroupMembers(group.groupId)
			fetchedGroups.push({ group, members })
		} catch (err) {
			logger.error(
				`[rpa-sync] Failed to fetch members from Graph for "${group.groupName ?? group.groupId}" (${group.groupId})`,
				err instanceof Error ? err : new Error(String(err)),
			)
		}
	}

	if (fetchedGroups.length === 0) {
		logger.warn("[rpa-sync] All Graph API calls failed — nothing to sync")
		return { groupsSynced: 0, totalAdded: 0, totalArchived: 0 }
	}

	// Phase 3: Write to DB under advisory lock (quick, no HTTP)
	return withAdvisoryLock("rpa-group-member-sync", async () => {
		let totalAdded = 0
		let totalArchived = 0
		let groupsSynced = 0

		for (const { group, members } of fetchedGroups) {
			try {
				// Re-validate: skip if group was deleted or already synced by another instance
				const currentUpdatedAt = await getRpaGroupUpdatedAt(group.id)
				if (!currentUpdatedAt) {
					logger.debug(`[rpa-sync] Group "${group.groupName ?? group.groupId}" no longer exists — skipping`)
					continue
				}
				if (currentUpdatedAt.getTime() > new Date(group.updatedAt).getTime()) {
					logger.debug(
						`[rpa-sync] Group "${group.groupName ?? group.groupId}" already synced by another instance — skipping`,
					)
					continue
				}

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
			`[rpa-sync] Complete: ${groupsSynced}/${fetchedGroups.length} groups synced, +${totalAdded} added, -${totalArchived} archived`,
		)

		return { groupsSynced, totalAdded, totalArchived }
	})
}

/**
 * Sync members for a single RPA group. Used after adding a new group in admin UI.
 * Graph API call happens before the lock to minimize connection hold time.
 */
export async function syncSingleRpaGroup(rpaGroupId: string, entraGroupId: string, groupName: string | null) {
	// Fetch from Graph API first (no DB connection held)
	const members = await fetchGroupMembers(entraGroupId)

	// Write to DB under lock — no staleness check needed for user-triggered sync
	// since our Graph data is the freshest available
	return withAdvisoryLock("rpa-group-member-sync", async () => {
		const result = await syncRpaGroupMembers(rpaGroupId, members)
		await markRpaGroupSynced(rpaGroupId)

		logger.info(
			`[rpa-sync] Single group "${groupName ?? entraGroupId}": +${result.added} added, ${result.updated} updated`,
		)

		return result
	})
}
