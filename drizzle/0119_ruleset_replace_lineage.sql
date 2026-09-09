ALTER TABLE "rulesets" ADD COLUMN IF NOT EXISTS "source_ruleset_id" uuid;
ALTER TABLE "rulesets" ADD COLUMN IF NOT EXISTS "replaced_by_ruleset_id" uuid;
ALTER TABLE "rulesets" ADD COLUMN IF NOT EXISTS "replaced_at" timestamp with time zone;
