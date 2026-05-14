ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "sync_job_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'fk_audit_log_sync_job_id'
	) THEN
		ALTER TABLE "audit_log"
		ADD CONSTRAINT "fk_audit_log_sync_job_id"
		FOREIGN KEY ("sync_job_id") REFERENCES "sync_jobs"("id") ON DELETE SET NULL;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_audit_log_sync_job_id" ON "audit_log" USING btree ("sync_job_id", "performed_at" DESC NULLS LAST);
