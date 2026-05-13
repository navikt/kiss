import { and, eq, isNotNull, isNull, sql } from "drizzle-orm"
import { db } from "../connection.server"
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
