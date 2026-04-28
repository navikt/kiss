-- Fix: make unique constraint on application_controls treat NULLs as equal.
-- Without this, concurrent syncs can insert duplicate (appId, controlId, NULL) rows
-- because PostgreSQL's default UNIQUE treats NULLs as distinct values.
ALTER TABLE "application_controls" DROP CONSTRAINT IF EXISTS "uq_app_control";
ALTER TABLE "application_controls" ADD CONSTRAINT "uq_app_control" UNIQUE NULLS NOT DISTINCT ("application_id", "control_id", "technology_element_id");
