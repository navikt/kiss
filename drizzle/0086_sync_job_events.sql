CREATE TABLE IF NOT EXISTS "sync_job_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sync_job_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"message" text,
	"metadata" jsonb,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'sync_job_events_event_type_check'
	) THEN
		ALTER TABLE "sync_job_events"
		ADD CONSTRAINT "sync_job_events_event_type_check"
		CHECK ("event_type" IN ('job_created', 'job_started', 'job_step_completed', 'job_warning', 'job_failed', 'job_completed'));
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'fk_sync_job_events_sync_job_id'
	) THEN
		ALTER TABLE "sync_job_events"
		ADD CONSTRAINT "fk_sync_job_events_sync_job_id"
		FOREIGN KEY ("sync_job_id") REFERENCES "sync_jobs"("id") ON DELETE CASCADE;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sync_job_events_job_created_at_idx"
	ON "sync_job_events" USING btree ("sync_job_id", "created_at" DESC NULLS LAST, "id" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sync_job_events_job_event_type_created_at_idx"
	ON "sync_job_events" USING btree ("sync_job_id", "event_type", "created_at" DESC NULLS LAST, "id" DESC);
