ALTER TABLE routine_review_activities
ADD COLUMN IF NOT EXISTS provider_config jsonb;
