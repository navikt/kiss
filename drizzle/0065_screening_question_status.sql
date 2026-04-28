-- Add status column to screening_questions.
-- Uses the same workflow as routines: draft → ready → approved → archived.
-- Existing questions start as 'draft' — admin must explicitly approve them.

ALTER TABLE "screening_questions" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'draft' NOT NULL;

-- Backfill: set status='archived' for questions that have archived_at set
UPDATE "screening_questions" SET "status" = 'archived' WHERE "archived_at" IS NOT NULL;
