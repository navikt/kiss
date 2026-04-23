-- Soft-delete for rutiner: nye archived_at/archived_by-kolonner, og alle FK-er
-- som peker til routines.id konverteres fra ON DELETE CASCADE til
-- ON DELETE RESTRICT slik at fysisk DELETE blir umulig så lenge en rutine
-- har konfig-koblinger eller historikk.
--
-- Samme mønster som migrasjon 0040 (sections) og 0041 (monitored_applications).
-- Backfill: alle rader som allerede har status='deleted' får archived_at +
-- archived_by satt fra updated_at/updated_by, slik at det nye filteret
-- isNull(archived_at) fanger gammel "soft-deleted"-data.
--
-- Migrasjonen er idempotent (IF NOT EXISTS / IF EXISTS) og bruker
-- ADD CONSTRAINT ... NOT VALID + VALIDATE CONSTRAINT for å minimere
-- lock-tid (se 0040-kommentaren for forbehold under Drizzle-batch-tx).

-- ── Nye kolonner ────────────────────────────────────────────────────────
ALTER TABLE "routines" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "routines" ADD COLUMN IF NOT EXISTS "archived_by" text;
--> statement-breakpoint

-- ── Backfill: legacy soft-deletes (status='deleted') ────────────────────
UPDATE "routines"
SET archived_at = COALESCE(archived_at, updated_at),
    archived_by = COALESCE(archived_by, updated_by)
WHERE status = 'deleted' AND archived_at IS NULL;
--> statement-breakpoint

-- ── FK-er fra rutine-konfig-tabeller (cascade -> restrict) ──────────────
-- NB: noen tabeller ble opprettet med inline-FK (Postgres-default-navn
-- "<tabell>_<kolonne>_fkey") eller med eksplisitt eldre navn. Vi dropper
-- alle kjente varianter for å unngå at gammel CASCADE-FK overlever som
-- en duplikat ved siden av den nye RESTRICT-FK-en.

-- routine_persistence_links: inline FK i 0021 → default Postgres-navn ..._fkey
ALTER TABLE "routine_persistence_links" DROP CONSTRAINT IF EXISTS "routine_persistence_links_routine_id_fkey";
--> statement-breakpoint
ALTER TABLE "routine_persistence_links" DROP CONSTRAINT IF EXISTS "routine_persistence_links_routine_id_routines_id_fk";
--> statement-breakpoint
ALTER TABLE "routine_persistence_links" ADD CONSTRAINT "routine_persistence_links_routine_id_routines_id_fk"
	FOREIGN KEY ("routine_id") REFERENCES "public"."routines"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "routine_persistence_links" VALIDATE CONSTRAINT "routine_persistence_links_routine_id_routines_id_fk";
--> statement-breakpoint

-- routine_group_classification_links: eksplisitt eldre navn fra 0035 (uten "_routines_id_")
ALTER TABLE "routine_group_classification_links" DROP CONSTRAINT IF EXISTS "routine_group_classification_links_routine_id_fk";
--> statement-breakpoint
ALTER TABLE "routine_group_classification_links" DROP CONSTRAINT IF EXISTS "routine_group_classification_links_routine_id_routines_id_fk";
--> statement-breakpoint
ALTER TABLE "routine_group_classification_links" ADD CONSTRAINT "routine_group_classification_links_routine_id_routines_id_fk"
	FOREIGN KEY ("routine_id") REFERENCES "public"."routines"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "routine_group_classification_links" VALIDATE CONSTRAINT "routine_group_classification_links_routine_id_routines_id_fk";
--> statement-breakpoint

ALTER TABLE "routine_oracle_role_criticality_links" DROP CONSTRAINT IF EXISTS "routine_oracle_role_criticality_links_routine_id_routines_id_fk";
--> statement-breakpoint
ALTER TABLE "routine_oracle_role_criticality_links" ADD CONSTRAINT "routine_oracle_role_criticality_links_routine_id_routines_id_fk"
	FOREIGN KEY ("routine_id") REFERENCES "public"."routines"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "routine_oracle_role_criticality_links" VALIDATE CONSTRAINT "routine_oracle_role_criticality_links_routine_id_routines_id_fk";
--> statement-breakpoint

ALTER TABLE "routine_screening_questions" DROP CONSTRAINT IF EXISTS "routine_screening_questions_routine_id_routines_id_fk";
--> statement-breakpoint
ALTER TABLE "routine_screening_questions" ADD CONSTRAINT "routine_screening_questions_routine_id_routines_id_fk"
	FOREIGN KEY ("routine_id") REFERENCES "public"."routines"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "routine_screening_questions" VALIDATE CONSTRAINT "routine_screening_questions_routine_id_routines_id_fk";
--> statement-breakpoint

ALTER TABLE "routine_controls" DROP CONSTRAINT IF EXISTS "routine_controls_routine_id_routines_id_fk";
--> statement-breakpoint
ALTER TABLE "routine_controls" ADD CONSTRAINT "routine_controls_routine_id_routines_id_fk"
	FOREIGN KEY ("routine_id") REFERENCES "public"."routines"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "routine_controls" VALIDATE CONSTRAINT "routine_controls_routine_id_routines_id_fk";
--> statement-breakpoint

ALTER TABLE "routine_technology_elements" DROP CONSTRAINT IF EXISTS "routine_technology_elements_routine_id_routines_id_fk";
--> statement-breakpoint
ALTER TABLE "routine_technology_elements" ADD CONSTRAINT "routine_technology_elements_routine_id_routines_id_fk"
	FOREIGN KEY ("routine_id") REFERENCES "public"."routines"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "routine_technology_elements" VALIDATE CONSTRAINT "routine_technology_elements_routine_id_routines_id_fk";
--> statement-breakpoint

-- routine_reviews er rutinens historikk — RESTRICT for å bevare audit-trail
ALTER TABLE "routine_reviews" DROP CONSTRAINT IF EXISTS "routine_reviews_routine_id_routines_id_fk";
--> statement-breakpoint
ALTER TABLE "routine_reviews" ADD CONSTRAINT "routine_reviews_routine_id_routines_id_fk"
	FOREIGN KEY ("routine_id") REFERENCES "public"."routines"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "routine_reviews" VALIDATE CONSTRAINT "routine_reviews_routine_id_routines_id_fk";
--> statement-breakpoint

-- ruleset_routines.routine_id må også bli RESTRICT — ellers kan en cascade
-- via ruleset eller direkte DELETE av routine slette ruleset-koblingen og
-- omgå soft-delete-garantien.
ALTER TABLE "ruleset_routines" DROP CONSTRAINT IF EXISTS "ruleset_routines_routine_id_routines_id_fk";
--> statement-breakpoint
ALTER TABLE "ruleset_routines" ADD CONSTRAINT "ruleset_routines_routine_id_routines_id_fk"
	FOREIGN KEY ("routine_id") REFERENCES "public"."routines"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "ruleset_routines" VALIDATE CONSTRAINT "ruleset_routines_routine_id_routines_id_fk";
