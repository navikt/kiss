ALTER TABLE "rulesets" ADD COLUMN IF NOT EXISTS "category" TEXT;
ALTER TABLE "screening_questions" ADD COLUMN IF NOT EXISTS "ruleset_category_filter" TEXT;
