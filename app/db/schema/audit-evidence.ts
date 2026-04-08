import { boolean, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core"
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
	excelBucketPath: text("excel_bucket_path"),
})

// ─── Audit Evidence Sections ─────────────────────────────────────────────

export const auditEvidenceSections = pgTable("audit_evidence_sections", {
	id: uuid("id").primaryKey().defaultRandom(),
	snapshotId: uuid("snapshot_id")
		.notNull()
		.references(() => auditEvidenceSnapshots.id),
	sectionId: text("section_id").notNull(),
	title: text("title").notNull(),
	description: text("description"),
	summary: text("summary"),
	error: text("error"),
	resultJson: jsonb("result_json"),
})
