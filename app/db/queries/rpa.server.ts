import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm"
import { withAdvisoryLock } from "~/lib/lock.server"
import { logger } from "~/lib/logger.server"
import {
	applyRpaStagedDataPatch,
	parseRpaStagedData,
	RPA_STAGED_DATA_ACTIVITY_TYPE,
	RPA_STAGED_DATA_SCHEMA_VERSION,
	type RpaStagedData,
	type RpaStagedDataPatch,
	type RpaStagedUser,
	type RpaUserSnapshot,
	toRpaUserSnapshot,
} from "~/lib/rpa-staged-data"
import { db } from "../connection.server"
import { applicationAuthIntegrations, applicationManualGroups } from "../schema/applications"
import {
	type RpaDecision,
	routineReviewActivities,
	routineReviews,
	routineRpaUserAssessments,
	routines,
} from "../schema/routines"
import { rpaGroupMembers, rpaGroups, rpaUserGroupMemberships } from "../schema/rpa"
import { writeAuditLog } from "./audit.server"
import { getManualGroupsForApp } from "./nais.server"

type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]

// ─── RPA Group CRUD ───────────────────────────────────────────────────────────

export async function getActiveRpaGroups() {
	return db
		.select({
			id: rpaGroups.id,
			groupId: rpaGroups.groupId,
			groupName: rpaGroups.groupName,
			createdBy: rpaGroups.createdBy,
			createdAt: rpaGroups.createdAt,
			updatedAt: rpaGroups.updatedAt,
		})
		.from(rpaGroups)
		.where(isNull(rpaGroups.archivedAt))
		.orderBy(rpaGroups.groupName)
}

export async function addRpaGroup(groupId: string, groupName: string | null, performedBy: string) {
	return db.transaction(async (tx) => {
		const [inserted] = await tx
			.insert(rpaGroups)
			.values({
				groupId,
				groupName,
				createdBy: performedBy,
				updatedBy: performedBy,
				// Set to epoch so scheduler picks up new groups immediately
				updatedAt: new Date(0),
			})
			.returning({ id: rpaGroups.id })

		await writeAuditLog(
			{
				action: "rpa_group_added",
				entityType: "rpa_group",
				entityId: inserted.id,
				newValue: JSON.stringify({ groupId, groupName }),
				performedBy,
			},
			tx,
		)

		return inserted
	})
}

export async function removeRpaGroup(id: string, performedBy: string) {
	return db.transaction(async (tx) => {
		const [archived] = await tx
			.update(rpaGroups)
			.set({
				archivedAt: new Date(),
				archivedBy: performedBy,
				updatedAt: new Date(),
				updatedBy: performedBy,
			})
			.where(and(eq(rpaGroups.id, id), isNull(rpaGroups.archivedAt)))
			.returning({
				id: rpaGroups.id,
				groupId: rpaGroups.groupId,
				groupName: rpaGroups.groupName,
			})

		if (archived) {
			// Archive all members of the removed group
			await tx
				.update(rpaGroupMembers)
				.set({ archivedAt: new Date(), archivedBy: "system:group-removed" })
				.where(and(eq(rpaGroupMembers.rpaGroupId, id), isNull(rpaGroupMembers.archivedAt)))

			await writeAuditLog(
				{
					action: "rpa_group_removed",
					entityType: "rpa_group",
					entityId: id,
					previousValue: JSON.stringify({ groupId: archived.groupId, groupName: archived.groupName }),
					performedBy,
				},
				tx,
			)
		}

		return archived ?? null
	})
}

// ─── RPA Group Member Sync ────────────────────────────────────────────────────

export interface RpaGroupMemberInput {
	userObjectId: string
	displayName: string | null
	userPrincipalName: string | null
	accountEnabled: boolean | null
}

/**
 * Sync members for an RPA group: upsert current members, archive departed ones.
 * Returns counts of added, updated, and archived members.
 */
export async function syncRpaGroupMembers(rpaGroupId: string, members: RpaGroupMemberInput[]) {
	return db.transaction(async (tx) => {
		const now = new Date()
		const memberMap = new Map(members.map((m) => [m.userObjectId, m]))

		// Get all active members for this group
		const existingActive = await tx
			.select({
				id: rpaGroupMembers.id,
				userObjectId: rpaGroupMembers.userObjectId,
			})
			.from(rpaGroupMembers)
			.where(and(eq(rpaGroupMembers.rpaGroupId, rpaGroupId), isNull(rpaGroupMembers.archivedAt)))

		const existingIds = new Set(existingActive.map((m) => m.userObjectId))

		let added = 0
		let updated = 0
		let archived = 0

		// Insert new members or update existing ones
		for (const member of members) {
			if (existingIds.has(member.userObjectId)) {
				// Update existing
				await tx
					.update(rpaGroupMembers)
					.set({
						displayName: member.displayName,
						userPrincipalName: member.userPrincipalName,
						accountEnabled: member.accountEnabled,
						syncedAt: now,
					})
					.where(
						and(
							eq(rpaGroupMembers.rpaGroupId, rpaGroupId),
							eq(rpaGroupMembers.userObjectId, member.userObjectId),
							isNull(rpaGroupMembers.archivedAt),
						),
					)
				updated++
			} else {
				// Check if there's an archived row to re-activate
				const [reactivated] = await tx
					.update(rpaGroupMembers)
					.set({
						displayName: member.displayName,
						userPrincipalName: member.userPrincipalName,
						accountEnabled: member.accountEnabled,
						syncedAt: now,
						archivedAt: null,
						archivedBy: null,
					})
					.where(
						and(
							eq(rpaGroupMembers.rpaGroupId, rpaGroupId),
							eq(rpaGroupMembers.userObjectId, member.userObjectId),
							isNotNull(rpaGroupMembers.archivedAt),
						),
					)
					.returning({ id: rpaGroupMembers.id })

				if (reactivated) {
					added++
				} else {
					// Insert brand new
					await tx.insert(rpaGroupMembers).values({
						rpaGroupId,
						userObjectId: member.userObjectId,
						displayName: member.displayName,
						userPrincipalName: member.userPrincipalName,
						accountEnabled: member.accountEnabled,
						syncedAt: now,
					})
					added++
				}
			}
		}

		// Archive members no longer in the group
		const toArchive = existingActive.filter((m) => !memberMap.has(m.userObjectId))
		for (const member of toArchive) {
			await tx
				.update(rpaGroupMembers)
				.set({ archivedAt: now, archivedBy: "system:sync" })
				.where(eq(rpaGroupMembers.id, member.id))
			archived++
		}

		return { added, updated, archived }
	})
}

// ─── RPA Group Member Queries ─────────────────────────────────────────────────

export async function getActiveRpaGroupMembers(rpaGroupId: string) {
	return db
		.select({
			id: rpaGroupMembers.id,
			userObjectId: rpaGroupMembers.userObjectId,
			displayName: rpaGroupMembers.displayName,
			userPrincipalName: rpaGroupMembers.userPrincipalName,
			accountEnabled: rpaGroupMembers.accountEnabled,
			syncedAt: rpaGroupMembers.syncedAt,
		})
		.from(rpaGroupMembers)
		.where(and(eq(rpaGroupMembers.rpaGroupId, rpaGroupId), isNull(rpaGroupMembers.archivedAt)))
		.orderBy(rpaGroupMembers.displayName)
}

