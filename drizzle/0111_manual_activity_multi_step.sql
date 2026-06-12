-- Allow multiple manual_activity entries per routine in activity links
DROP INDEX IF EXISTS "routine_activity_links_active_unique_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "routine_activity_links_active_unique_idx"
  ON "routine_activity_links"("routine_id", "activity_type")
  WHERE "archived_at" IS NULL AND "activity_type" != 'manual_activity';

-- Add step title and description columns to activity links (used by manual_activity items)
ALTER TABLE "routine_activity_links" ADD COLUMN IF NOT EXISTS "step_title" text;
ALTER TABLE "routine_activity_links" ADD COLUMN IF NOT EXISTS "step_description" text;

-- Allow multiple manual_activity entries per review in review activities
DROP INDEX IF EXISTS "review_activities_review_type_unique_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "review_activities_review_type_unique_idx"
  ON "routine_review_activities"("review_id", "type")
  WHERE "type" != 'manual_activity';
