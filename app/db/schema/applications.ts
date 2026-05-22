import { sql } from "drizzle-orm"
import {
	type AnyPgColumn,
	boolean,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core"
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
	devTeamId: uuid("dev_team_id").references(() => devTeams.id, { onDelete: "restrict" }),
	discoveredAt: timestamp("discovered_at", { withTimezone: true }).notNull().defaultNow(),
	reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
	reviewedBy: text("reviewed_by"),
})

export const monitoredApplications = pgTable("monitored_applications", {
	id: uuid("id").primaryKey().defaultRandom(),
	name: text("name").notNull(),
	description: text("description"),
	gitRepository: text("git_repository"),
	addedManually: boolean("added_manually").notNull().default(false),
	primaryApplicationId: uuid("primary_application_id").references((): AnyPgColumn => monitoredApplications.id, {
		onDelete: "restrict",
	}),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	createdBy: text("created_by").notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	updatedBy: text("updated_by").notNull(),
	archivedAt: timestamp("archived_at", { withTimezone: true }),
	archivedBy: text("archived_by"),
})

export const applicationEnvironments = pgTable(
	"application_environments",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		applicationId: uuid("application_id")
			.notNull()
			.references(() => monitoredApplications.id, { onDelete: "restrict" }),
		cluster: text("cluster").notNull(),
		namespace: text("namespace").notNull(),
		imageName: text("image_name"),
		gitRepository: text("git_repository"),
		naisTeamId: uuid("nais_team_id").references(() => naisTeams.id),
		discoveredAt: timestamp("discovered_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		index("idx_application_environments_app_team").on(t.applicationId, t.naisTeamId),
		index("idx_application_environments_team_app").on(t.naisTeamId, t.applicationId),
	],
)

export const applicationTeamMappings = pgTable(
	"application_team_mappings",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		applicationId: uuid("application_id")
			.notNull()
			.references(() => monitoredApplications.id, { onDelete: "restrict" }),
		devTeamId: uuid("dev_team_id")
			.notNull()
			.references(() => devTeams.id, { onDelete: "restrict" }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		createdBy: text("created_by").notNull(),
		archivedAt: timestamp("archived_at", { withTimezone: true }),
		archivedBy: text("archived_by"),
	},
	(table) => [
		uniqueIndex("uq_app_team_mapping_active")
			.on(table.applicationId, table.devTeamId)
			.where(sql`${table.archivedAt} IS NULL`),
	],
)

export const devTeamNaisTeamMappings = pgTable(
	"dev_team_nais_team_mappings",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		devTeamId: uuid("dev_team_id")
			.notNull()
			.references(() => devTeams.id, { onDelete: "restrict" }),
		naisTeamId: uuid("nais_team_id")
			.notNull()
			.references(() => naisTeams.id, { onDelete: "restrict" }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		createdBy: text("created_by").notNull(),
		archivedAt: timestamp("archived_at", { withTimezone: true }),
		archivedBy: text("archived_by"),
	},
	(table) => [
		uniqueIndex("uq_dev_team_nais_team_mapping_active")
			.on(table.devTeamId, table.naisTeamId)
			.where(sql`${table.archivedAt} IS NULL`),
	],
)

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

export const applicationPersistence = pgTable(
	"application_persistence",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		applicationId: uuid("application_id")
			.notNull()
			.references(() => monitoredApplications.id, { onDelete: "restrict" }),
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
		archivedAt: timestamp("archived_at", { withTimezone: true }),
		archivedBy: text("archived_by"),
	},
	(t) => [
		// Partial unique: kun én aktiv rad per (applikasjon, type, navn). Stenger
		// TOCTOU-luken i `ensureOraclePersistenceEntries` der to samtidige
		// transaksjoner kunne ende opp med duplikat aktiv rad. Arkiverte rader
		// (archived_at IS NOT NULL) er bevisst utelatt slik at historikk kan
		// ligge ved siden av en ny aktiv rad.
		uniqueIndex("application_persistence_active_unique_idx")
			.on(t.applicationId, t.type, t.name)
			.where(sql`archived_at IS NULL`),
	],
)

export const sectionIgnoredApplications = pgTable(
	"section_ignored_applications",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		sectionId: uuid("section_id")
			.notNull()
			.references(() => sections.id, { onDelete: "restrict" }),
		applicationId: uuid("application_id")
			.notNull()
			.references(() => monitoredApplications.id, { onDelete: "restrict" }),
		reason: text("reason"),
		ignoredAt: timestamp("ignored_at", { withTimezone: true }).notNull().defaultNow(),
		ignoredBy: text("ignored_by").notNull(),
		archivedAt: timestamp("archived_at", { withTimezone: true }),
		archivedBy: text("archived_by"),
	},
	(t) => [
		// Partial unique: kun én aktiv ignorering per (seksjon, applikasjon).
		// Arkiverte rader (archived_at IS NOT NULL) er bevisst utelatt slik at
		// historikk kan ligge ved siden av en ny aktiv rad.
		uniqueIndex("section_ignored_applications_active_unique_idx")
			.on(t.sectionId, t.applicationId)
			.where(sql`archived_at IS NULL`),
	],
)

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
			.references(() => monitoredApplications.id, { onDelete: "restrict" }),
		secondaryAppId: uuid("secondary_app_id")
			.notNull()
			.references(() => monitoredApplications.id, { onDelete: "restrict" }),
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
		.references(() => monitoredApplications.id, { onDelete: "restrict" }),
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

