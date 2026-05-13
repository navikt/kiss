import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm"
import { db } from "../connection.server"
import { applicationAuthIntegrations, applicationManualGroups } from "../schema/applications"
import { rpaGroupMembers, rpaGroups } from "../schema/rpa"
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

/** Mark an RPA group as recently synced by updating its updatedAt timestamp. */
export async function markRpaGroupSynced(rpaGroupId: string) {
	await db
		.update(rpaGroups)
		.set({ updatedAt: new Date(), updatedBy: "system:rpa-sync" })
		.where(eq(rpaGroups.id, rpaGroupId))
}

// ─── RPA Users for Application ────────────────────────────────────────────────

/**
 * Get RPA users that can access an application.
 * A robot user can access an app if its RPA group matches:
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
		userObjectId: string
		displayName: string | null
		userPrincipalName: string | null
		accountEnabled: boolean | null
		syncedAt: Date
	}>
> {
	// Collect all group IDs that grant RPA access
	const matchingGroupIds = new Set<string>()
	const sourceMap = new Map<string, "nais" | "manual">()

	for (const gid of naisGroupIds) {
		matchingGroupIds.add(gid)
		sourceMap.set(gid, "nais")
	}

	if (hasAllowAllUsers) {
		for (const gid of manualGroupIds) {
			if (!matchingGroupIds.has(gid)) {
				matchingGroupIds.add(gid)
				sourceMap.set(gid, "manual")
			}
		}
	}

	if (matchingGroupIds.size === 0) return []

	// Find active RPA groups matching these Entra IDs
	const activeRpaGroups = await db
		.select({
			id: rpaGroups.id,
			groupId: rpaGroups.groupId,
			groupName: rpaGroups.groupName,
		})
		.from(rpaGroups)
		.where(isNull(rpaGroups.archivedAt))

	const matchedRpaGroups = activeRpaGroups.filter((g) => matchingGroupIds.has(g.groupId))
	if (matchedRpaGroups.length === 0) return []

	// Fetch members for matched groups
	const results: Array<{
		rpaGroupId: string
		rpaGroupName: string | null
		entraGroupId: string
		matchSource: "nais" | "manual"
		userObjectId: string
		displayName: string | null
		userPrincipalName: string | null
		accountEnabled: boolean | null
		syncedAt: Date
	}> = []

	for (const rpaGroup of matchedRpaGroups) {
		const members = await db
			.select({
				userObjectId: rpaGroupMembers.userObjectId,
				displayName: rpaGroupMembers.displayName,
				userPrincipalName: rpaGroupMembers.userPrincipalName,
				accountEnabled: rpaGroupMembers.accountEnabled,
				syncedAt: rpaGroupMembers.syncedAt,
			})
			.from(rpaGroupMembers)
			.where(and(eq(rpaGroupMembers.rpaGroupId, rpaGroup.id), isNull(rpaGroupMembers.archivedAt)))
			.orderBy(rpaGroupMembers.displayName)

		for (const member of members) {
			results.push({
				rpaGroupId: rpaGroup.id,
				rpaGroupName: rpaGroup.groupName,
				entraGroupId: rpaGroup.groupId,
				matchSource: sourceMap.get(rpaGroup.groupId) ?? "nais",
				...member,
			})
		}
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
 * Batch-loads auth integrations and manual groups for efficiency.
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

	// Build per-app matching data
	const appGroupData = new Map<
		string,
		{ naisGroupIds: Set<string>; manualGroupIds: Set<string>; hasAllowAllUsers: boolean }
	>()

	for (const row of authRows) {
		if (!appGroupData.has(row.applicationId)) {
			appGroupData.set(row.applicationId, {
				naisGroupIds: new Set(),
				manualGroupIds: new Set(),
				hasAllowAllUsers: false,
			})
		}
		// biome-ignore lint/style/noNonNullAssertion: guaranteed by set above
		const data = appGroupData.get(row.applicationId)!
		if (row.type === "entra_id" && row.allowAllUsers === true) {
			data.hasAllowAllUsers = true
		}
		if (row.groups) {
			try {
				const parsed = JSON.parse(row.groups)
				if (Array.isArray(parsed)) {
					for (const gid of parsed) {
						if (typeof gid === "string") data.naisGroupIds.add(gid)
					}
				}
			} catch {
				// Invalid JSON — skip
			}
		}
	}

	for (const row of manualRows) {
		if (!appGroupData.has(row.applicationId)) {
			appGroupData.set(row.applicationId, {
				naisGroupIds: new Set(),
				manualGroupIds: new Set(),
				hasAllowAllUsers: false,
			})
		}
		// biome-ignore lint/style/noNonNullAssertion: guaranteed by set above
		appGroupData.get(row.applicationId)!.manualGroupIds.add(row.groupId)
	}

	// Collect all matching Entra group IDs with per-app source tracking
	// Key: entraGroupId → Map<applicationId, matchSource>
	const groupAppMap = new Map<string, Map<string, "nais" | "manual">>()

	for (const [appId, data] of appGroupData) {
		for (const gid of data.naisGroupIds) {
			if (!groupAppMap.has(gid)) groupAppMap.set(gid, new Map())
			// biome-ignore lint/style/noNonNullAssertion: guaranteed by set above
			groupAppMap.get(gid)!.set(appId, "nais")
		}
		if (data.hasAllowAllUsers) {
			for (const gid of data.manualGroupIds) {
				if (!groupAppMap.has(gid)) groupAppMap.set(gid, new Map())
				// biome-ignore lint/style/noNonNullAssertion: guaranteed by set above
				const appMap = groupAppMap.get(gid)!
				if (!appMap.has(appId)) appMap.set(appId, "manual")
			}
		}
	}

	if (groupAppMap.size === 0) return []

	// Load active RPA groups matching the collected Entra IDs
	const entraGroupIds = [...groupAppMap.keys()]
	const matchedRpaGroups = await db
		.select({
			id: rpaGroups.id,
			groupId: rpaGroups.groupId,
			groupName: rpaGroups.groupName,
		})
		.from(rpaGroups)
		.where(and(isNull(rpaGroups.archivedAt), inArray(rpaGroups.groupId, entraGroupIds)))

	if (matchedRpaGroups.length === 0) return []

	// Batch load members for all matched RPA groups
	const matchedRpaGroupIds = matchedRpaGroups.map((g) => g.id)
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
		.where(and(inArray(rpaGroupMembers.rpaGroupId, matchedRpaGroupIds), isNull(rpaGroupMembers.archivedAt)))
		.orderBy(rpaGroupMembers.displayName)

	// Build RPA group lookup
	const rpaGroupById = new Map(matchedRpaGroups.map((g) => [g.id, g]))

	// Resolve app names
	const allAppIds = new Set<string>()
	for (const appMap of groupAppMap.values()) {
		for (const appId of appMap.keys()) allAppIds.add(appId)
	}
	const appNames = await getApplicationNames([...allAppIds])

	// Aggregate: deduplicate by (userObjectId, rpaGroupId), collect apps
	const userGroupKey = (userOid: string, rpaGroupId: string) => `${userOid}::${rpaGroupId}`
	const resultMap = new Map<string, RpaUserForSection>()

	for (const member of allMembers) {
		const rpaGroup = rpaGroupById.get(member.rpaGroupId)
		if (!rpaGroup) continue

		const appMap = groupAppMap.get(rpaGroup.groupId)
		if (!appMap) continue

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
				applications: [...appMap.entries()].map(([appId, source]) => ({
					applicationId: appId,
					applicationName: appNames.get(appId) ?? "Ukjent",
					matchSource: source,
				})),
			})
		}
	}

	return [...resultMap.values()]
}
