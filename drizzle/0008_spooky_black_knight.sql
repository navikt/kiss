ALTER TABLE "rulesets" DROP CONSTRAINT "rulesets_code_unique";--> statement-breakpoint
ALTER TABLE "rulesets" ALTER COLUMN "code" DROP NOT NULL;