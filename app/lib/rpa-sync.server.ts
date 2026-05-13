import { writeAuditLog } from "~/db/queries/audit.server"
import {
	batchSyncRpaUserGroupMemberships,
	cleanupOrphanedUserGroupMemberships,
	getActiveRpaGroups,
	getRpaGroupUpdatedAt,
	markRpaGroupSynced,
	syncRpaGroupMembers,
	syncRpaUserGroupMemberships,
} from "~/db/queries/rpa.server"
import { fetchGroupMembers, fetchUserGroupMemberships } from "./graph.server"
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

	// Phase 2b: Fetch Entra ID group memberships for all unique RPA users
	const allUniqueUsers = new Map<string, string>() // userObjectId → displayName
	for (const { members } of fetchedGroups) {
		for (const m of members) {
			if (!allUniqueUsers.has(m.userObjectId)) {
				allUniqueUsers.set(m.userObjectId, m.displayName ?? m.userObjectId)
			}
		}
	}

	const userGroupMemberships = new Map<string, Awaited<ReturnType<typeof fetchUserGroupMemberships>>>()
	const failedUserIds = new Set<string>()
	for (const [userObjectId, displayName] of allUniqueUsers) {
		try {
			const groups = await fetchUserGroupMemberships(userObjectId)
			userGroupMemberships.set(userObjectId, groups)
		} catch (err) {
			failedUserIds.add(userObjectId)
			logger.warn(
				`[rpa-sync] Failed to fetch group memberships for user "${displayName}" (${userObjectId})`,
				err instanceof Error ? err : new Error(String(err)),
			)
		}
	}

	logger.info(`[rpa-sync] Fetched group memberships for ${userGroupMemberships.size}/${allUniqueUsers.size} RPA users`)

	// Phase 3: Write to DB under advisory lock (quick, no HTTP)
	return withAdvisoryLock("rpa-group-member-sync", async () => {
		let totalAdded = 0
		let totalArchived = 0
		let groupsSynced = 0

		// Track which users' groups actually passed the staleness check
		const syncedUserIds = new Set<string>()
		const syncedGroupIds = new Set<string>()

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

				totalAdded += result.added
				totalArchived += result.archived
				groupsSynced++

				// Only mark group as fully synced if all its members had successful membership lookups
				const hasFailedMembers = members.some((m) => failedUserIds.has(m.userObjectId))
				if (!hasFailedMembers) {
					syncedGroupIds.add(group.id)
				} else {
					logger.warn(
						`[rpa-sync] Group "${group.groupName ?? group.groupId}" has members with failed membership lookups — will retry next sync`,
					)
				}

				// Track users from groups that passed staleness check
				for (const m of members) {
					syncedUserIds.add(m.userObjectId)
				}

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

		// Batch sync user group memberships (single transaction, minimizes lock hold time)
		const filteredMemberships = new Map<string, Awaited<ReturnType<typeof fetchUserGroupMemberships>>>()
		for (const [userObjectId, groups] of userGroupMemberships) {
			if (syncedUserIds.has(userObjectId)) {
				filteredMemberships.set(userObjectId, groups)
			}
		}
		const membershipsSynced = await batchSyncRpaUserGroupMemberships(filteredMemberships)

		// Clean up membership data for users no longer in any active RPA group
		await cleanupOrphanedUserGroupMemberships()

		// Mark only successfully synced groups AFTER all dependent writes are complete
		for (const groupId of syncedGroupIds) {
			try {
				await markRpaGroupSynced(groupId)
			} catch (err) {
				logger.warn(
					`[rpa-sync] Failed to mark group ${groupId} as synced`,
					err instanceof Error ? err : new Error(String(err)),
				)
			}
		}

		logger.info(
			`[rpa-sync] Complete: ${groupsSynced}/${fetchedGroups.length} groups synced, +${totalAdded} added, -${totalArchived} archived, ${membershipsSynced} user memberships synced`,
		)

		return { groupsSynced, totalAdded, totalArchived }
	})
}

/**
 * Sync members for a single RPA group. Used after adding a new group in admin UI.
 * Graph API calls happen before the lock to minimize connection hold time.
 */
export async function syncSingleRpaGroup(rpaGroupId: string, entraGroupId: string, groupName: string | null) {
	// Fetch from Graph API first (no DB connection held)
	const members = await fetchGroupMembers(entraGroupId)

	// Fetch group memberships for all unique users
	const userGroupMemberships = new Map<string, Awaited<ReturnType<typeof fetchUserGroupMemberships>>>()
	for (const member of members) {
		if (!userGroupMemberships.has(member.userObjectId)) {
			try {
				const groups = await fetchUserGroupMemberships(member.userObjectId)
				userGroupMemberships.set(member.userObjectId, groups)
			} catch (err) {
				logger.warn(
					`[rpa-sync] Failed to fetch group memberships for user "${member.displayName ?? member.userObjectId}"`,
					err instanceof Error ? err : new Error(String(err)),
				)
			}
		}
	}

	// Write to DB under lock — no staleness check needed for user-triggered sync
	// since our Graph data is the freshest available
	return withAdvisoryLock("rpa-group-member-sync", async () => {
		const result = await syncRpaGroupMembers(rpaGroupId, members)

		// Sync user group memberships before marking group as synced
		for (const [userObjectId, groups] of userGroupMemberships) {
			try {
				await syncRpaUserGroupMemberships(userObjectId, groups)
			} catch (err) {
				logger.warn(
					`[rpa-sync] Failed to sync group memberships for user ${userObjectId}`,
					err instanceof Error ? err : new Error(String(err)),
				)
			}
		}

		// Mark as synced only after all writes are complete
		await markRpaGroupSynced(rpaGroupId)

		logger.info(
			`[rpa-sync] Single group "${groupName ?? entraGroupId}": +${result.added} added, ${result.updated} updated, ${userGroupMemberships.size} user memberships synced`,
		)

		return result
	})
}
