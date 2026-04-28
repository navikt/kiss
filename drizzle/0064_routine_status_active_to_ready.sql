-- Rename routine status 'active' to 'ready'.
-- 'active' was confusing because it implied the routine was in use,
-- while it actually meant "ready for approval". 'ready' clearly
-- communicates that the routine is complete and awaiting formal approval.
--
-- Also change the default from 'active' to 'draft' so newly created
-- routines start as drafts that must be explicitly marked as ready.

UPDATE "routines" SET "status" = 'ready' WHERE "status" = 'active';
ALTER TABLE "routines" ALTER COLUMN "status" SET DEFAULT 'draft';
