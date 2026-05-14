import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"

export const syncJobStateEnum = ["pending", "running", "completed", "failed", "skipped"] as const
export type SyncJobState = (typeof syncJobStateEnum)[number]

export const syncJobs = pgTable(
	"sync_jobs",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		jobType: text("job_type").notNull(),
		scopeType: text("scope_type"),
		scopeId: text("scope_id"),
		state: text("state", { enum: syncJobStateEnum }).$type<SyncJobState>().notNull(),
		message: text("message"),
		result: jsonb("result").$type<Record<string, unknown> | null>(),
		error: text("error"),
		startedAt: timestamp("started_at", { withTimezone: true }),
		finishedAt: timestamp("finished_at", { withTimezone: true }),
		createdBy: text("created_by").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedBy: text("updated_by").notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		index("sync_jobs_created_at_idx").on(t.createdAt.desc()),
		index("sync_jobs_type_created_at_idx").on(t.jobType, t.createdAt.desc()),
	],
)
