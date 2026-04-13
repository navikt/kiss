ALTER TABLE "screening_questions" ADD COLUMN "ruleset_id" uuid;
ALTER TABLE "screening_questions" ADD CONSTRAINT "screening_questions_ruleset_id_rulesets_id_fk" FOREIGN KEY ("ruleset_id") REFERENCES "public"."rulesets"("id") ON DELETE set null ON UPDATE no action;
