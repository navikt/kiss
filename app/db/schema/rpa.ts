import { sql } from "drizzle-orm"
import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core"

// ─── RPA Group Configuration ──────────────────────────────────────────────────
// Globally configured Entra ID groups whose members are RPA (robot) users.
// Managed by admins via admin/rpa-grupper.

export const rpaGroups = pgTable(
	"rpa_groups",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		groupId: text("group_id").notNull(),
		groupName: text("group_name"),
		createdBy: text("created_by").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedBy: text("updated_by").notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
		archivedAt: timestamp("archived_at", { withTimezone: true }),
		archivedBy: text("archived_by"),
	},
	(t) => [uniqueIndex("rpa_groups_active_unique_idx").on(t.groupId).where(sql`archived_at IS NULL`)],
)

// ─── RPA Group Members ────────────────────────────────────────────────────────
// Members synced from Microsoft Graph API for each configured RPA group.
// Updated daily via scheduled sync job.

export const rpaGroupMembers = pgTable(
	"rpa_group_members",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		rpaGroupId: uuid("rpa_group_id")
			.notNull()
			.references(() => rpaGroups.id, { onDelete: "restrict" }),
		userObjectId: text("user_object_id").notNull(),
		displayName: text("display_name"),
		userPrincipalName: text("user_principal_name"),
		accountEnabled: boolean("account_enabled"),
		syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
		archivedAt: timestamp("archived_at", { withTimezone: true }),
		archivedBy: text("archived_by"),
	},
	(t) => [
		uniqueIndex("rpa_group_members_active_unique_idx").on(t.rpaGroupId, t.userObjectId).where(sql`archived_at IS NULL`),
		index("rpa_group_members_user_active_idx").on(t.userObjectId).where(sql`archived_at IS NULL`),
	],
)

// ─── RPA User Group Memberships ───────────────────────────────────────────────
// All Entra ID group memberships for known RPA users.
// Synced from Microsoft Graph API (GET /users/{id}/memberOf).
// Used to cross-reference RPA users against app access groups.

export const rpaUserGroupMemberships = pgTable(
	"rpa_user_group_memberships",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userObjectId: text("user_object_id").notNull(),
		groupId: text("group_id").notNull(),
		groupDisplayName: text("group_display_name"),
		syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		uniqueIndex("rpa_user_group_memberships_unique_idx").on(t.userObjectId, t.groupId),
		index("rpa_user_group_memberships_group_idx").on(t.groupId),
	],
)
