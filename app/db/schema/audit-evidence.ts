import { boolean, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core"
import { monitoredApplications } from "./applications"

// ─── Oracle Instances ────────────────────────────────────────────────────

export const applicationOracleInstances = pgTable(
	"application_oracle_instances",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		applicationId: uuid("application_id")
			.notNull()
			.references(() => monitoredApplications.id),
		instanceId: text("instance_id").notNull(),
		includeInReport: boolean("include_in_report").notNull().default(true),
		configuredBy: text("configured_by").notNull(),
		configuredAt: timestamp("configured_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [unique("uq_application_oracle_instance").on(t.applicationId, t.instanceId)],
)

// ─── Audit Evidence Snapshots ────────────────────────────────────────────

export const auditEvidenceOverallStatusEnum = ["OK", "PARTIAL", "FAILED"] as const
export type AuditEvidenceOverallStatus = (typeof auditEvidenceOverallStatusEnum)[number]

export const auditEvidenceSnapshots = pgTable("audit_evidence_snapshots", {
	id: uuid("id").primaryKey().defaultRandom(),
	applicationId: uuid("application_id")
		.notNull()
		.references(() => monitoredApplications.id),
	instanceId: text("instance_id").notNull(),
	overallStatus: text("overall_status", { enum: auditEvidenceOverallStatusEnum }).notNull(),
	collectedAt: timestamp("collected_at", { withTimezone: true }).notNull(),
	fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
	fetchedBy: text("fetched_by").notNull(),
	bucketPath: text("bucket_path").notNull(),
})

// ─── Oracle Profile Criticality Assessments ──────────────────────────────

export { groupCriticalityEnum } from "./applications"

export const oracleProfileAssessments = pgTable(
	"oracle_profile_assessments",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		applicationId: uuid("application_id")
			.notNull()
			.references(() => monitoredApplications.id),
		instanceId: text("instance_id").notNull(),
		profileName: text("profile_name").notNull(),
		criticality: text("criticality", { enum: ["low", "medium", "high", "very_high"] }).notNull(),
		assessedBy: text("assessed_by").notNull(),
		assessedAt: timestamp("assessed_at", { withTimezone: true }).notNull().defaultNow(),
		updatedBy: text("updated_by").notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [unique("uq_oracle_profile_assessment").on(t.applicationId, t.instanceId, t.profileName)],
)
