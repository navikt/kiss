-- Add data classification and manually_added columns to application_persistence
ALTER TABLE "application_persistence" ADD COLUMN "data_classification" text;
ALTER TABLE "application_persistence" ADD COLUMN "manually_added" boolean NOT NULL DEFAULT false;
