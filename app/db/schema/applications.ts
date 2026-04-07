import { boolean, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { devTeams, sections } from "./organization"

export const naisTeamStatusEnum = ["pending", "monitored", "ignored"] as const
export type NaisTeamStatus = (typeof naisTeamStatusEnum)[number]

export const naisTeams = pgTable("nais_teams", {
	id: uuid("id").primaryKey().defaultRandom(),
	slug: text("slug").notNull().unique(),
	displayName: text("display_name"),
	appCount: integer("app_count").notNull().default(0),
	status: text("status", { enum: naisTeamStatusEnum }).notNull().default("pending"),
	sectionId: uuid("section_id").references(() => sections.id),
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
	primaryApplicationId: uuid("primary_application_id"),
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
	imageName: text("image_name"),
	gitRepository: text("git_repository"),
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

export const devTeamNaisTeamMappings = pgTable("dev_team_nais_team_mappings", {
	id: uuid("id").primaryKey().defaultRandom(),
	devTeamId: uuid("dev_team_id")
		.notNull()
		.references(() => devTeams.id, { onDelete: "cascade" }),
	naisTeamId: uuid("nais_team_id")
		.notNull()
		.references(() => naisTeams.id, { onDelete: "cascade" }),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	createdBy: text("created_by").notNull(),
})

export const persistenceTypeEnum = [
	"cloud_sql_postgres",
	"nais_postgres",
	"on_prem_postgres",
	"opensearch",
	"bucket",
	"valkey",
	"oracle",
	"other",
] as const
export type PersistenceType = (typeof persistenceTypeEnum)[number]

export const applicationPersistence = pgTable("application_persistence", {
	id: uuid("id").primaryKey().defaultRandom(),
	applicationId: uuid("application_id")
		.notNull()
		.references(() => monitoredApplications.id),
	type: text("type", { enum: persistenceTypeEnum }).notNull(),
	name: text("name").notNull(),
	version: text("version"),
	tier: text("tier"),
	highAvailability: boolean("high_availability"),
	auditLogging: boolean("audit_logging"),
	auditLogUrl: text("audit_log_url"),
	extra: text("extra"),
	discoveredAt: timestamp("discovered_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export const sectionIgnoredApplications = pgTable("section_ignored_applications", {
	id: uuid("id").primaryKey().defaultRandom(),
	sectionId: uuid("section_id")
		.notNull()
		.references(() => sections.id),
	applicationId: uuid("application_id")
		.notNull()
		.references(() => monitoredApplications.id),
	reason: text("reason"),
	ignoredAt: timestamp("ignored_at", { withTimezone: true }).notNull().defaultNow(),
	ignoredBy: text("ignored_by").notNull(),
})

export const linkSuggestionStatusEnum = ["pending", "accepted", "rejected"] as const
export type LinkSuggestionStatus = (typeof linkSuggestionStatusEnum)[number]

export const linkSuggestionMatchTypeEnum = ["image_match", "name_pattern", "both"] as const
export type LinkSuggestionMatchType = (typeof linkSuggestionMatchTypeEnum)[number]

export const linkSuggestions = pgTable("link_suggestions", {
	id: uuid("id").primaryKey().defaultRandom(),
	primaryAppId: uuid("primary_app_id")
		.notNull()
		.references(() => monitoredApplications.id),
	secondaryAppId: uuid("secondary_app_id")
		.notNull()
		.references(() => monitoredApplications.id),
	matchType: text("match_type", { enum: linkSuggestionMatchTypeEnum }).notNull(),
	confidence: text("confidence").notNull(),
	status: text("status", { enum: linkSuggestionStatusEnum }).notNull().default("pending"),
	reviewedBy: text("reviewed_by"),
	reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

export const authIntegrationTypeEnum = ["entra_id", "token_x", "id_porten", "maskinporten"] as const
export type AuthIntegrationType = (typeof authIntegrationTypeEnum)[number]

export const applicationAuthIntegrations = pgTable("application_auth_integrations", {
	id: uuid("id").primaryKey().defaultRandom(),
	applicationId: uuid("application_id")
		.notNull()
		.references(() => monitoredApplications.id),
	type: text("type", { enum: authIntegrationTypeEnum }).notNull(),
	enabled: boolean("enabled").notNull().default(true),
	allowAllUsers: boolean("allow_all_users"),
	claimsExtra: text("claims_extra"),
	groups: text("groups"),
	sidecarEnabled: boolean("sidecar_enabled"),
	inboundRules: text("inbound_rules"),
	discoveredAt: timestamp("discovered_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export const accessPolicyDirectionEnum = ["inbound", "outbound"] as const
export type AccessPolicyDirection = (typeof accessPolicyDirectionEnum)[number]

export const applicationAccessPolicyRules = pgTable("application_access_policy_rules", {
	id: uuid("id").primaryKey().defaultRandom(),
	applicationId: uuid("application_id")
		.notNull()
		.references(() => monitoredApplications.id),
	direction: text("direction", { enum: accessPolicyDirectionEnum }).notNull(),
	ruleApplication: text("rule_application").notNull(),
	ruleNamespace: text("rule_namespace"),
	ruleCluster: text("rule_cluster"),
	discoveredAt: timestamp("discovered_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})
