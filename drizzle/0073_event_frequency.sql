-- Allow routines to be event-based only (no periodic frequency)
ALTER TABLE "routines" ALTER COLUMN "frequency" DROP NOT NULL;

-- Event-based frequency text (e.g. "Ved behov", "Ved endring")
ALTER TABLE "routines" ADD COLUMN IF NOT EXISTS "event_frequency" TEXT;

-- At least one frequency type must be set (drop first if exists for idempotency)
ALTER TABLE "routines" DROP CONSTRAINT IF EXISTS "at_least_one_frequency";
ALTER TABLE "routines" ADD CONSTRAINT "at_least_one_frequency"
  CHECK (frequency IS NOT NULL OR (event_frequency IS NOT NULL AND btrim(event_frequency) <> ''));

-- Restrict frequency to known periodic values used in deadline calculation
ALTER TABLE "routines" DROP CONSTRAINT IF EXISTS "frequency_not_blank";
ALTER TABLE "routines" DROP CONSTRAINT IF EXISTS "frequency_valid_value";
ALTER TABLE "routines" ADD CONSTRAINT "frequency_valid_value"
  CHECK (frequency IS NULL OR frequency IN ('weekly', 'monthly', 'quarterly', 'tertially', 'semi_annually', 'annually'));

-- Ensure event_frequency is either NULL or non-whitespace (no blank values)
ALTER TABLE "routines" DROP CONSTRAINT IF EXISTS "event_frequency_not_blank";
ALTER TABLE "routines" ADD CONSTRAINT "event_frequency_not_blank"
  CHECK (event_frequency IS NULL OR btrim(event_frequency) <> '');