export async function getMemberCountPerRpaGroup() {
	return db
		.select({
			rpaGroupId: rpaGroupMembers.rpaGroupId,
			memberCount: sql<number>`count(*)::int`,
			lastSyncedAt: sql<string>`max(${rpaGroupMembers.syncedAt})`,
		})
		.from(rpaGroupMembers)
		.where(isNull(rpaGroupMembers.archivedAt))
		.groupBy(rpaGroupMembers.rpaGroupId)
}

export async function getAllActiveRpaMembers() {
	return db
		.select({
			id: rpaGroupMembers.id,
			userObjectId: rpaGroupMembers.userObjectId,
			displayName: rpaGroupMembers.displayName,
			userPrincipalName: rpaGroupMembers.userPrincipalName,
			accountEnabled: rpaGroupMembers.accountEnabled,
			syncedAt: rpaGroupMembers.syncedAt,
			rpaGroupId: rpaGroupMembers.rpaGroupId,
			rpaGroupName: rpaGroups.groupName,
		})
		.from(rpaGroupMembers)
		.innerJoin(rpaGroups, eq(rpaGroupMembers.rpaGroupId, rpaGroups.id))
		.where(and(isNull(rpaGroupMembers.archivedAt), isNull(rpaGroups.archivedAt)))
		.orderBy(rpaGroupMembers.displayName, rpaGroupMembers.userPrincipalName, rpaGroups.groupName)
}

export async function getRpaMemberByUserObjectId(userObjectId: string) {
	const rows = await db
		.select({
			userObjectId: rpaGroupMembers.userObjectId,
			displayName: rpaGroupMembers.displayName,
			userPrincipalName: rpaGroupMembers.userPrincipalName,
			accountEnabled: rpaGroupMembers.accountEnabled,
			syncedAt: rpaGroupMembers.syncedAt,
			rpaGroupId: rpaGroups.id,
			rpaGroupEntraId: rpaGroups.groupId,
			rpaGroupName: rpaGroups.groupName,
		})
		.from(rpaGroupMembers)
		.innerJoin(rpaGroups, eq(rpaGroupMembers.rpaGroupId, rpaGroups.id))
		.where(
			and(
				eq(rpaGroupMembers.userObjectId, userObjectId),
				isNull(rpaGroupMembers.archivedAt),
				isNull(rpaGroups.archivedAt),
			),
		)
		.orderBy(rpaGroups.groupName, rpaGroups.groupId)

	if (rows.length === 0) {
		return null
	}

	const member = rows.reduce((latest, row) => (row.syncedAt > latest.syncedAt ? row : latest))

	return {
		userObjectId: member.userObjectId,
		displayName: member.displayName,
		userPrincipalName: member.userPrincipalName,
		accountEnabled: member.accountEnabled,
		rpaGroups: rows.map((row) => ({
			id: row.rpaGroupId,
			groupName: row.rpaGroupName ?? row.rpaGroupEntraId,
		})),
	}
}

export async function getRpaUserGroupMemberships(userObjectId: string) {
	return db
		.select({
			id: rpaUserGroupMemberships.id,
			groupId: rpaUserGroupMemberships.groupId,
			groupDisplayName: rpaUserGroupMemberships.groupDisplayName,
			syncedAt: rpaUserGroupMemberships.syncedAt,
		})
		.from(rpaUserGroupMemberships)
		.where(eq(rpaUserGroupMemberships.userObjectId, userObjectId))
		.orderBy(rpaUserGroupMemberships.groupDisplayName, rpaUserGroupMemberships.groupId)
}

/** Mark an RPA group as recently synced by updating its updatedAt timestamp. */
export async function markRpaGroupSynced(rpaGroupId: string) {
	await db
		.update(rpaGroups)
		.set({ updatedAt: new Date(), updatedBy: "system:rpa-sync" })
		.where(eq(rpaGroups.id, rpaGroupId))
}

export async function getRpaGroupUpdatedAt(rpaGroupId: string): Promise<Date | null> {
	const result = await db
		.select({ updatedAt: rpaGroups.updatedAt })
		.from(rpaGroups)
		.where(eq(rpaGroups.id, rpaGroupId))
		.limit(1)
	return result[0]?.updatedAt ?? null
}

// ─── RPA User Group Memberships ──────────────────────────────────────────────

/**
 * Sync all Entra ID group memberships for an RPA user.
 * Replaces all existing memberships with the fresh data from Graph API.
 */
export async function syncRpaUserGroupMemberships(
	userObjectId: string,
	groups: Array<{ groupId: string; displayName: string | null }>,
) {
	await db.transaction(async (tx) => {
		// Delete existing memberships for this user
		await tx.delete(rpaUserGroupMemberships).where(eq(rpaUserGroupMemberships.userObjectId, userObjectId))

		if (groups.length === 0) return

		const now = new Date()
		// Insert fresh memberships
		await tx.insert(rpaUserGroupMemberships).values(
			groups.map((g) => ({
				userObjectId,
				groupId: g.groupId,
				groupDisplayName: g.displayName,
				syncedAt: now,
			})),
		)
	})
}

/**
 * Batch sync all Entra ID group memberships for multiple RPA users in a single transaction.
 * More efficient than calling syncRpaUserGroupMemberships per user when under advisory lock.
 */
export async function batchSyncRpaUserGroupMemberships(
	userMemberships: Map<string, Array<{ groupId: string; displayName: string | null }>>,
) {
	if (userMemberships.size === 0) return 0

	const userIds = [...userMemberships.keys()]
	const now = new Date()

	await db.transaction(async (tx) => {
		// Batch delete all existing memberships for these users
		await tx.delete(rpaUserGroupMemberships).where(inArray(rpaUserGroupMemberships.userObjectId, userIds))

		// Batch insert all new memberships
		const allValues: Array<{
			userObjectId: string
			groupId: string
			groupDisplayName: string | null
			syncedAt: Date
		}> = []

		for (const [userObjectId, groups] of userMemberships) {
			for (const g of groups) {
				allValues.push({
					userObjectId,
					groupId: g.groupId,
					groupDisplayName: g.displayName,
					syncedAt: now,
				})
			}
		}

		if (allValues.length > 0) {
			// Insert in chunks of 1000 to avoid parameter limits
			const CHUNK_SIZE = 1000
			for (let i = 0; i < allValues.length; i += CHUNK_SIZE) {
				await tx.insert(rpaUserGroupMemberships).values(allValues.slice(i, i + CHUNK_SIZE))
			}
		}
	})

	return userMemberships.size
}

/**
 * Remove group membership records for users no longer in any active RPA group.
 * Prevents stale data from accumulating when users are archived from all groups.
 */
