-- Soft-delete (arkivering) av applikasjoner + ON DELETE RESTRICT på alle FK-er
-- som peker til monitored_applications.id. Etter denne migrasjonen er det
-- fysisk umulig å slette en applikasjon så lenge det finnes data som
-- refererer til den. Sletting erstattes av arkivering (archived_at /
-- archived_by). Dette er kritisk for AGENTS.md regel 5: data slettes aldri,
-- bare arkiveres. Tidligere deleteApplication() kaskadeslettet hele
-- compliance- og audit-historikken.
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

ALTER TABLE "monitored_applications" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "monitored_applications" ADD COLUMN IF NOT EXISTS "archived_by" text;
--> statement-breakpoint

-- application_environments.application_id (no action -> restrict)
ALTER TABLE "application_environments" DROP CONSTRAINT IF EXISTS "application_environments_application_id_monitored_applications_id_fk";
--> statement-breakpoint
ALTER TABLE "application_environments" ADD CONSTRAINT "application_environments_application_id_monitored_applications_id_fk"
	FOREIGN KEY ("application_id") REFERENCES "public"."monitored_applications"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "application_environments" VALIDATE CONSTRAINT "application_environments_application_id_monitored_applications_id_fk";
--> statement-breakpoint

-- application_team_mappings.application_id (no action -> restrict)
ALTER TABLE "application_team_mappings" DROP CONSTRAINT IF EXISTS "application_team_mappings_application_id_monitored_applications_id_fk";
--> statement-breakpoint
ALTER TABLE "application_team_mappings" ADD CONSTRAINT "application_team_mappings_application_id_monitored_applications_id_fk"
	FOREIGN KEY ("application_id") REFERENCES "public"."monitored_applications"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "application_team_mappings" VALIDATE CONSTRAINT "application_team_mappings_application_id_monitored_applications_id_fk";
--> statement-breakpoint

-- application_persistence.application_id (no action -> restrict)
ALTER TABLE "application_persistence" DROP CONSTRAINT IF EXISTS "application_persistence_application_id_monitored_applications_id_fk";
--> statement-breakpoint
ALTER TABLE "application_persistence" ADD CONSTRAINT "application_persistence_application_id_monitored_applications_id_fk"
	FOREIGN KEY ("application_id") REFERENCES "public"."monitored_applications"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "application_persistence" VALIDATE CONSTRAINT "application_persistence_application_id_monitored_applications_id_fk";
--> statement-breakpoint

-- section_ignored_applications.application_id (no action -> restrict)
ALTER TABLE "section_ignored_applications" DROP CONSTRAINT IF EXISTS "section_ignored_applications_application_id_monitored_applications_id_fk";
--> statement-breakpoint
ALTER TABLE "section_ignored_applications" ADD CONSTRAINT "section_ignored_applications_application_id_monitored_applications_id_fk"
	FOREIGN KEY ("application_id") REFERENCES "public"."monitored_applications"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "section_ignored_applications" VALIDATE CONSTRAINT "section_ignored_applications_application_id_monitored_applications_id_fk";
--> statement-breakpoint

-- link_suggestions.primary_app_id (no action -> restrict)
ALTER TABLE "link_suggestions" DROP CONSTRAINT IF EXISTS "link_suggestions_primary_app_id_monitored_applications_id_fk";
--> statement-breakpoint
ALTER TABLE "link_suggestions" ADD CONSTRAINT "link_suggestions_primary_app_id_monitored_applications_id_fk"
	FOREIGN KEY ("primary_app_id") REFERENCES "public"."monitored_applications"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "link_suggestions" VALIDATE CONSTRAINT "link_suggestions_primary_app_id_monitored_applications_id_fk";
--> statement-breakpoint

-- link_suggestions.secondary_app_id (no action -> restrict)
ALTER TABLE "link_suggestions" DROP CONSTRAINT IF EXISTS "link_suggestions_secondary_app_id_monitored_applications_id_fk";
--> statement-breakpoint
ALTER TABLE "link_suggestions" ADD CONSTRAINT "link_suggestions_secondary_app_id_monitored_applications_id_fk"
	FOREIGN KEY ("secondary_app_id") REFERENCES "public"."monitored_applications"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "link_suggestions" VALIDATE CONSTRAINT "link_suggestions_secondary_app_id_monitored_applications_id_fk";
--> statement-breakpoint

-- application_auth_integrations.application_id (no action -> restrict)
ALTER TABLE "application_auth_integrations" DROP CONSTRAINT IF EXISTS "application_auth_integrations_application_id_monitored_applications_id_fk";
--> statement-breakpoint
ALTER TABLE "application_auth_integrations" ADD CONSTRAINT "application_auth_integrations_application_id_monitored_applications_id_fk"
	FOREIGN KEY ("application_id") REFERENCES "public"."monitored_applications"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "application_auth_integrations" VALIDATE CONSTRAINT "application_auth_integrations_application_id_monitored_applications_id_fk";
