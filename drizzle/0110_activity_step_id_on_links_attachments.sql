ALTER TABLE "routine_review_attachments" ADD COLUMN IF NOT EXISTS "activity_step_id" text;
ALTER TABLE "routine_review_links" ADD COLUMN IF NOT EXISTS "activity_step_id" text;