export async function cleanupOrphanedUserGroupMemberships() {
	await db.execute(sql`
		DELETE FROM "rpa_user_group_memberships"
		WHERE "user_object_id" NOT IN (
			SELECT DISTINCT "user_object_id"
			FROM "rpa_group_members"
			WHERE "archived_at" IS NULL
		)
	`)
}

// ─── RPA Users for Application ────────────────────────────────────────────────

/**
 * Get RPA users that can access an application.
 * A robot user can access an app if they are a member of any registered RPA group
 * AND they have at least one Entra ID group membership that matches:
 * 1. A group defined in the app's Nais manifest (naisGroupIds), OR
 * 2. A manually added group, when the app has allowAllUsers=true
 */
export async function getRpaUsersForApp(
	naisGroupIds: string[],
	manualGroupIds: string[],
	hasAllowAllUsers: boolean,
	executor: DbExecutor = db,
): Promise<
	Array<{
		rpaGroupId: string
		rpaGroupName: string | null
		entraGroupId: string
		matchSource: "nais" | "manual"
		matchedGroupId: string
		matchedGroupName: string | null
		userObjectId: string
		displayName: string | null
		userPrincipalName: string | null
		accountEnabled: boolean | null
		syncedAt: Date
	}>
> {
	// Build the set of app access group IDs with source tracking
	const accessGroupIds = new Map<string, "nais" | "manual">()
	for (const gid of naisGroupIds) {
		accessGroupIds.set(gid, "nais")
	}
	if (hasAllowAllUsers) {
		for (const gid of manualGroupIds) {
			if (!accessGroupIds.has(gid)) {
				accessGroupIds.set(gid, "manual")
			}
		}
	}

	if (accessGroupIds.size === 0) return []

	// Get all active RPA users (members of any active RPA group)
	const activeRpaGroups = await executor
		.select({
			id: rpaGroups.id,
			groupId: rpaGroups.groupId,
			groupName: rpaGroups.groupName,
		})
		.from(rpaGroups)
		.where(isNull(rpaGroups.archivedAt))

	if (activeRpaGroups.length === 0) return []

	const rpaGroupIds = activeRpaGroups.map((g) => g.id)
	const allMembers = await executor
		.select({
			rpaGroupId: rpaGroupMembers.rpaGroupId,
			userObjectId: rpaGroupMembers.userObjectId,
			displayName: rpaGroupMembers.displayName,
			userPrincipalName: rpaGroupMembers.userPrincipalName,
			accountEnabled: rpaGroupMembers.accountEnabled,
			syncedAt: rpaGroupMembers.syncedAt,
		})
		.from(rpaGroupMembers)
		.where(and(inArray(rpaGroupMembers.rpaGroupId, rpaGroupIds), isNull(rpaGroupMembers.archivedAt)))
		.orderBy(rpaGroupMembers.displayName)

	if (allMembers.length === 0) return []

	// Get unique user IDs
	const uniqueUserIds = [...new Set(allMembers.map((m) => m.userObjectId))]
	if (uniqueUserIds.length === 0) return []

	// Fetch their Entra ID group memberships that match app access groups
	const accessGroupIdList = [...accessGroupIds.keys()]
	if (accessGroupIdList.length === 0) return []
	const matchingMemberships = await executor
		.select({
			userObjectId: rpaUserGroupMemberships.userObjectId,
			groupId: rpaUserGroupMemberships.groupId,
			groupDisplayName: rpaUserGroupMemberships.groupDisplayName,
		})
		.from(rpaUserGroupMemberships)
		.where(
			and(
				inArray(rpaUserGroupMemberships.userObjectId, uniqueUserIds),
				inArray(rpaUserGroupMemberships.groupId, accessGroupIdList),
			),
		)

	if (matchingMemberships.length === 0) return []

	// Build lookup: userObjectId → best matching group (prefer nais over manual)
	const userMatchMap = new Map<string, { groupId: string; groupName: string | null; source: "nais" | "manual" }>()
	for (const m of matchingMemberships) {
		const source = accessGroupIds.get(m.groupId) ?? "nais"
		const existing = userMatchMap.get(m.userObjectId)
		// Prefer nais source over manual
		if (!existing || (existing.source === "manual" && source === "nais")) {
			userMatchMap.set(m.userObjectId, {
				groupId: m.groupId,
				groupName: m.groupDisplayName,
				source,
			})
		}
	}

	// Build RPA group lookup
	const rpaGroupById = new Map(activeRpaGroups.map((g) => [g.id, g]))

	// Assemble results — only include users that matched an access group
	const results: Array<{
		rpaGroupId: string
		rpaGroupName: string | null
		entraGroupId: string
		matchSource: "nais" | "manual"
		matchedGroupId: string
		matchedGroupName: string | null
		userObjectId: string
		displayName: string | null
		userPrincipalName: string | null
		accountEnabled: boolean | null
		syncedAt: Date
	}> = []

	for (const member of allMembers) {
		const match = userMatchMap.get(member.userObjectId)
		if (!match) continue

		const rpaGroup = rpaGroupById.get(member.rpaGroupId)
		if (!rpaGroup) continue

		results.push({
			rpaGroupId: rpaGroup.id,
			rpaGroupName: rpaGroup.groupName,
			entraGroupId: rpaGroup.groupId,
			matchSource: match.source,
			matchedGroupId: match.groupId,
			matchedGroupName: match.groupName,
			userObjectId: member.userObjectId,
			displayName: member.displayName,
			userPrincipalName: member.userPrincipalName,
			accountEnabled: member.accountEnabled,
			syncedAt: member.syncedAt,
		})
	}

	return results
}

// ─── RPA Users for Section ────────────────────────────────────────────────────

export interface RpaUserForSection {
	userObjectId: string
	displayName: string | null
	userPrincipalName: string | null
	accountEnabled: boolean | null
	syncedAt: Date
	rpaGroupId: string
	rpaGroupName: string | null
	entraGroupId: string
	applications: Array<{
		applicationId: string
		applicationName: string
		matchSource: "nais" | "manual"
	}>
}

/**
 * Get all RPA users that can access any application in a section.
 * Uses user group memberships to cross-reference against app access groups.
 */
