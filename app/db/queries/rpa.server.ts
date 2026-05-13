import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm"
import { db } from "../connection.server"
import { applicationAuthIntegrations, applicationManualGroups } from "../schema/applications"
import { rpaGroupMembers, rpaGroups, rpaUserGroupMemberships } from "../schema/rpa"
import { writeAuditLog } from "./audit.server"

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

	// Get unique user IDs
	const uniqueUserIds = [...new Set(allMembers.map((m) => m.userObjectId))]
	if (uniqueUserIds.length === 0) return []

	// Fetch their Entra ID group memberships that match app access groups
	const accessGroupIdList = [...accessGroupIds.keys()]
	if (accessGroupIdList.length === 0) return []
	const matchingMemberships = await db
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