--> statement-breakpoint

-- application_access_policy_rules.application_id (no action -> restrict)
ALTER TABLE "application_access_policy_rules" DROP CONSTRAINT IF EXISTS "application_access_policy_rules_application_id_monitored_applications_id_fk";
--> statement-breakpoint
ALTER TABLE "application_access_policy_rules" ADD CONSTRAINT "application_access_policy_rules_application_id_monitored_applications_id_fk"
	FOREIGN KEY ("application_id") REFERENCES "public"."monitored_applications"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "application_access_policy_rules" VALIDATE CONSTRAINT "application_access_policy_rules_application_id_monitored_applications_id_fk";
--> statement-breakpoint

-- access_policy_acknowledgments.application_id (no action -> restrict)
ALTER TABLE "access_policy_acknowledgments" DROP CONSTRAINT IF EXISTS "access_policy_acknowledgments_application_id_monitored_applications_id_fk";
--> statement-breakpoint
ALTER TABLE "access_policy_acknowledgments" ADD CONSTRAINT "access_policy_acknowledgments_application_id_monitored_applications_id_fk"
	FOREIGN KEY ("application_id") REFERENCES "public"."monitored_applications"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "access_policy_acknowledgments" VALIDATE CONSTRAINT "access_policy_acknowledgments_application_id_monitored_applications_id_fk";
--> statement-breakpoint

-- application_manual_groups.application_id (no action -> restrict)
ALTER TABLE "application_manual_groups" DROP CONSTRAINT IF EXISTS "application_manual_groups_application_id_monitored_applications_id_fk";
--> statement-breakpoint
ALTER TABLE "application_manual_groups" ADD CONSTRAINT "application_manual_groups_application_id_monitored_applications_id_fk"
	FOREIGN KEY ("application_id") REFERENCES "public"."monitored_applications"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "application_manual_groups" VALIDATE CONSTRAINT "application_manual_groups_application_id_monitored_applications_id_fk";
--> statement-breakpoint

-- application_group_assessments.application_id (no action -> restrict)
ALTER TABLE "application_group_assessments" DROP CONSTRAINT IF EXISTS "application_group_assessments_application_id_monitored_applications_id_fk";
--> statement-breakpoint
ALTER TABLE "application_group_assessments" ADD CONSTRAINT "application_group_assessments_application_id_monitored_applications_id_fk"
	FOREIGN KEY ("application_id") REFERENCES "public"."monitored_applications"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "application_group_assessments" VALIDATE CONSTRAINT "application_group_assessments_application_id_monitored_applications_id_fk";
--> statement-breakpoint

-- compliance_assessments.application_id (no action -> restrict)
ALTER TABLE "compliance_assessments" DROP CONSTRAINT IF EXISTS "compliance_assessments_application_id_monitored_applications_id_fk";
--> statement-breakpoint
ALTER TABLE "compliance_assessments" ADD CONSTRAINT "compliance_assessments_application_id_monitored_applications_id_fk"
	FOREIGN KEY ("application_id") REFERENCES "public"."monitored_applications"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "compliance_assessments" VALIDATE CONSTRAINT "compliance_assessments_application_id_monitored_applications_id_fk";
--> statement-breakpoint

-- screening_answers.application_id (no action -> restrict)
ALTER TABLE "screening_answers" DROP CONSTRAINT IF EXISTS "screening_answers_application_id_monitored_applications_id_fk";
--> statement-breakpoint
ALTER TABLE "screening_answers" ADD CONSTRAINT "screening_answers_application_id_monitored_applications_id_fk"
	FOREIGN KEY ("application_id") REFERENCES "public"."monitored_applications"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "screening_answers" VALIDATE CONSTRAINT "screening_answers_application_id_monitored_applications_id_fk";
--> statement-breakpoint

-- screening_routine_selections.application_id (no action -> restrict)
ALTER TABLE "screening_routine_selections" DROP CONSTRAINT IF EXISTS "screening_routine_selections_application_id_monitored_applications_id_fk";
--> statement-breakpoint
ALTER TABLE "screening_routine_selections" ADD CONSTRAINT "screening_routine_selections_application_id_monitored_applications_id_fk"
	FOREIGN KEY ("application_id") REFERENCES "public"."monitored_applications"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "screening_routine_selections" VALIDATE CONSTRAINT "screening_routine_selections_application_id_monitored_applications_id_fk";
--> statement-breakpoint