export async function getRpaUsersForSection(sectionId: string): Promise<RpaUserForSection[]> {
	const { getEffectiveAppIdsInSection } = await import("./sections.server")
	const { getApplicationNames } = await import("./nais.server")

	const appIds = await getEffectiveAppIdsInSection(sectionId)
	if (appIds.length === 0) return []

	// Batch load auth integrations for all apps
	const authRows = await db
		.select({
			applicationId: applicationAuthIntegrations.applicationId,
			type: applicationAuthIntegrations.type,
			groups: applicationAuthIntegrations.groups,
			allowAllUsers: applicationAuthIntegrations.allowAllUsers,
		})
		.from(applicationAuthIntegrations)
		.where(inArray(applicationAuthIntegrations.applicationId, appIds))

	// Batch load manual groups for all apps
	const manualRows = await db
		.select({
			applicationId: applicationManualGroups.applicationId,
			groupId: applicationManualGroups.groupId,
		})
		.from(applicationManualGroups)
		.where(and(inArray(applicationManualGroups.applicationId, appIds), isNull(applicationManualGroups.archivedAt)))

	// Build per-app access groups with source tracking
	// Key: groupId → Map<applicationId, matchSource>
	const groupAppMap = new Map<string, Map<string, "nais" | "manual">>()
	const appAllowAllUsers = new Set<string>()

	for (const row of authRows) {
		if (row.type === "entra_id" && row.allowAllUsers === true) {
			appAllowAllUsers.add(row.applicationId)
		}
		if (row.groups) {
			try {
				const parsed = JSON.parse(row.groups)
				if (Array.isArray(parsed)) {
					for (const gid of parsed) {
						if (typeof gid !== "string") continue
						if (!groupAppMap.has(gid)) groupAppMap.set(gid, new Map())
						// biome-ignore lint/style/noNonNullAssertion: guaranteed by set above
						groupAppMap.get(gid)!.set(row.applicationId, "nais")
					}
				}
			} catch {
				// Invalid JSON — skip
			}
		}
	}

	for (const row of manualRows) {
		if (!appAllowAllUsers.has(row.applicationId)) continue
		if (!groupAppMap.has(row.groupId)) groupAppMap.set(row.groupId, new Map())
		// biome-ignore lint/style/noNonNullAssertion: guaranteed by set above
		const appMap = groupAppMap.get(row.groupId)!
		if (!appMap.has(row.applicationId)) appMap.set(row.applicationId, "manual")
	}

	if (groupAppMap.size === 0) return []

	// Get all active RPA users (all groups, not filtered by app access)
	const activeRpaGroups = await db
		.select({
			id: rpaGroups.id,
			groupId: rpaGroups.groupId,
			groupName: rpaGroups.groupName,
		})
		.from(rpaGroups)
		.where(isNull(rpaGroups.archivedAt))

	if (activeRpaGroups.length === 0) return []

	const rpaGroupIds = activeRpaGroups.map((g) => g.id)
	const allMembers = await db
		.select({
			rpaGroupId: rpaGroupMembers.rpaGroupId,
			userObjectId: rpaGroupMembers.userObjectId,
			displayName: rpaGroupMembers.displayName,
			userPrincipalName: rpaGroupMembers.userPrincipalName,
			accountEnabled: rpaGroupMembers.accountEnabled,
			syncedAt: rpaGroupMembers.syncedAt,
		})
		.from(rpaGroupMembers)
		.where(and(inArray(rpaGroupMembers.rpaGroupId, rpaGroupIds), isNull(rpaGroupMembers.archivedAt)))
		.orderBy(rpaGroupMembers.displayName)

	if (allMembers.length === 0) return []

	// Get unique user IDs and fetch their group memberships that match any app access group
	const uniqueUserIds = [...new Set(allMembers.map((m) => m.userObjectId))]
	if (uniqueUserIds.length === 0) return []
	const accessGroupIdList = [...groupAppMap.keys()]
	if (accessGroupIdList.length === 0) return []

	const matchingMemberships = await db
		.select({
			userObjectId: rpaUserGroupMemberships.userObjectId,
			groupId: rpaUserGroupMemberships.groupId,
		})
		.from(rpaUserGroupMemberships)
		.where(
			and(
				inArray(rpaUserGroupMemberships.userObjectId, uniqueUserIds),
				inArray(rpaUserGroupMemberships.groupId, accessGroupIdList),
			),
		)

	if (matchingMemberships.length === 0) return []

	// Build lookup: userObjectId → Set of matching group IDs
	const userMatchingGroups = new Map<string, Set<string>>()
	for (const m of matchingMemberships) {
		if (!userMatchingGroups.has(m.userObjectId)) userMatchingGroups.set(m.userObjectId, new Set())
		// biome-ignore lint/style/noNonNullAssertion: guaranteed by set above
		userMatchingGroups.get(m.userObjectId)!.add(m.groupId)
	}

	// Build RPA group lookup
	const rpaGroupById = new Map(activeRpaGroups.map((g) => [g.id, g]))

	// Resolve app names
	const allAppIds = new Set<string>()
	for (const appMap of groupAppMap.values()) {
		for (const appId of appMap.keys()) allAppIds.add(appId)
	}
	const appNames = await getApplicationNames([...allAppIds])

	// Aggregate: for each RPA user with matching groups, collect accessible apps
	const userGroupKey = (userOid: string, rpaGroupId: string) => `${userOid}::${rpaGroupId}`
	const resultMap = new Map<string, RpaUserForSection>()

	for (const member of allMembers) {
		const matchedGroups = userMatchingGroups.get(member.userObjectId)
		if (!matchedGroups) continue

		const rpaGroup = rpaGroupById.get(member.rpaGroupId)
		if (!rpaGroup) continue

		// Collect all apps this user can access via their matching group memberships
		const apps = new Map<string, "nais" | "manual">()
		for (const groupId of matchedGroups) {
			const appMap = groupAppMap.get(groupId)
			if (!appMap) continue
			for (const [appId, source] of appMap) {
				// Prefer nais over manual
				if (!apps.has(appId) || (apps.get(appId) === "manual" && source === "nais")) {
					apps.set(appId, source)
				}
			}
		}

		const key = userGroupKey(member.userObjectId, member.rpaGroupId)
		if (!resultMap.has(key)) {
			resultMap.set(key, {
				userObjectId: member.userObjectId,
				displayName: member.displayName,
				userPrincipalName: member.userPrincipalName,
				accountEnabled: member.accountEnabled,
				syncedAt: member.syncedAt,
				rpaGroupId: rpaGroup.id,
				rpaGroupName: rpaGroup.groupName,
				entraGroupId: rpaGroup.groupId,
				applications: [...apps.entries()].map(([appId, source]) => ({
					applicationId: appId,
					applicationName: appNames.get(appId) ?? "Ukjent",
					matchSource: source,
				})),
			})
		}
	}

	return [...resultMap.values()]
}

// ─── RPA User Maintenance Assessments ────────────────────────────────────────

export type RpaUserAssessment = {
	id: string
	reviewId: string
	userObjectId: string
	owner: string | null
	needComment: string | null
	criticalityComment: string | null
	securityComment: string | null
	decision: RpaDecision | null
	decisionDeadline: string | null
	createdBy: string
	updatedBy: string
}

/**
 * Build a Map from assessment rows with deterministic collision handling.
 * - Prefers "clean" rows (userObjectId === userObjectId.trim())
 * - Falls back to lowest id for tie-break
 * - Keys are trimmed userObjectId, values preserve original userObjectId for upsert conflict matching
 */
