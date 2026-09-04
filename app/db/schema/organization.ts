import { sql } from "drizzle-orm"
import { boolean, index, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core"

export const sections = pgTable("sections", {
	id: uuid("id").primaryKey().defaultRandom(),
	name: text("name").notNull(),
	slug: text("slug").notNull().unique(),
	description: text("description"),
	archivedAt: timestamp("archived_at", { withTimezone: true }),
	archivedBy: text("archived_by"),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	createdBy: text("created_by").notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	updatedBy: text("updated_by").notNull(),
})

export const clusters = pgTable("clusters", {
	id: uuid("id").primaryKey().defaultRandom(),
	sectionId: uuid("section_id")
		.notNull()
		.references(() => sections.id, { onDelete: "restrict" }),
	name: text("name").notNull(),
	slug: text("slug").notNull(),
	description: text("description"),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	createdBy: text("created_by").notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	updatedBy: text("updated_by").notNull(),
})

export const devTeams = pgTable(
	"dev_teams",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		sectionId: uuid("section_id")
			.notNull()
			.references(() => sections.id, { onDelete: "restrict" }),
		clusterId: uuid("cluster_id").references(() => clusters.id),
		name: text("name").notNull(),
		slug: text("slug").notNull(),
		description: text("description"),
		entraGroupId: text("entra_group_id"),
		entraGroupName: text("entra_group_name"),
		archivedAt: timestamp("archived_at", { withTimezone: true }),
		archivedBy: text("archived_by"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		createdBy: text("created_by").notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
		updatedBy: text("updated_by").notNull(),
	},
	(t) => [
		// Én Entra-gruppe kan kun kobles til ett aktivt team (1:1)
		uniqueIndex("dev_teams_entra_group_active_unique_idx")
			.on(t.entraGroupId)
			.where(sql`entra_group_id IS NOT NULL AND archived_at IS NULL`),
	],
)

// ─── Dev Team Entra Members ───────────────────────────────────────────────────
// Cachet medlemsliste for team koblet til en Entra ID-gruppe, syncet periodisk
// fra Microsoft Graph. Nøklet på navIdent (ikke Entra objekt-ID) fordi
// autorisasjon andre steder i KISS er navIdent-basert.

export const devTeamEntraMembers = pgTable(
	"dev_team_entra_members",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		devTeamId: uuid("dev_team_id")
			.notNull()
			.references(() => devTeams.id, { onDelete: "restrict" }),
		navIdent: text("nav_ident").notNull(),
		displayName: text("display_name"),
		mail: text("mail"),
		syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		createdBy: text("created_by").notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
		updatedBy: text("updated_by").notNull(),
		archivedAt: timestamp("archived_at", { withTimezone: true }),
		archivedBy: text("archived_by"),
	},
	(t) => [
		uniqueIndex("dev_team_entra_members_active_unique_idx").on(t.devTeamId, t.navIdent).where(sql`archived_at IS NULL`),
		index("dev_team_entra_members_nav_ident_active_idx").on(t.navIdent).where(sql`archived_at IS NULL`),
	],
)

export const userRoleEnum = [
	"admin",
	"section_manager",
	"tech_manager",
	"delivery_manager",
	"product_owner",
	"tech_lead",
	"auditor",
	"system_owner",
	"developer",
] as const
export type UserRole = (typeof userRoleEnum)[number]

export const userRoleLabels: Record<UserRole, string> = {
	admin: "Admin",
	section_manager: "Seksjonsleder",
	tech_manager: "Teknologileder",
	delivery_manager: "Leveranseleder",
	product_owner: "Produktleder",
	tech_lead: "Tech Lead",
	auditor: "Revisor",
	system_owner: "Systemeier",
	developer: "Utvikler",
}

export type RoleScope = "global" | "section" | "team"

export const roleScopeMap: Record<UserRole, RoleScope> = {
	admin: "global",
	auditor: "global",
	section_manager: "section",
	tech_manager: "section",
	delivery_manager: "section",
	system_owner: "section",
	product_owner: "team",
	tech_lead: "team",
	developer: "team",
}

export const users = pgTable("users", {
	id: uuid("id").primaryKey().defaultRandom(),
	navIdent: text("nav_ident").notNull().unique(),
	name: text("name").notNull(),
	email: text("email"),
	lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

// ─── User preferences ───────────────────────────────────────────────────

export const landingPageEnum = ["dashboard", "min-seksjon", "mine-team"] as const
export type LandingPage = (typeof landingPageEnum)[number]

export const landingPageLabels: Record<LandingPage, string> = {
	dashboard: "Dashboard",
	"min-seksjon": "Min seksjon",
	"mine-team": "Mine team",
}

export const userPreferences = pgTable("user_preferences", {
	id: uuid("id").primaryKey().defaultRandom(),
	navIdent: text("nav_ident").notNull().unique(),
	landingPage: text("landing_page", { enum: landingPageEnum }).notNull().default("dashboard"),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export const userRoles = pgTable("user_roles", {
	id: uuid("id").primaryKey().defaultRandom(),
	userId: uuid("user_id")
		.notNull()
		.references(() => users.id),
	role: text("role", { enum: userRoleEnum }).notNull(),
	sectionId: uuid("section_id").references(() => sections.id, { onDelete: "restrict" }),
	devTeamId: uuid("dev_team_id").references(() => devTeams.id, { onDelete: "restrict" }),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	createdBy: text("created_by").notNull(),
	archivedAt: timestamp("archived_at", { withTimezone: true }),
	archivedBy: text("archived_by"),
})

export const sectionEnvironments = pgTable(
	"section_environments",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		sectionId: uuid("section_id")
			.notNull()
			.references(() => sections.id, { onDelete: "restrict" }),
		cluster: text("cluster").notNull(),
		included: boolean("included").notNull().default(false),
		addedBy: text("added_by").notNull(),
		addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
		updatedBy: text("updated_by").notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [unique("uq_section_environments_cluster").on(table.sectionId, table.cluster)],
)
