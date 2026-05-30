import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"

export const reportStatusEnum = ["pending", "running", "completed", "failed"] as const
export type ReportStatus = (typeof reportStatusEnum)[number]

export const reports = pgTable("reports", {
	id: uuid("id").primaryKey().defaultRandom(),
	name: text("name").notNull(),
	reportType: text("report_type").notNull(),
	scope: text("scope").notNull(),
	scopeId: uuid("scope_id"),
	/** Nullable for batch reports that have no JSON snapshot */
	snapshotBucketPath: text("snapshot_bucket_path"),
	reportBucketPath: text("report_bucket_path"),
	appVersion: text("app_version").notNull(),
	status: text("status", { enum: reportStatusEnum }).$type<ReportStatus>().notNull().default("completed"),
	progressMessage: text("progress_message"),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	createdBy: text("created_by").notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true }),
})