function buildAssessmentMapWithCollisionHandling<T extends { id: string; userObjectId: string }>(
	rows: T[],
): Map<string, T> {
	const map = new Map<string, T>()
	for (const row of rows) {
		const trimmedId = row.userObjectId.trim()
		const isClean = row.userObjectId === trimmedId

		const existing = map.get(trimmedId)
		if (existing) {
			// Collision: multiple rows differ only by whitespace
			// Prefer "clean" row (no whitespace), otherwise pick by lowest id for determinism
			const existingIsClean = existing.userObjectId === trimmedId
			if (existingIsClean && !isClean) {
				// Keep existing clean row
				logger.warn(
					`RPA assessment collision: keeping clean row ${existing.id}, skipping ${row.id} for trimmedId=${trimmedId}`,
				)
				continue
			}
			if (!existingIsClean && isClean) {
				// Replace with clean row
				logger.warn(
					`RPA assessment collision: replacing ${existing.id} with clean row ${row.id} for trimmedId=${trimmedId}`,
				)
			} else {
				// Both clean or both dirty — pick lowest id
				if (existing.id < row.id) {
					logger.warn(`RPA assessment collision: keeping ${existing.id}, skipping ${row.id} for trimmedId=${trimmedId}`)
					continue
				}
				logger.warn(`RPA assessment collision: replacing ${existing.id} with ${row.id} for trimmedId=${trimmedId}`)
			}
		}
		map.set(trimmedId, row)
	}
	return map
}

export async function getRpaUserAssessmentsForReview(
	reviewId: string,
	executor: DbExecutor = db,
): Promise<Map<string, RpaUserAssessment>> {
	const rows = await executor
		.select()
		.from(routineRpaUserAssessments)
		.where(eq(routineRpaUserAssessments.reviewId, reviewId))
	const map = buildAssessmentMapWithCollisionHandling(rows)

	// Transform to RpaUserAssessment type (preserving original userObjectId for upsert)
	const result = new Map<string, RpaUserAssessment>()
	for (const [trimmedId, row] of map) {
		result.set(trimmedId, {
			id: row.id,
			reviewId: row.reviewId,
			userObjectId: row.userObjectId, // Keep original for upsert conflict matching
			owner: row.owner,
			needComment: row.needComment,
			criticalityComment: row.criticalityComment,
			securityComment: row.securityComment,
			decision: row.decision as RpaDecision | null,
			decisionDeadline: row.decisionDeadline,
			createdBy: row.createdBy,
			updatedBy: row.updatedBy,
		})
	}
	return result
}

export async function upsertRpaUserAssessment(
	reviewId: string,
	userObjectId: string,
	navIdent: string,
	fields: {
		owner?: string | null
		needComment?: string | null
		criticalityComment?: string | null
		securityComment?: string | null
		decision?: RpaDecision | null
		decisionDeadline?: string | null
	},
): Promise<void> {
	const now = new Date()
	await db.transaction(async (tx) => {
		// Guard: ensure the parent review is still in draft
		const [snapshot] = await tx
			.select({ archivedAt: routines.archivedAt, reviewStatus: routineReviews.status })
			.from(routineReviews)
			.innerJoin(routines, eq(routineReviews.routineId, routines.id))
			.where(eq(routineReviews.id, reviewId))
			.for("share", { of: [routines] })
			.limit(1)
		if (!snapshot) {
			throw new Response("Gjennomgang ikke funnet.", { status: 404 })
		}
		if (snapshot.reviewStatus !== "draft") {
			throw new Response("Gjennomgangen er ikke lenger redigerbar.", { status: 409 })
		}

		const [existing] = await tx
			.select()
			.from(routineRpaUserAssessments)
			.where(
				and(eq(routineRpaUserAssessments.reviewId, reviewId), eq(routineRpaUserAssessments.userObjectId, userObjectId)),
			)

		// Guard: if decisionDeadline is submitted without decision, validate against effective decision
		// to avoid violating the DB CHECK constraint (deadline requires decision = avvikles|endres)
		if (fields.decisionDeadline != null && fields.decision === undefined) {
			const effectiveDecision = existing?.decision ?? null
			const deadlineAllowed = effectiveDecision === "avvikles" || effectiveDecision === "endres"
			if (!deadlineAllowed) {
				fields = { ...fields, decisionDeadline: null }
			}
		}

		// Enforce invariant: when decision is updated to one that does not allow a deadline,
		// always clear the deadline — even if the caller did not explicitly pass decisionDeadline: null.
		// This prevents violating the DB CHECK constraint when only 'decision' is submitted.
		if (fields.decision !== undefined && fields.decision !== "avvikles" && fields.decision !== "endres") {
			fields = { ...fields, decisionDeadline: null }
		}

		// Guard: no-op when fields is empty (no columns would be written)
		if (Object.keys(fields).length === 0) return

		// Guard: avoid creating an all-null row when there is no existing assessment and every
		// provided field value resolves to null/undefined (e.g. an empty-string-only POST).
		if (!existing) {
			const allNull = Object.values(fields).every((v) => v == null)
			if (allNull) return
		}

		// Short-circuit: skip DB write and audit log when no submitted field would change an existing value
		if (existing) {
			const hasChanges =
				(fields.owner !== undefined && fields.owner !== existing.owner) ||
				(fields.needComment !== undefined && fields.needComment !== existing.needComment) ||
				(fields.criticalityComment !== undefined && fields.criticalityComment !== existing.criticalityComment) ||
				(fields.securityComment !== undefined && fields.securityComment !== existing.securityComment) ||
				(fields.decision !== undefined && fields.decision !== existing.decision) ||
				(fields.decisionDeadline !== undefined && fields.decisionDeadline !== existing.decisionDeadline)
			if (!hasChanges) return
		}

		const [upserted] = await tx
			.insert(routineRpaUserAssessments)
			.values({
				reviewId,
				userObjectId,
				owner: fields.owner ?? null,
				needComment: fields.needComment ?? null,
				criticalityComment: fields.criticalityComment ?? null,
				securityComment: fields.securityComment ?? null,
				decision: (fields.decision ?? null) as RpaDecision | null,
				decisionDeadline: fields.decisionDeadline ?? null,
				createdBy: navIdent,
				updatedBy: navIdent,
			})
			.onConflictDoUpdate({
				target: [routineRpaUserAssessments.reviewId, routineRpaUserAssessments.userObjectId],
				set: {
					...(fields.owner !== undefined && { owner: fields.owner }),
					...(fields.needComment !== undefined && { needComment: fields.needComment }),
					...(fields.criticalityComment !== undefined && { criticalityComment: fields.criticalityComment }),
					...(fields.securityComment !== undefined && { securityComment: fields.securityComment }),
					...(fields.decision !== undefined && { decision: fields.decision as RpaDecision | null }),
					...(fields.decisionDeadline !== undefined && { decisionDeadline: fields.decisionDeadline }),
					updatedBy: navIdent,
					updatedAt: now,
				},
			})
			.returning({ id: routineRpaUserAssessments.id })
		await writeAuditLog(
			{
				action: "rpa_user_assessment_saved",
				entityType: "routine_rpa_user_assessment",
				entityId: upserted.id,
				previousValue: existing
					? JSON.stringify({
							owner: existing.owner,
							needComment: existing.needComment,
							criticalityComment: existing.criticalityComment,
							securityComment: existing.securityComment,
							decision: existing.decision,
							decisionDeadline: existing.decisionDeadline,
						})
					: null,
				newValue: JSON.stringify({ reviewId, userObjectId, ...fields }),
				metadata: { reviewId, userObjectId },
				performedBy: navIdent,
			},
			tx,
		)
	})
}

