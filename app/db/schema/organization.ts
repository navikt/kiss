import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"

export const sections = pgTable("sections", {
	id: uuid("id").primaryKey().defaultRandom(),
	name: text("name").notNull(),
	slug: text("slug").notNull().unique(),
	description: text("description"),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	createdBy: text("created_by").notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	updatedBy: text("updated_by").notNull(),
})

export const clusters = pgTable("clusters", {
	id: uuid("id").primaryKey().defaultRandom(),
	sectionId: uuid("section_id")
		.notNull()
		.references(() => sections.id),
	name: text("name").notNull(),
	slug: text("slug").notNull(),
	description: text("description"),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	createdBy: text("created_by").notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	updatedBy: text("updated_by").notNull(),
})

export const devTeams = pgTable("dev_teams", {
	id: uuid("id").primaryKey().defaultRandom(),
	sectionId: uuid("section_id")
		.notNull()
		.references(() => sections.id),
	clusterId: uuid("cluster_id").references(() => clusters.id),
	name: text("name").notNull(),
	slug: text("slug").notNull(),
	description: text("description"),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	createdBy: text("created_by").notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	updatedBy: text("updated_by").notNull(),
})

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

export const users = pgTable("users", {
	id: uuid("id").primaryKey().defaultRandom(),
	navIdent: text("nav_ident").notNull().unique(),
	name: text("name").notNull(),
	email: text("email"),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export const userRoles = pgTable("user_roles", {
	id: uuid("id").primaryKey().defaultRandom(),
	userId: uuid("user_id")
		.notNull()
		.references(() => users.id),
	role: text("role", { enum: userRoleEnum }).notNull(),
	sectionId: uuid("section_id").references(() => sections.id),
	devTeamId: uuid("dev_team_id").references(() => devTeams.id),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	createdBy: text("created_by").notNull(),
})