export const applicationEnvironmentAccessPolicyRules = pgTable(
	"application_environment_access_policy_rules",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		applicationEnvironmentId: uuid("application_environment_id")
			.notNull()
			.references(() => applicationEnvironments.id, { onDelete: "restrict" }),
		direction: text("direction", { enum: accessPolicyDirectionEnum }).notNull(),
		ruleApplication: text("rule_application").notNull(),
		ruleNamespace: text("rule_namespace"),
		ruleCluster: text("rule_cluster"),
		discoveredAt: timestamp("discovered_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
		archivedAt: timestamp("archived_at", { withTimezone: true }),
		archivedBy: text("archived_by"),
	},
	(t) => [
		uniqueIndex("application_env_access_policy_rules_active_unique_idx")
			.on(
				t.applicationEnvironmentId,
				t.direction,
				t.ruleApplication,
				sql`COALESCE(${t.ruleNamespace}, '')`,
				sql`COALESCE(${t.ruleCluster}, '')`,
			)
			.where(sql`archived_at IS NULL`),
		index("idx_app_env_access_policy_rules_env_direction").on(t.applicationEnvironmentId, t.direction),
	],
)

export const accessPolicyAcknowledgments = pgTable("access_policy_acknowledgments", {
	id: uuid("id").primaryKey().defaultRandom(),
	applicationId: uuid("application_id")
		.notNull()
		.references(() => monitoredApplications.id, { onDelete: "restrict" }),
	ruleApplication: text("rule_application").notNull(),
	comment: text("comment").notNull(),
	acknowledgedBy: text("acknowledged_by").notNull(),
	acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }).notNull().defaultNow(),
	revokedAt: timestamp("revoked_at", { withTimezone: true }),
	revokedBy: text("revoked_by"),
})

export const naisDiscoveredApps = pgTable(
	"nais_discovered_apps",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		name: text("name").notNull(),
		naisTeamId: uuid("nais_team_id")
			.notNull()
			.references(() => naisTeams.id),
		discoveredAt: timestamp("discovered_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
		archivedAt: timestamp("archived_at", { withTimezone: true }),
		archivedBy: text("archived_by"),
	},
	(t) => [
		// Partial unique: kun én aktiv (ikke-arkivert) rad per (navn, team).
		// Arkiverte rader bevares for historikk og audit-sporing.
		uniqueIndex("nais_discovered_apps_active_unique_idx").on(t.name, t.naisTeamId).where(sql`archived_at IS NULL`),
	],
)

export const applicationManualGroups = pgTable(
	"application_manual_groups",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		applicationId: uuid("application_id")
			.notNull()
			.references(() => monitoredApplications.id, { onDelete: "restrict" }),
		groupId: text("group_id").notNull(),
		groupName: text("group_name"),
		createdBy: text("created_by").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		archivedAt: timestamp("archived_at", { withTimezone: true }),
		archivedBy: text("archived_by"),
	},
	(t) => [
		// Partial unique: kun én aktiv (ikke-arkivert) rad per (applikasjon, gruppe).
		// Arkiverte rader er bevisst utelatt slik at historikk kan ligge ved siden
		// av en ny aktiv rad når en gruppe re-legges til etter å ha vært fjernet.
		uniqueIndex("application_manual_groups_active_unique_idx")
			.on(t.applicationId, t.groupId)
			.where(sql`archived_at IS NULL`),
	],
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
			.references(() => monitoredApplications.id, { onDelete: "restrict" }),
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

export const entraGroupClassifications = pgTable(
	"entra_group_classifications",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		groupId: text("group_id").notNull(),
		classification: text("classification", { enum: groupAccessClassificationEnum }).notNull(),
		createdBy: text("created_by").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedBy: text("updated_by").notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
		archivedAt: timestamp("archived_at", { withTimezone: true }),
		archivedBy: text("archived_by"),
	},
	(t) => [
		// Partial unique: kun én aktiv (ikke-arkivert) klassifisering per group_id.
		// Arkiverte rader er bevisst utelatt slik at historikk kan ligge ved siden
		// av en ny aktiv rad når en gruppe re-klassifiseres etter å ha vært fjernet.
		uniqueIndex("entra_group_classifications_active_unique_idx").on(t.groupId).where(sql`archived_at IS NULL`),
	],
)

// --- Økonomisystem-klassifisering ---

export const economySystemTypeEnum = ["regnskapssystem", "lonnssystem", "fakturabehandling", "hjelpesystem"] as const
export type EconomySystemType = (typeof economySystemTypeEnum)[number]

export const economySystemTypeLabels: Record<EconomySystemType, string> = {
	regnskapssystem: "Regnskapssystem (hovedbok/reskontro)",
	lonnssystem: "Lønnssystem",
	fakturabehandling: "Fakturabehandlingssystem",
	hjelpesystem: "Hjelpesystem (vedtakssystem, registre, mellomliggende)",
}

export const applicationEconomyClassifications = pgTable(
	"application_economy_classifications",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		applicationId: uuid("application_id")
			.notNull()
			.references(() => monitoredApplications.id, { onDelete: "restrict" }),
		isEconomySystem: boolean("is_economy_system").notNull(),
		economySystemType: text("economy_system_type", { enum: economySystemTypeEnum }),
		justification: text("justification").notNull(),
		validFrom: timestamp("valid_from", { withTimezone: true }).notNull().defaultNow(),
		validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		createdBy: text("created_by").notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
		updatedBy: text("updated_by").notNull(),
		archivedAt: timestamp("archived_at", { withTimezone: true }),
		archivedBy: text("archived_by"),
	},
	(t) => [
		uniqueIndex("application_economy_classifications_active_unique_idx")
			.on(t.applicationId)
			.where(sql`archived_at IS NULL`),
	],
)