// ─── RPA staged_data: seed → patch → commit ───────────────────────────────────

/**
 * Build the initial staged_data document for an RPA user maintenance activity.
 * Reads local DB only — no external API calls.
 * Merges any existing `routine_rpa_user_assessments` rows (migration path).
 *
 * Should be called OUTSIDE the advisory lock to keep lock duration short for
 * activities with external API calls. RPA activities use local DB queries only,
 * so calling inside lock/tx is acceptable (no external I/O blocking).
 */
export async function buildRpaSeedResult(
	applicationId: string,
	reviewId: string,
	executor: DbExecutor = db,
): Promise<{ stagedData: RpaStagedData; snapshot: RpaUserSnapshot }> {
	const authRows = await executor
		.select({
			type: applicationAuthIntegrations.type,
			groups: applicationAuthIntegrations.groups,
			allowAllUsers: applicationAuthIntegrations.allowAllUsers,
		})
		.from(applicationAuthIntegrations)
		.where(eq(applicationAuthIntegrations.applicationId, applicationId))

	const naisGroupIds: string[] = []
	for (const auth of authRows) {
		if (auth.groups) {
			try {
				const parsed = JSON.parse(auth.groups) as unknown
				if (Array.isArray(parsed)) {
					for (const g of parsed) {
						if (typeof g === "string") {
							const trimmed = g.trim()
							if (trimmed) naisGroupIds.push(trimmed)
						}
					}
				}
			} catch {
				logger.warn("Ugyldig JSON i application_auth_integrations.groups — access-grupper hoppes over", {
					applicationId,
					rawValue: auth.groups,
				})
			}
		}
	}
	const hasAllowAllUsers = authRows.some((auth) => auth.type === "entra_id" && auth.allowAllUsers === true)

	// Use executor consistently for all reads within the transaction
	const [manualGroups, existingAssessments] = await Promise.all([
		getManualGroupsForApp(applicationId, executor),
		getRpaUserAssessmentsForReview(reviewId, executor),
	])

	const manualGroupIds = manualGroups.map((g) => g.groupId)
	const rpaUsersResolved = await getRpaUsersForApp(naisGroupIds, manualGroupIds, hasAllowAllUsers, executor)

	// Deduplicate by userObjectId — a user can appear in multiple RPA groups.
	// Sort first for deterministic tie-break: prefer entry with displayName set, then by rpaGroupName, then by rpaGroupId.
	// Total ordering ensures same user is picked regardless of DB order or runtime locale.
	const sortedForDedupe = [...rpaUsersResolved].sort((a, b) => {
		// Prefer entries with displayName set
		const aHasName = a.displayName ? 0 : 1
		const bHasName = b.displayName ? 0 : 1
		if (aHasName !== bHasName) return aHasName - bHasName
		// Then by rpaGroupName with Norwegian locale for consistent æ/ø/å ordering
		const nameCompare = (a.rpaGroupName ?? "").localeCompare(b.rpaGroupName ?? "", "nb")
		if (nameCompare !== 0) return nameCompare
		// Final tie-break on rpaGroupId for total ordering
		return a.rpaGroupId.localeCompare(b.rpaGroupId)
	})
	const rpaUserMap = new Map<string, (typeof rpaUsersResolved)[number]>()
	for (const u of sortedForDedupe) {
		const id = u.userObjectId.trim()
		if (!rpaUserMap.has(id)) {
			rpaUserMap.set(id, u)
		}
	}
	const rpaUserIds = new Set(rpaUserMap.keys())
	const seededAt = new Date().toISOString()

	const activeUsers: RpaStagedUser[] = [...rpaUserMap.values()].map((u) => {
		const trimmedId = u.userObjectId.trim()
		const a = existingAssessments.get(trimmedId)
		return {
			userObjectId: trimmedId,
			displayName: u.displayName,
			userPrincipalName: u.userPrincipalName,
			accountEnabled: u.accountEnabled,
			rpaGroupName: u.rpaGroupName,
			matchSource: u.matchSource as "nais" | "manual",
			isGone: false,
			owner: a?.owner ?? null,
			needComment: a?.needComment ?? null,
			criticalityComment: a?.criticalityComment ?? null,
			securityComment: a?.securityComment ?? null,
			decision: (a?.decision as RpaDecision | null) ?? null,
			decisionDeadline: a?.decisionDeadline ?? null,
		}
	})

	const goneUsers: RpaStagedUser[] = [...existingAssessments.entries()]
		.filter(([id]) => !rpaUserIds.has(id))
		.map(([, a]) => ({
			userObjectId: a.userObjectId.trim(),
			displayName: null,
			userPrincipalName: null,
			accountEnabled: null,
			rpaGroupName: null,
			matchSource: null,
			isGone: true,
			owner: a.owner,
			needComment: a.needComment,
			criticalityComment: a.criticalityComment,
			securityComment: a.securityComment,
			decision: a.decision as RpaDecision | null,
			decisionDeadline: a.decisionDeadline ?? null,
		}))

	// Sort: active users by displayName (fallback to userObjectId), then gone users last
	const allUsers = [...activeUsers, ...goneUsers].sort((a, b) => {
		// Gone users go last
		if (a.isGone !== b.isGone) return a.isGone ? 1 : -1
		// Sort by displayName (case-insensitive), fallback to userObjectId for determinism
		// Use Norwegian locale for correct æ/ø/å ordering
		const aName = (a.displayName ?? "").toLowerCase() || a.userObjectId.toLowerCase()
		const bName = (b.displayName ?? "").toLowerCase() || b.userObjectId.toLowerCase()
		const cmp = aName.localeCompare(bName, "nb")
		if (cmp !== 0) return cmp
		// Tie-break on userObjectId for full determinism
		return a.userObjectId.localeCompare(b.userObjectId, "nb")
	})

	const stagedData: RpaStagedData = {
		activityType: RPA_STAGED_DATA_ACTIVITY_TYPE,
		schemaVersion: RPA_STAGED_DATA_SCHEMA_VERSION,
		seededAt,
		users: allUsers,
	}

	return { stagedData, snapshot: toRpaUserSnapshot(stagedData) }
}

/**
 * Seed an RPA user maintenance activity with the initial list of RPA users.
 * If already seeded, returns the existing staged_data without modification.
 * applicationId is fetched from the activity's review to enforce the invariant.
 */
