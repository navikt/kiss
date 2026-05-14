CREATE TABLE IF NOT EXISTS "sync_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_type" text NOT NULL,
	"scope_type" text,
	"scope_id" text,
	"state" text NOT NULL,
	"message" text,
	"result" jsonb,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'sync_jobs_state_check'
	) THEN
		ALTER TABLE "sync_jobs"
		ADD CONSTRAINT "sync_jobs_state_check"
		CHECK ("state" IN ('pending', 'running', 'completed', 'failed', 'skipped'));
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sync_jobs_created_at_idx" ON "sync_jobs" USING btree ("created_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sync_jobs_type_created_at_idx" ON "sync_jobs" USING btree ("job_type", "created_at" DESC NULLS LAST);
