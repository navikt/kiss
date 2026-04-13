-- Add persistence type and data classification columns to routines
ALTER TABLE "routines" ADD COLUMN "persistence_type" text;
ALTER TABLE "routines" ADD COLUMN "data_classification" text;
