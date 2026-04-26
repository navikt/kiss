-- FK-konsistens på SD7 m:n-linktabeller: bytter ON DELETE CASCADE til
-- ON DELETE RESTRICT på alle linktabeller hvor barnet selv er soft-delete
-- (har archived_at). Med cascade ville en (fremtidig eller feilaktig)
-- DELETE på foreldre-tabellen slettet ALLE link-rader — inkludert de
-- arkiverte som SD7 nettopp skal bevare som historikk.
--
-- Bakgrunn: PR #50 (logisk arkivering av teknologielementer) endret
-- element_id-FK på control_technology_elements fra CASCADE til RESTRICT,
-- men control_id-FK ble oversett. Tilsvarende mønster gjentar seg på
-- routine_controls, ruleset_controls og ruleset_routines.
--
-- Berørte FK-er (alle CASCADE → RESTRICT):
--   1. control_technology_elements.control_id → framework_controls
--   2. routine_controls.control_id → framework_controls
--   3. ruleset_controls.ruleset_id → rulesets
--   4. ruleset_controls.control_id → framework_controls
--   5. ruleset_routines.ruleset_id → rulesets
--
-- Mønster: DROP CONSTRAINT IF EXISTS (idempotent ved delvis deploy / re-run)
-- + ADD CONSTRAINT NOT VALID + VALIDATE CONSTRAINT, for konsistens med
-- migrasjonene 0040–0045 (som dokumenterer at mønsteret beholdes for å
-- matche Drizzles standard-output, selv om hele migrasjonsbatchen kjører
-- i én transaksjon og NOT VALID/VALIDATE derfor ikke gir lock-fordel her).

ALTER TABLE "control_technology_elements" DROP CONSTRAINT IF EXISTS "control_technology_elements_control_id_framework_controls_id_fk";
--> statement-breakpoint
ALTER TABLE "control_technology_elements" ADD CONSTRAINT "control_technology_elements_control_id_framework_controls_id_fk"
FOREIGN KEY ("control_id") REFERENCES "public"."framework_controls"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "control_technology_elements" VALIDATE CONSTRAINT "control_technology_elements_control_id_framework_controls_id_fk";
--> statement-breakpoint

ALTER TABLE "routine_controls" DROP CONSTRAINT IF EXISTS "routine_controls_control_id_framework_controls_id_fk";
--> statement-breakpoint
ALTER TABLE "routine_controls" ADD CONSTRAINT "routine_controls_control_id_framework_controls_id_fk"
FOREIGN KEY ("control_id") REFERENCES "public"."framework_controls"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "routine_controls" VALIDATE CONSTRAINT "routine_controls_control_id_framework_controls_id_fk";
--> statement-breakpoint

ALTER TABLE "ruleset_controls" DROP CONSTRAINT IF EXISTS "ruleset_controls_ruleset_id_rulesets_id_fk";
--> statement-breakpoint
ALTER TABLE "ruleset_controls" ADD CONSTRAINT "ruleset_controls_ruleset_id_rulesets_id_fk"
FOREIGN KEY ("ruleset_id") REFERENCES "public"."rulesets"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "ruleset_controls" VALIDATE CONSTRAINT "ruleset_controls_ruleset_id_rulesets_id_fk";
--> statement-breakpoint

ALTER TABLE "ruleset_controls" DROP CONSTRAINT IF EXISTS "ruleset_controls_control_id_framework_controls_id_fk";
--> statement-breakpoint
ALTER TABLE "ruleset_controls" ADD CONSTRAINT "ruleset_controls_control_id_framework_controls_id_fk"
FOREIGN KEY ("control_id") REFERENCES "public"."framework_controls"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "ruleset_controls" VALIDATE CONSTRAINT "ruleset_controls_control_id_framework_controls_id_fk";
--> statement-breakpoint

ALTER TABLE "ruleset_routines" DROP CONSTRAINT IF EXISTS "ruleset_routines_ruleset_id_rulesets_id_fk";
--> statement-breakpoint
ALTER TABLE "ruleset_routines" ADD CONSTRAINT "ruleset_routines_ruleset_id_rulesets_id_fk"
FOREIGN KEY ("ruleset_id") REFERENCES "public"."rulesets"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "ruleset_routines" VALIDATE CONSTRAINT "ruleset_routines_ruleset_id_rulesets_id_fk";
