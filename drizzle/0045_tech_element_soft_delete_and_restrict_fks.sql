-- Soft-delete (arkivering) av technology_elements + ON DELETE RESTRICT på alle
-- FK-er som peker til technology_elements.id. Etter migrasjonen er det fysisk
-- umulig å slette et teknologielement så lenge det finnes data som refererer
-- til det. Sletting erstattes av arkivering (archived_at / archived_by).
--
-- Samme mønster som migrasjon 0040 (sections), 0041 (monitored_applications),
-- 0042 (routines), 0043 (screening) og 0044 (dev_teams). Idempotens er sikret
-- via IF NOT EXISTS / IF EXISTS, og NOT VALID + VALIDATE-mønsteret matcher
-- Drizzles standard-output for FK-konvertering.
--
-- FK-er som konverteres (alle var cascade):
--   - control_technology_elements.element_id (cascade -> restrict)
--   - application_technology_elements.element_id (cascade -> restrict)
--   - routine_technology_elements.element_id (cascade -> restrict)
--   - screening_question_technology_elements.element_id (cascade -> restrict)
--   - application_controls.technology_element_id (cascade -> restrict, nullable)
--   - compliance_assessments.technology_element_id (no action -> restrict, nullable)
--
-- Cascade-til-restrict-konverteringen betyr at koblingsrader (control-element,
-- application-element osv.) må eksplisitt fjernes (eller elementet må arkiveres)
-- før raden kan ryddes opp; dette er ønsket adferd siden vi nå styrer
-- livssyklusen via arkivering.

-- ── Nye kolonner ────────────────────────────────────────────────────────
ALTER TABLE "technology_elements" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "technology_elements" ADD COLUMN IF NOT EXISTS "archived_by" text;
--> statement-breakpoint

-- ── FK-er fra control_technology_elements ───────────────────────────────
ALTER TABLE "control_technology_elements" DROP CONSTRAINT IF EXISTS "control_technology_elements_element_id_fkey";
--> statement-breakpoint
ALTER TABLE "control_technology_elements" DROP CONSTRAINT IF EXISTS "control_technology_elements_element_id_technology_elements_id_fk";
--> statement-breakpoint
ALTER TABLE "control_technology_elements" ADD CONSTRAINT "control_technology_elements_element_id_technology_elements_id_fk"
	FOREIGN KEY ("element_id") REFERENCES "public"."technology_elements"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "control_technology_elements" VALIDATE CONSTRAINT "control_technology_elements_element_id_technology_elements_id_fk";
--> statement-breakpoint

-- ── FK-er fra application_technology_elements ──────────────────────────
ALTER TABLE "application_technology_elements" DROP CONSTRAINT IF EXISTS "application_technology_elements_element_id_fkey";
--> statement-breakpoint
ALTER TABLE "application_technology_elements" DROP CONSTRAINT IF EXISTS "application_technology_elements_element_id_technology_elements_id_fk";
--> statement-breakpoint
ALTER TABLE "application_technology_elements" ADD CONSTRAINT "application_technology_elements_element_id_technology_elements_id_fk"
	FOREIGN KEY ("element_id") REFERENCES "public"."technology_elements"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "application_technology_elements" VALIDATE CONSTRAINT "application_technology_elements_element_id_technology_elements_id_fk";
--> statement-breakpoint

-- ── FK-er fra routine_technology_elements ──────────────────────────────
ALTER TABLE "routine_technology_elements" DROP CONSTRAINT IF EXISTS "routine_technology_elements_element_id_fkey";
--> statement-breakpoint
ALTER TABLE "routine_technology_elements" DROP CONSTRAINT IF EXISTS "routine_technology_elements_element_id_technology_elements_id_fk";
--> statement-breakpoint
ALTER TABLE "routine_technology_elements" ADD CONSTRAINT "routine_technology_elements_element_id_technology_elements_id_fk"
	FOREIGN KEY ("element_id") REFERENCES "public"."technology_elements"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "routine_technology_elements" VALIDATE CONSTRAINT "routine_technology_elements_element_id_technology_elements_id_fk";
--> statement-breakpoint

-- ── FK-er fra screening_question_technology_elements ───────────────────
ALTER TABLE "screening_question_technology_elements" DROP CONSTRAINT IF EXISTS "screening_question_technology_elements_element_id_fkey";
--> statement-breakpoint
ALTER TABLE "screening_question_technology_elements" DROP CONSTRAINT IF EXISTS "screening_question_technology_elements_element_id_technology_elements_id_fk";
--> statement-breakpoint
ALTER TABLE "screening_question_technology_elements" ADD CONSTRAINT "screening_question_technology_elements_element_id_technology_elements_id_fk"
	FOREIGN KEY ("element_id") REFERENCES "public"."technology_elements"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "screening_question_technology_elements" VALIDATE CONSTRAINT "screening_question_technology_elements_element_id_technology_elements_id_fk";
--> statement-breakpoint

-- ── FK-er fra application_controls (nullable) ──────────────────────────
ALTER TABLE "application_controls" DROP CONSTRAINT IF EXISTS "application_controls_technology_element_id_fkey";
--> statement-breakpoint
ALTER TABLE "application_controls" DROP CONSTRAINT IF EXISTS "application_controls_technology_element_id_technology_elements_id_fk";
--> statement-breakpoint
ALTER TABLE "application_controls" ADD CONSTRAINT "application_controls_technology_element_id_technology_elements_id_fk"
	FOREIGN KEY ("technology_element_id") REFERENCES "public"."technology_elements"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "application_controls" VALIDATE CONSTRAINT "application_controls_technology_element_id_technology_elements_id_fk";
--> statement-breakpoint

-- ── FK-er fra compliance_assessments (DEPRECATED, men styrkes for konsistens) ──
ALTER TABLE "compliance_assessments" DROP CONSTRAINT IF EXISTS "compliance_assessments_technology_element_id_fkey";
--> statement-breakpoint
ALTER TABLE "compliance_assessments" DROP CONSTRAINT IF EXISTS "compliance_assessments_technology_element_id_technology_elements_id_fk";
--> statement-breakpoint
ALTER TABLE "compliance_assessments" ADD CONSTRAINT "compliance_assessments_technology_element_id_technology_elements_id_fk"
	FOREIGN KEY ("technology_element_id") REFERENCES "public"."technology_elements"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "compliance_assessments" VALIDATE CONSTRAINT "compliance_assessments_technology_element_id_technology_elements_id_fk";
