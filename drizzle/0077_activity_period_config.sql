-- Add period_config column to routine_review_activities
-- Used by evidence providers that require period selection (e.g., NDA audit reports)
ALTER TABLE "routine_review_activities" ADD COLUMN IF NOT EXISTS "period_config" jsonb;
