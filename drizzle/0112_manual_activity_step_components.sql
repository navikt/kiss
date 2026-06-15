-- Add step_components JSONB column to routine_activity_links for configuring
-- which UI components (lenker, vedlegg) are included per manual activity step.
ALTER TABLE "routine_activity_links" ADD COLUMN IF NOT EXISTS "step_components" jsonb;
