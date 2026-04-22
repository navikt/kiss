import { boolean, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core"
import { devTeams, sections } from "./organization"

export const naisTeamStatusEnum = ["pending", "monitored", "ignored"] as const
export type NaisTeamStatus = (typeof naisTeamStatusEnum)[number]

export const naisTeams = pgTable("nais_teams", {
	id: uuid("id").primaryKey().defaultRandom(),
	slug: text("slug").notNull().unique(),
	displayName: text("display_name"),
	appCount: integer("app_count").notNull().default(0),
	status: text("status", { enum: naisTeamStatusEnum }).notNull().default("pending"),
	sectionId: uuid("section_id").references(() => sections.id, { onDelete: "restrict" }),
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

export const persistenceTypeLabels: Record<PersistenceType, string> = {
	cloud_sql_postgres: "Cloud SQL (PostgreSQL)",
	nais_postgres: "Nais Postgres",
	on_prem_postgres: "On-prem PostgreSQL",
	opensearch: "OpenSearch",
	bucket: "GCS Bucket",
	valkey: "Valkey (cache)",
	oracle: "Oracle",
	other: "Annet",
}

export const dataClassificationEnum = ["not_critical", "critical", "financial_regulation"] as const
export type DataClassification = (typeof dataClassificationEnum)[number]

export const dataClassificationLabels: Record<DataClassification, string> = {
	not_critical: "Ikke kritiske data",
	critical: "Kritiske data",
	financial_regulation: "Data underlagt økonomireglementet i staten",
}

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
	oracleInstanceId: text("oracle_instance_id"),
	dataClassification: text("data_classification", { enum: dataClassificationEnum }),
	manuallyAdded: boolean("manually_added").notNull().default(false),
	extra: text("extra"),
	discoveredAt: timestamp("discovered_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export const sectionIgnoredApplications = pgTable("section_ignored_applications", {
	id: uuid("id").primaryKey().defaultRandom(),
	sectionId: uuid("section_id")
		.notNull()
		.references(() => sections.id, { onDelete: "restrict" }),
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

export const linkSuggestions = pgTable(
	"link_suggestions",
	{
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
	},
	(t) => [unique("uq_link_suggestion_pair").on(t.primaryAppId, t.secondaryAppId, t.matchType)],
)

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

export const accessPolicyAcknowledgments = pgTable("access_policy_acknowledgments", {
	id: uuid("id").primaryKey().defaultRandom(),
	applicationId: uuid("application_id")
		.notNull()
		.references(() => monitoredApplications.id),
	ruleApplication: text("rule_application").notNull(),
	comment: text("comment").notNull(),
	acknowledgedBy: text("acknowledged_by").notNull(),
	acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }).notNull().defaultNow(),
	revokedAt: timestamp("revoked_at", { withTimezone: true }),
	revokedBy: text("revoked_by"),
})

export const naisDiscoveredApps = pgTable("nais_discovered_apps", {
	id: uuid("id").primaryKey().defaultRandom(),
	name: text("name").notNull(),
	naisTeamId: uuid("nais_team_id")
		.notNull()
		.references(() => naisTeams.id),
	discoveredAt: timestamp("discovered_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export const applicationManualGroups = pgTable(
	"application_manual_groups",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		applicationId: uuid("application_id")
			.notNull()
			.references(() => monitoredApplications.id),
		groupId: text("group_id").notNull(),
		groupName: text("group_name"),
		createdBy: text("created_by").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [unique().on(t.applicationId, t.groupId)],
)

export const groupCriticalityEnum = ["low", "medium", "high", "very_high"] as const
export type GroupCriticality = (typeof groupCriticalityEnum)[number]

export const groupCriticalityLabels: Record<GroupCriticality, string> = {
	low: "Lav",
	medium: "Middels",
	high: "Høy",
	very_high: "Svært høy",
}

export const applicationGroupAssessments = pgTable(
	"application_group_assessments",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		applicationId: uuid("application_id")
			.notNull()
			.references(() => monitoredApplications.id),
		groupId: text("group_id").notNull(),
		criticality: text("criticality", { enum: groupCriticalityEnum }).notNull(),
		assessedBy: text("assessed_by").notNull(),
		assessedAt: timestamp("assessed_at", { withTimezone: true }).notNull().defaultNow(),
		updatedBy: text("updated_by").notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [unique().on(t.applicationId, t.groupId)],
)

// ─── Entra Group Access Classification ────────────────────────────────────

export const groupAccessClassificationEnum = ["mine_tilganger", "identrutina", "nais_console", "annet"] as const
export type GroupAccessClassification = (typeof groupAccessClassificationEnum)[number]

export const groupAccessClassificationLabels: Record<GroupAccessClassification, string> = {
	mine_tilganger: "Mine Tilganger",
	identrutina: "Identrutina",
	nais_console: "Nais Console",
	annet: "Annet",
}

export const entraGroupClassifications = pgTable("entra_group_classifications", {
	id: uuid("id").primaryKey().defaultRandom(),
	groupId: text("group_id").notNull().unique(),
	classification: text("classification", { enum: groupAccessClassificationEnum }).notNull(),
	createdBy: text("created_by").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	updatedBy: text("updated_by").notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})
