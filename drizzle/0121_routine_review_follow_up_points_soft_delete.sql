ALTER TABLE "routine_review_follow_up_points" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;
ALTER TABLE "routine_review_follow_up_points" ADD COLUMN IF NOT EXISTS "archived_by" text;
