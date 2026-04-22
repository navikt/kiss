-- Soft-delete (arkivering) av seksjoner + ON DELETE RESTRICT på alle FK-er som
-- peker til sections.id. Etter denne migrasjonen er det fysisk umulig å slette
-- en seksjon så lenge det finnes data som refererer til den. Sletting erstattes
-- av arkivering (archived_at / archived_by).
--
-- Locking: drizzle-orm wrapper hele migrasjonsbatchen i én transaksjon, så
-- ACCESS EXCLUSIVE-låsene fra DROP/ADD CONSTRAINT holdes til migrasjonen
-- committer. NOT VALID + VALIDATE-mønsteret gir derfor ingen lock-fordel her
-- (VALIDATE gjør samme full-table-scan som en vanlig ADD CONSTRAINT ville
-- gjort, og lock-downgraden til SHARE UPDATE EXCLUSIVE forsvinner siden
-- DROP/ADD allerede holder ACCESS EXCLUSIVE for resten av transaksjonen).
-- Mønsteret er beholdt fordi det matcher Drizzles standard-output, og fordi
-- VALIDATE eksplisitt bekrefter at constrainten gjelder eksisterende rader.
-- På store tabeller bør migrasjonen kjøres i et lavt-traffikk-vindu.
--
-- Idempotens: ADD COLUMN IF NOT EXISTS / DROP CONSTRAINT IF EXISTS gjør at
-- migrasjonen kan re-applies trygt på databaser som allerede har fått
-- skjemaendringen via db:push (testes av migrations.integration.test.ts).

ALTER TABLE "sections" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "sections" ADD COLUMN IF NOT EXISTS "archived_by" text;
--> statement-breakpoint

-- clusters.section_id (no action -> restrict)
ALTER TABLE "clusters" DROP CONSTRAINT IF EXISTS "clusters_section_id_sections_id_fk";
--> statement-breakpoint
ALTER TABLE "clusters" ADD CONSTRAINT "clusters_section_id_sections_id_fk"
	FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "clusters" VALIDATE CONSTRAINT "clusters_section_id_sections_id_fk";
--> statement-breakpoint

-- dev_teams.section_id (no action -> restrict)
ALTER TABLE "dev_teams" DROP CONSTRAINT IF EXISTS "dev_teams_section_id_sections_id_fk";
--> statement-breakpoint
ALTER TABLE "dev_teams" ADD CONSTRAINT "dev_teams_section_id_sections_id_fk"
	FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "dev_teams" VALIDATE CONSTRAINT "dev_teams_section_id_sections_id_fk";
--> statement-breakpoint

-- user_roles.section_id (no action -> restrict)
ALTER TABLE "user_roles" DROP CONSTRAINT IF EXISTS "user_roles_section_id_sections_id_fk";
--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_section_id_sections_id_fk"
	FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "user_roles" VALIDATE CONSTRAINT "user_roles_section_id_sections_id_fk";
--> statement-breakpoint

-- nais_teams.section_id (no action -> restrict)
ALTER TABLE "nais_teams" DROP CONSTRAINT IF EXISTS "nais_teams_section_id_sections_id_fk";
--> statement-breakpoint
ALTER TABLE "nais_teams" ADD CONSTRAINT "nais_teams_section_id_sections_id_fk"
	FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "nais_teams" VALIDATE CONSTRAINT "nais_teams_section_id_sections_id_fk";
--> statement-breakpoint

-- section_ignored_applications.section_id (no action -> restrict)
ALTER TABLE "section_ignored_applications" DROP CONSTRAINT IF EXISTS "section_ignored_applications_section_id_sections_id_fk";
--> statement-breakpoint
ALTER TABLE "section_ignored_applications" ADD CONSTRAINT "section_ignored_applications_section_id_sections_id_fk"
	FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "section_ignored_applications" VALIDATE CONSTRAINT "section_ignored_applications_section_id_sections_id_fk";
--> statement-breakpoint

-- routines.section_id (cascade -> restrict)
ALTER TABLE "routines" DROP CONSTRAINT IF EXISTS "routines_section_id_sections_id_fk";
--> statement-breakpoint
ALTER TABLE "routines" ADD CONSTRAINT "routines_section_id_sections_id_fk"
	FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "routines" VALIDATE CONSTRAINT "routines_section_id_sections_id_fk";
--> statement-breakpoint

-- screening_questions.section_id (cascade -> restrict)
ALTER TABLE "screening_questions" DROP CONSTRAINT IF EXISTS "screening_questions_section_id_sections_id_fk";
--> statement-breakpoint
ALTER TABLE "screening_questions" ADD CONSTRAINT "screening_questions_section_id_sections_id_fk"
	FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "screening_questions" VALIDATE CONSTRAINT "screening_questions_section_id_sections_id_fk";
--> statement-breakpoint

-- rulesets.section_id (cascade -> restrict)
ALTER TABLE "rulesets" DROP CONSTRAINT IF EXISTS "rulesets_section_id_sections_id_fk";
--> statement-breakpoint
ALTER TABLE "rulesets" ADD CONSTRAINT "rulesets_section_id_sections_id_fk"
	FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "rulesets" VALIDATE CONSTRAINT "rulesets_section_id_sections_id_fk";
--> statement-breakpoint

-- section_environments.section_id (cascade -> restrict)
ALTER TABLE "section_environments" DROP CONSTRAINT IF EXISTS "section_environments_section_id_sections_id_fk";
--> statement-breakpoint
ALTER TABLE "section_environments" ADD CONSTRAINT "section_environments_section_id_sections_id_fk"
	FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "section_environments" VALIDATE CONSTRAINT "section_environments_section_id_sections_id_fk";