export async function seedRpaActivity(activityId: string, performedBy: string): Promise<RpaStagedData> {
	const [precheck] = await db
		.select({
			type: routineReviewActivities.type,
			status: routineReviewActivities.status,
			stagedData: routineReviewActivities.stagedData,
			reviewId: routineReviews.id,
			applicationId: routineReviews.applicationId,
		})
		.from(routineReviewActivities)
		.innerJoin(routineReviews, eq(routineReviewActivities.reviewId, routineReviews.id))
		.where(eq(routineReviewActivities.id, activityId))
		.limit(1)

	if (!precheck) throw new Error(`Fant ikke review-aktivitet ${activityId}`)
	if (precheck.type !== "rpa_user_maintenance") throw new Error(`Aktivitet ${activityId} er ikke RPA-brukervedlikehold`)
	if (!precheck.applicationId) throw new Response("RPA-aktiviteten mangler applikasjon", { status: 400 })
	if (precheck.status !== "pending") throw new Response("Kan ikke seed'e en fullført aktivitet", { status: 409 })
	if (precheck.stagedData) return parseRpaStagedData(precheck.stagedData)

	const seeded = await buildRpaSeedResult(precheck.applicationId, precheck.reviewId)

	const lockName = `rpa_user_maintenance-activity-${activityId}`
	const lockResult = await withAdvisoryLock(lockName, async () => {
		const [current] = await db
			.select({ status: routineReviewActivities.status, stagedData: routineReviewActivities.stagedData })
			.from(routineReviewActivities)
			.where(eq(routineReviewActivities.id, activityId))
			.limit(1)

		if (!current) throw new Error(`Fant ikke review-aktivitet ${activityId}`)
		if (current.status !== "pending") throw new Response("Kan ikke seed'e en fullført aktivitet", { status: 409 })
		if (current.stagedData) return parseRpaStagedData(current.stagedData)

		return db.transaction(async (tx) => {
			const [updated] = await tx
				.update(routineReviewActivities)
				.set({
					stagedData: seeded.stagedData,
					snapshotBefore: sql`COALESCE(${routineReviewActivities.snapshotBefore}, ${JSON.stringify(seeded.snapshot)}::jsonb)`,
				})
				.where(and(eq(routineReviewActivities.id, activityId), isNull(routineReviewActivities.stagedData)))
				.returning({ stagedData: routineReviewActivities.stagedData })

			if (updated?.stagedData) {
				await writeAuditLog(
					{
						action: "review_activity_seeded",
						entityType: "routine_review_activity",
						entityId: activityId,
						performedBy,
					},
					tx,
				)
				return parseRpaStagedData(updated.stagedData)
			}

			const [current2] = await tx
				.select({ stagedData: routineReviewActivities.stagedData })
				.from(routineReviewActivities)
				.where(eq(routineReviewActivities.id, activityId))
				.limit(1)

			if (!current2?.stagedData) throw new Error(`Kunne ikke seed'e RPA-aktivitet ${activityId}`)
			return parseRpaStagedData(current2.stagedData)
		})
	})

	if (lockResult !== null) return lockResult
	throw new Response("Gjennomgangen er låst av en annen operasjon. Prøv igjen.", { status: 409 })
}

/**
 * Apply a patch to the staged_data of an RPA user maintenance activity.
 * Seeds the activity first if staged_data is not yet set.
 */
export async function patchRpaActivity(
	activityId: string,
	patch: RpaStagedDataPatch,
	performedBy: string,
): Promise<void> {
	const [precheck] = await db
		.select({
			type: routineReviewActivities.type,
			status: routineReviewActivities.status,
			stagedData: routineReviewActivities.stagedData,
			applicationId: routineReviews.applicationId,
			reviewId: routineReviews.id,
			reviewStatus: routineReviews.status,
		})
		.from(routineReviewActivities)
		.innerJoin(routineReviews, eq(routineReviewActivities.reviewId, routineReviews.id))
		.where(eq(routineReviewActivities.id, activityId))
		.limit(1)

	if (!precheck) throw new Error(`Fant ikke review-aktivitet ${activityId}`)
	if (precheck.type !== "rpa_user_maintenance") throw new Error(`Aktivitet ${activityId} er ikke RPA-brukervedlikehold`)
	if (precheck.reviewStatus !== "draft") throw new Response("Gjennomgangen er ikke lenger redigerbar.", { status: 409 })
	if (precheck.status !== "pending") throw new Response("Kan ikke endre en fullført aktivitet", { status: 409 })

	const seedResult =
		!precheck.stagedData && precheck.applicationId
			? await buildRpaSeedResult(precheck.applicationId, precheck.reviewId)
			: !precheck.stagedData
				? (() => {
						throw new Response("RPA-aktiviteten mangler applikasjon", { status: 400 })
					})()
				: null

	const lockName = `rpa_user_maintenance-activity-${activityId}`
	const lockResult = await withAdvisoryLock(lockName, async () => {
		return db.transaction(async (tx) => {
			const [activity] = await tx
				.select({ status: routineReviewActivities.status, stagedData: routineReviewActivities.stagedData })
				.from(routineReviewActivities)
				.where(eq(routineReviewActivities.id, activityId))
				.limit(1)

			if (!activity) throw new Error(`Fant ikke review-aktivitet ${activityId}`)
			if (activity.status !== "pending") throw new Response("Kan ikke endre en fullført aktivitet", { status: 409 })

			let stagedData = activity.stagedData ? parseRpaStagedData(activity.stagedData) : null
			let seededInThisCall = false
			if (!stagedData) {
				if (!seedResult) throw new Error(`Mangler staged_data for RPA-aktivitet ${activityId}`)
				stagedData = seedResult.stagedData
				await tx
					.update(routineReviewActivities)
					.set({
						stagedData: seedResult.stagedData,
						snapshotBefore: sql`COALESCE(${routineReviewActivities.snapshotBefore}, ${JSON.stringify(seedResult.snapshot)}::jsonb)`,
					})
					.where(and(eq(routineReviewActivities.id, activityId), isNull(routineReviewActivities.stagedData)))
				seededInThisCall = true
			}

			let updatedData: RpaStagedData
			try {
				updatedData = applyRpaStagedDataPatch(stagedData, patch)
			} catch (e) {
				throw new Response(e instanceof Error ? e.message : "Ugyldig patch-operasjon", { status: 400 })
			}

			// Check for no-op before writing to DB to avoid unnecessary write load
			const wasNoOp = JSON.stringify(stagedData.users) === JSON.stringify(updatedData.users)

			// Only update staged_data if there's an actual change
			// (if seededInThisCall && wasNoOp, seed already wrote correct data — skip redundant UPDATE)
			if (!wasNoOp) {
				await tx
					.update(routineReviewActivities)
					.set({ stagedData: updatedData })
					.where(eq(routineReviewActivities.id, activityId))
			}

			if (seededInThisCall) {
				await writeAuditLog(
					{
						action: "review_activity_seeded",
						entityType: "routine_review_activity",
						entityId: activityId,
						performedBy,
					},
					tx,
				)
			}

			if (wasNoOp) return

			const patchedUser = updatedData.users.find((u) => u.userObjectId === patch.userObjectId)
			const previousUser = stagedData.users.find((u) => u.userObjectId === patch.userObjectId)

			await writeAuditLog(
				{
					action: "review_activity_rpa_patched",
					entityType: "routine_review_activity",
					entityId: activityId,
					previousValue: previousUser
						? JSON.stringify({
								owner: previousUser.owner,
								needComment: previousUser.needComment,
								criticalityComment: previousUser.criticalityComment,
								securityComment: previousUser.securityComment,
								decision: previousUser.decision,
								decisionDeadline: previousUser.decisionDeadline,
							})
						: null,
					newValue: patchedUser
						? JSON.stringify({
								userObjectId: patchedUser.userObjectId,
								owner: patchedUser.owner,
								needComment: patchedUser.needComment,
								criticalityComment: patchedUser.criticalityComment,
								securityComment: patchedUser.securityComment,
								decision: patchedUser.decision,
								decisionDeadline: patchedUser.decisionDeadline,
							})
						: null,
					metadata: { activityId, userObjectId: patch.userObjectId },
					performedBy,
				},
				tx,
			)
		})
	})

	if (lockResult === null) {
		throw new Response("Gjennomgangen er låst av en annen operasjon. Prøv igjen.", { status: 409 })
	}
}

