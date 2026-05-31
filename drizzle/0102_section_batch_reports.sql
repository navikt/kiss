-- Section-level batch reports:
-- 1. Make snapshot_bucket_path nullable (batch reports have no JSON snapshot)
-- 2. Add status column for async background generation tracking
-- 3. Add progress_message for user-facing generation feedback
-- 4. Add updated_at for tracking status changes

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'reports'
      AND column_name = 'snapshot_bucket_path'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE "reports" ALTER COLUMN "snapshot_bucket_path" DROP NOT NULL;
  END IF;
END $$;

ALTER TABLE "reports"
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'completed';

ALTER TABLE "reports"
  ADD COLUMN IF NOT EXISTS "progress_message" TEXT;

ALTER TABLE "reports"
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ;
