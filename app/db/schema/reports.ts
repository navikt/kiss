import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"

export const reports = pgTable("reports", {
	id: uuid("id").primaryKey().defaultRandom(),
	name: text("name").notNull(),
	reportType: text("report_type").notNull(),
	scope: text("scope").notNull(),
	scopeId: uuid("scope_id"),
	snapshotBucketPath: text("snapshot_bucket_path").notNull(),
	reportBucketPath: text("report_bucket_path"),
	appVersion: text("app_version").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	createdBy: text("created_by").notNull(),
})
