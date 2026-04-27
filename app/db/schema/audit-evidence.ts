import { sql } from "drizzle-orm"
import { boolean, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core"
import { groupCriticalityEnum, monitoredApplications } from "./applications"

// ─── Oracle Instances ────────────────────────────────────────────────────

export const applicationOracleInstances = pgTable(
	"application_oracle_instances",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		applicationId: uuid("application_id")
			.notNull()
			.references(() => monitoredApplications.id, { onDelete: "restrict" }),
		instanceId: text("instance_id").notNull(),
		includeInReport: boolean("include_in_report").notNull().default(true),
		configuredBy: text("configured_by").notNull(),
		configuredAt: timestamp("configured_at", { withTimezone: true }).notNull().defaultNow(),
		archivedAt: timestamp("archived_at", { withTimezone: true }),
		archivedBy: text("archived_by"),
	},
	(t) => [
		// Partial unique: kun én aktiv (ikke-arkivert) rad per (applikasjon, instans).
		// Arkiverte rader er bevisst utelatt slik at historikk kan ligge ved siden
		// av en ny aktiv rad når en instans re-konfigureres etter å ha vært fjernet.
		uniqueIndex("application_oracle_instances_active_unique_idx")
			.on(t.applicationId, t.instanceId)
			.where(sql`archived_at IS NULL`),
	],
)

// ─── Audit Evidence Snapshots ────────────────────────────────────────────

export const auditEvidenceOverallStatusEnum = ["OK", "PARTIAL", "FAILED"] as const
export type AuditEvidenceOverallStatus = (typeof auditEvidenceOverallStatusEnum)[number]

export const auditEvidenceSnapshots = pgTable("audit_evidence_snapshots", {
	id: uuid("id").primaryKey().defaultRandom(),
	applicationId: uuid("application_id")
		.notNull()
		.references(() => monitoredApplications.id, { onDelete: "restrict" }),
	instanceId: text("instance_id").notNull(),
	overallStatus: text("overall_status", { enum: auditEvidenceOverallStatusEnum }).notNull(),
	collectedAt: timestamp("collected_at", { withTimezone: true }).notNull(),
	fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
	fetchedBy: text("fetched_by").notNull(),
	bucketPath: text("bucket_path").notNull(),
})

// ─── Oracle Role Criticality Assessments ─────────────────────────────────

export { groupCriticalityEnum } from "./applications"

export const oracleRoleAssessments = pgTable(
	"oracle_role_assessments",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		applicationId: uuid("application_id")
			.notNull()
			.references(() => monitoredApplications.id, { onDelete: "restrict" }),
		instanceId: text("instance_id").notNull(),
		roleName: text("role_name").notNull(),
		criticality: text("criticality", { enum: groupCriticalityEnum }).notNull(),
		assessedBy: text("assessed_by").notNull(),
		assessedAt: timestamp("assessed_at", { withTimezone: true }).notNull().defaultNow(),
		updatedBy: text("updated_by").notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [unique("uq_oracle_role_assessment").on(t.applicationId, t.instanceId, t.roleName)],
)