-- deployment_verification_summaries.application_id (no action -> restrict)
ALTER TABLE "deployment_verification_summaries" DROP CONSTRAINT IF EXISTS "deployment_verification_summaries_application_id_monitored_applications_id_fk";
--> statement-breakpoint
ALTER TABLE "deployment_verification_summaries" ADD CONSTRAINT "deployment_verification_summaries_application_id_monitored_applications_id_fk"
	FOREIGN KEY ("application_id") REFERENCES "public"."monitored_applications"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "deployment_verification_summaries" VALIDATE CONSTRAINT "deployment_verification_summaries_application_id_monitored_applications_id_fk";
--> statement-breakpoint

-- application_oracle_instances.application_id (no action -> restrict)
ALTER TABLE "application_oracle_instances" DROP CONSTRAINT IF EXISTS "application_oracle_instances_application_id_monitored_applications_id_fk";
--> statement-breakpoint
ALTER TABLE "application_oracle_instances" ADD CONSTRAINT "application_oracle_instances_application_id_monitored_applications_id_fk"
	FOREIGN KEY ("application_id") REFERENCES "public"."monitored_applications"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "application_oracle_instances" VALIDATE CONSTRAINT "application_oracle_instances_application_id_monitored_applications_id_fk";
--> statement-breakpoint

-- audit_evidence_snapshots.application_id (no action -> restrict)
ALTER TABLE "audit_evidence_snapshots" DROP CONSTRAINT IF EXISTS "audit_evidence_snapshots_application_id_monitored_applications_id_fk";
--> statement-breakpoint
ALTER TABLE "audit_evidence_snapshots" ADD CONSTRAINT "audit_evidence_snapshots_application_id_monitored_applications_id_fk"
	FOREIGN KEY ("application_id") REFERENCES "public"."monitored_applications"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "audit_evidence_snapshots" VALIDATE CONSTRAINT "audit_evidence_snapshots_application_id_monitored_applications_id_fk";
--> statement-breakpoint

-- oracle_role_assessments.application_id (no action -> restrict)
ALTER TABLE "oracle_role_assessments" DROP CONSTRAINT IF EXISTS "oracle_role_assessments_application_id_monitored_applications_id_fk";
--> statement-breakpoint
ALTER TABLE "oracle_role_assessments" ADD CONSTRAINT "oracle_role_assessments_application_id_monitored_applications_id_fk"
	FOREIGN KEY ("application_id") REFERENCES "public"."monitored_applications"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "oracle_role_assessments" VALIDATE CONSTRAINT "oracle_role_assessments_application_id_monitored_applications_id_fk";
--> statement-breakpoint

-- application_controls.application_id (cascade -> restrict)
ALTER TABLE "application_controls" DROP CONSTRAINT IF EXISTS "application_controls_application_id_monitored_applications_id_fk";
--> statement-breakpoint
ALTER TABLE "application_controls" ADD CONSTRAINT "application_controls_application_id_monitored_applications_id_fk"
	FOREIGN KEY ("application_id") REFERENCES "public"."monitored_applications"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "application_controls" VALIDATE CONSTRAINT "application_controls_application_id_monitored_applications_id_fk";
--> statement-breakpoint

-- application_technology_elements.application_id (cascade -> restrict)
ALTER TABLE "application_technology_elements" DROP CONSTRAINT IF EXISTS "application_technology_elements_application_id_monitored_applications_id_fk";
--> statement-breakpoint
ALTER TABLE "application_technology_elements" ADD CONSTRAINT "application_technology_elements_application_id_monitored_applications_id_fk"
	FOREIGN KEY ("application_id") REFERENCES "public"."monitored_applications"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "application_technology_elements" VALIDATE CONSTRAINT "application_technology_elements_application_id_monitored_applications_id_fk";
--> statement-breakpoint

-- routine_reviews.application_id (set null -> restrict)
ALTER TABLE "routine_reviews" DROP CONSTRAINT IF EXISTS "routine_reviews_application_id_monitored_applications_id_fk";
--> statement-breakpoint
ALTER TABLE "routine_reviews" ADD CONSTRAINT "routine_reviews_application_id_monitored_applications_id_fk"
	FOREIGN KEY ("application_id") REFERENCES "public"."monitored_applications"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "routine_reviews" VALIDATE CONSTRAINT "routine_reviews_application_id_monitored_applications_id_fk";
--> statement-breakpoint

-- Self-referencing FK: monitored_applications.primary_application_id -> monitored_applications.id (RESTRICT)
-- Forhindrer fysisk sletting av primær-app som har lenkede child-apps
ALTER TABLE "monitored_applications" DROP CONSTRAINT IF EXISTS "monitored_applications_primary_application_id_monitored_applications_id_fk";
--> statement-breakpoint
ALTER TABLE "monitored_applications" ADD CONSTRAINT "monitored_applications_primary_application_id_monitored_applications_id_fk"
FOREIGN KEY ("primary_application_id") REFERENCES "public"."monitored_applications"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "monitored_applications" VALIDATE CONSTRAINT "monitored_applications_primary_application_id_monitored_applications_id_fk";
