import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { devTeams } from "./organization"

export const naisTeamStatusEnum = ["pending", "monitored", "ignored"] as const
export type NaisTeamStatus = (typeof naisTeamStatusEnum)[number]

export const naisTeams = pgTable("nais_teams", {
	id: uuid("id").primaryKey().defaultRandom(),
	slug: text("slug").notNull().unique(),
	displayName: text("display_name"),
	status: text("status", { enum: naisTeamStatusEnum }).notNull().default("pending"),
	devTeamId: uuid("dev_team_id").references(() => devTeams.id),
	discoveredAt: timestamp("discovered_at", { withTimezone: true }).notNull().defaultNow(),
	reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
	reviewedBy: text("reviewed_by"),
})

export const monitoredApplications = pgTable("monitored_applications", {
	id: uuid("id").primaryKey().defaultRandom(),
	name: text("name").notNull(),
	description: text("description"),
	addedManually: boolean("added_manually").notNull().default(false),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	createdBy: text("created_by").notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	updatedBy: text("updated_by").notNull(),
})

export const applicationEnvironments = pgTable("application_environments", {
	id: uuid("id").primaryKey().defaultRandom(),
	applicationId: uuid("application_id")
		.notNull()
		.references(() => monitoredApplications.id),
	cluster: text("cluster").notNull(),
	namespace: text("namespace").notNull(),
	naisTeamId: uuid("nais_team_id").references(() => naisTeams.id),
	discoveredAt: timestamp("discovered_at", { withTimezone: true }).notNull().defaultNow(),
})

export const applicationTeamMappings = pgTable("application_team_mappings", {
	id: uuid("id").primaryKey().defaultRandom(),
	applicationId: uuid("application_id")
		.notNull()
		.references(() => monitoredApplications.id),
	devTeamId: uuid("dev_team_id")
		.notNull()
		.references(() => devTeams.id),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	createdBy: text("created_by").notNull(),
})
