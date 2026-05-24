ALTER TABLE "routine_review_activities"
  ADD COLUMN IF NOT EXISTS "staged_data" jsonb;
