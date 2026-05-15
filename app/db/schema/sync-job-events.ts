import { sql } from "drizzle-orm"
import { check, foreignKey, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { syncJobs } from "./sync-jobs"

export const syncJobEventTypeEnum = [
	"job_created",
	"job_started",
	"job_step_completed",
	"job_warning",
	"job_failed",
	"job_completed",
] as const
export type SyncJobEventType = (typeof syncJobEventTypeEnum)[number]

export const syncJobEvents = pgTable(
	"sync_job_events",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		syncJobId: uuid("sync_job_id").notNull(),
		eventType: text("event_type", { enum: syncJobEventTypeEnum }).$type<SyncJobEventType>().notNull(),
		message: text("message"),
		metadata: jsonb("metadata").$type<Record<string, unknown> | null>(),
		createdBy: text("created_by").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		check(
			"sync_job_events_event_type_check",
			sql`${t.eventType} IN ('job_created', 'job_started', 'job_step_completed', 'job_warning', 'job_failed', 'job_completed')`,
		),
		index("sync_job_events_job_created_at_idx").on(t.syncJobId, t.createdAt.desc(), t.id.desc()),
		index("sync_job_events_job_event_type_created_at_idx").on(
			t.syncJobId,
			t.eventType,
			t.createdAt.desc(),
			t.id.desc(),
		),
		foreignKey({
			columns: [t.syncJobId],
			foreignColumns: [syncJobs.id],
			name: "fk_sync_job_events_sync_job_id",
		}).onDelete("cascade"),
	],
)