/**
 * Complete an RPA user maintenance activity:
 * - Validates all non-gone users have a decision.
 * - Writes final assessments atomically to routine_rpa_user_assessments.
 * - Returns a snapshot of the final state for snapshotAfter.
 *
 * Must be called from within an advisory lock and a transaction.
 */
export async function completeRpaReviewActivity(
	activityId: string,
	reviewId: string,
	performedBy: string,
	executor: DbExecutor,
): Promise<RpaUserSnapshot> {
	const [activity] = await executor
		.select({
			id: routineReviewActivities.id,
			reviewId: routineReviewActivities.reviewId,
			status: routineReviewActivities.status,
			stagedData: routineReviewActivities.stagedData,
			applicationId: routineReviews.applicationId,
		})
		.from(routineReviewActivities)
		.innerJoin(routineReviews, eq(routineReviewActivities.reviewId, routineReviews.id))
		.where(eq(routineReviewActivities.id, activityId))
		.limit(1)

	if (!activity) throw new Error(`Fant ikke review-aktivitet ${activityId}`)
	// Validate reviewId parameter matches the activity's actual reviewId
	if (activity.reviewId !== reviewId) {
		throw new Response(`reviewId mismatch: forventet ${activity.reviewId}, fikk ${reviewId}`, { status: 400 })
	}
	if (activity.status !== "pending") throw new Response("Aktiviteten er allerede fullført", { status: 409 })
	if (!activity.applicationId) throw new Response("RPA-aktiviteten mangler applikasjon", { status: 400 })

	let stagedData = activity.stagedData ? parseRpaStagedData(activity.stagedData) : null
	if (!stagedData) {
		// Use executor to see uncommitted changes from same transaction (e.g., Entra's manual group changes)
		// Use activity.reviewId (validated to match parameter) for consistency
		const seeded = await buildRpaSeedResult(activity.applicationId, activity.reviewId, executor)
		const [seededActivity] = await executor
			.update(routineReviewActivities)
			.set({
				stagedData: seeded.stagedData,
				snapshotBefore: sql`COALESCE(${routineReviewActivities.snapshotBefore}, ${JSON.stringify(seeded.snapshot)}::jsonb)`,
			})
			.where(and(eq(routineReviewActivities.id, activityId), isNull(routineReviewActivities.stagedData)))
			.returning({ stagedData: routineReviewActivities.stagedData })

		if (seededActivity?.stagedData) {
			await writeAuditLog(
				{ action: "review_activity_seeded", entityType: "routine_review_activity", entityId: activityId, performedBy },
				executor,
			)
			stagedData = parseRpaStagedData(seededActivity.stagedData)
		} else {
			const [current] = await executor
				.select({ stagedData: routineReviewActivities.stagedData })
				.from(routineReviewActivities)
				.where(eq(routineReviewActivities.id, activityId))
				.limit(1)
			if (!current?.stagedData) throw new Error(`Mangler staged_data for RPA-aktivitet ${activityId}`)
			stagedData = parseRpaStagedData(current.stagedData)
		}
	}

	const activeUsers = stagedData.users.filter((u) => !u.isGone)
	const missingDecision = activeUsers.filter((u) => u.decision === null)
	if (missingDecision.length > 0) {
		throw new Response(
			`Alle aktive RPA-brukere må ha en beslutning før fullføring: ${missingDecision
				.map((u) => u.displayName ?? u.userObjectId)
				.join(", ")}`,
			{ status: 400 },
		)
	}

	const now = new Date()

	// Hent alle eksisterende assessments for denne gjennomgangen i én query (unngår N+1)
	// Use same collision handling as getRpaUserAssessmentsForReview for consistency
	const existingAssessments = await executor
		.select()
		.from(routineRpaUserAssessments)
		.where(eq(routineRpaUserAssessments.reviewId, reviewId))
	const existingByUserObjectId = buildAssessmentMapWithCollisionHandling(existingAssessments)

	for (const user of stagedData.users) {
		const existing = existingByUserObjectId.get(user.userObjectId) ?? null

		const hasChanges =
			!existing ||
			existing.owner !== user.owner ||
			existing.needComment !== user.needComment ||
			existing.criticalityComment !== user.criticalityComment ||
			existing.securityComment !== user.securityComment ||
			existing.decision !== user.decision ||
			existing.decisionDeadline !== user.decisionDeadline

		if (!hasChanges) continue

		// Use existing row's original userObjectId (may have whitespace) to hit correct unique constraint
		// For new rows, use trimmed value from staged_data
		const upsertUserObjectId = existing?.userObjectId ?? user.userObjectId

		const [upserted] = await executor
			.insert(routineRpaUserAssessments)
			.values({
				reviewId,
				userObjectId: upsertUserObjectId,
				owner: user.owner,
				needComment: user.needComment,
				criticalityComment: user.criticalityComment,
				securityComment: user.securityComment,
				decision: user.decision as RpaDecision | null,
				decisionDeadline: user.decisionDeadline,
				createdBy: performedBy,
				updatedBy: performedBy,
			})
			.onConflictDoUpdate({
				target: [routineRpaUserAssessments.reviewId, routineRpaUserAssessments.userObjectId],
				set: {
					owner: user.owner,
					needComment: user.needComment,
					criticalityComment: user.criticalityComment,
					securityComment: user.securityComment,
					decision: user.decision as RpaDecision | null,
					decisionDeadline: user.decisionDeadline,
					updatedBy: performedBy,
					updatedAt: now,
				},
			})
			.returning({ id: routineRpaUserAssessments.id })

		await writeAuditLog(
			{
				action: "rpa_user_assessment_saved",
				entityType: "routine_rpa_user_assessment",
				entityId: upserted.id,
				previousValue: existing
					? JSON.stringify({
							owner: existing.owner,
							needComment: existing.needComment,
							criticalityComment: existing.criticalityComment,
							securityComment: existing.securityComment,
							decision: existing.decision,
							decisionDeadline: existing.decisionDeadline,
						})
					: null,
				newValue: JSON.stringify({
					userObjectId: user.userObjectId,
					owner: user.owner,
					needComment: user.needComment,
					criticalityComment: user.criticalityComment,
					securityComment: user.securityComment,
					decision: user.decision,
					decisionDeadline: user.decisionDeadline,
				}),
				metadata: { reviewId, userObjectId: user.userObjectId },
				performedBy,
			},
			executor,
		)
	}

	return toRpaUserSnapshot(stagedData)
}
