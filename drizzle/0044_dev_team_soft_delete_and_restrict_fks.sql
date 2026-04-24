-- Soft-delete (arkivering) av dev_teams + ON DELETE RESTRICT på alle FK-er
-- som peker til dev_teams.id. Etter migrasjonen er det fysisk umulig å slette
-- et dev-team så lenge det finnes data som refererer til det. Sletting
-- erstattes av arkivering (archived_at / archived_by).
--
-- Samme mønster som migrasjon 0040 (sections), 0041 (monitored_applications),
-- 0042 (routines) og 0043 (screening). Idempotens er sikret via
-- IF NOT EXISTS / IF EXISTS, og NOT VALID + VALIDATE-mønsteret matcher
-- Drizzles standard-output for FK-konvertering.
--
-- FK-er som konverteres:
--   - nais_teams.dev_team_id (no action -> restrict)
--   - application_team_mappings.dev_team_id (no action -> restrict)
--   - user_roles.dev_team_id (no action -> restrict)
--   - dev_team_nais_team_mappings.dev_team_id (cascade -> restrict)
--
-- Cascade-til-restrict-konverteringen for dev_team_nais_team_mappings betyr
-- at en nais-team-kobling fra UI-en må eksplisitt fjernes (eller teamet må
-- arkiveres) før raden kan ryddes opp; dette er ønsket adferd siden vi nå
-- styrer livssyklusen via arkivering.

-- ── Nye kolonner ────────────────────────────────────────────────────────
ALTER TABLE "dev_teams" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "dev_teams" ADD COLUMN IF NOT EXISTS "archived_by" text;
--> statement-breakpoint

-- ── FK-er fra nais_teams ────────────────────────────────────────────────
ALTER TABLE "nais_teams" DROP CONSTRAINT IF EXISTS "nais_teams_dev_team_id_fkey";
--> statement-breakpoint
ALTER TABLE "nais_teams" DROP CONSTRAINT IF EXISTS "nais_teams_dev_team_id_dev_teams_id_fk";
--> statement-breakpoint
ALTER TABLE "nais_teams" ADD CONSTRAINT "nais_teams_dev_team_id_dev_teams_id_fk"
	FOREIGN KEY ("dev_team_id") REFERENCES "public"."dev_teams"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "nais_teams" VALIDATE CONSTRAINT "nais_teams_dev_team_id_dev_teams_id_fk";
--> statement-breakpoint

-- ── FK-er fra application_team_mappings ─────────────────────────────────
ALTER TABLE "application_team_mappings" DROP CONSTRAINT IF EXISTS "application_team_mappings_dev_team_id_fkey";
--> statement-breakpoint
ALTER TABLE "application_team_mappings" DROP CONSTRAINT IF EXISTS "application_team_mappings_dev_team_id_dev_teams_id_fk";
--> statement-breakpoint
ALTER TABLE "application_team_mappings" ADD CONSTRAINT "application_team_mappings_dev_team_id_dev_teams_id_fk"
	FOREIGN KEY ("dev_team_id") REFERENCES "public"."dev_teams"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "application_team_mappings" VALIDATE CONSTRAINT "application_team_mappings_dev_team_id_dev_teams_id_fk";
--> statement-breakpoint

-- ── FK-er fra user_roles ────────────────────────────────────────────────
ALTER TABLE "user_roles" DROP CONSTRAINT IF EXISTS "user_roles_dev_team_id_fkey";
--> statement-breakpoint
ALTER TABLE "user_roles" DROP CONSTRAINT IF EXISTS "user_roles_dev_team_id_dev_teams_id_fk";
--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_dev_team_id_dev_teams_id_fk"
	FOREIGN KEY ("dev_team_id") REFERENCES "public"."dev_teams"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "user_roles" VALIDATE CONSTRAINT "user_roles_dev_team_id_dev_teams_id_fk";
--> statement-breakpoint

-- ── FK-er fra dev_team_nais_team_mappings (cascade -> restrict) ────────
ALTER TABLE "dev_team_nais_team_mappings" DROP CONSTRAINT IF EXISTS "dev_team_nais_team_mappings_dev_team_id_fkey";
--> statement-breakpoint
ALTER TABLE "dev_team_nais_team_mappings" DROP CONSTRAINT IF EXISTS "dev_team_nais_team_mappings_dev_team_id_dev_teams_id_fk";
--> statement-breakpoint
ALTER TABLE "dev_team_nais_team_mappings" ADD CONSTRAINT "dev_team_nais_team_mappings_dev_team_id_dev_teams_id_fk"
	FOREIGN KEY ("dev_team_id") REFERENCES "public"."dev_teams"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "dev_team_nais_team_mappings" VALIDATE CONSTRAINT "dev_team_nais_team_mappings_dev_team_id_dev_teams_id_fk";
