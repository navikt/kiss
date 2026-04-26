-- Soft-delete (logisk arkivering) for alle 13 m:n-linktabeller i kodebasen
-- (SD7-fasen i soft-delete-roadmapen).
--
-- Bakgrunn: SD6 innførte diff-basert audit-logging på link/unlink-operasjoner,
-- men selve linktabellene ble fortsatt hard-slettet. Det betyr at man kunne
-- rekonstruere historikk via `audit_log`, men selve raden var borte. Denne
-- migrasjonen innfører `archived_at` / `archived_by` på alle 13 link-tabellene
-- slik at også raden bevares for full sporbarhet.
--
-- Strategi for re-link: når en kobling som tidligere er arkivert legges til
-- på nytt, soft-deletes ikke den gamle raden — den ligger igjen som historikk
-- — og en ny aktiv rad opprettes. Partial unique indexes (WHERE archived_at
-- IS NULL) sikrer at det aldri kan finnes to aktive rader for samme logiske
-- kobling samtidig (for de tabellene som har naturlige unique-nøkler).
--
-- For tabeller som tidligere hadde UNIQUE-constraint (application_technology_-
-- elements, screening_question_technology_elements) konverteres disse til
-- partial unique indexes slik at arkiverte rader ikke konflikter med nye
-- aktive rader.
--
-- Idempotent via IF NOT EXISTS / IF EXISTS.

-- ─── 1. routine_persistence_links ─────────────────────────────────────────
ALTER TABLE "routine_persistence_links"
	ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone,
	ADD COLUMN IF NOT EXISTS "archived_by" text;

-- ─── 2. routine_group_classification_links ───────────────────────────────
ALTER TABLE "routine_group_classification_links"
	ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone,
	ADD COLUMN IF NOT EXISTS "archived_by" text;

-- ─── 3. routine_oracle_role_criticality_links ────────────────────────────
ALTER TABLE "routine_oracle_role_criticality_links"
	ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone,
	ADD COLUMN IF NOT EXISTS "archived_by" text;

-- ─── 4. routine_screening_questions ──────────────────────────────────────
ALTER TABLE "routine_screening_questions"
	ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone,
	ADD COLUMN IF NOT EXISTS "archived_by" text;

-- ─── 5. routine_controls ─────────────────────────────────────────────────
ALTER TABLE "routine_controls"
	ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone,
	ADD COLUMN IF NOT EXISTS "archived_by" text;

-- ─── 6. routine_technology_elements ──────────────────────────────────────
ALTER TABLE "routine_technology_elements"
	ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone,
	ADD COLUMN IF NOT EXISTS "archived_by" text;

-- ─── 7. ruleset_controls ─────────────────────────────────────────────────
ALTER TABLE "ruleset_controls"
	ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone,
	ADD COLUMN IF NOT EXISTS "archived_by" text;

-- ─── 8. ruleset_routines ─────────────────────────────────────────────────
ALTER TABLE "ruleset_routines"
	ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone,
	ADD COLUMN IF NOT EXISTS "archived_by" text;

-- ─── 9. control_technology_elements ──────────────────────────────────────
-- Tabellen har aldri hatt UNIQUE-constraint, men replace-mønsteret i
-- syncControlTechElements/addControlElement må kunne stole på at det ikke
-- finnes to aktive rader for samme (control_id, element_id). Legg derfor
-- til partial unique index sammen med archived_at-kolonnene.
ALTER TABLE "control_technology_elements"
	ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone,
	ADD COLUMN IF NOT EXISTS "archived_by" text;

-- LOCK TABLE for å hindre concurrent inserts i vinduet mellom dedup og
-- index-opprettelse (ellers kan deploy-migrasjonen feile pga. en ny
-- duplikat-rad). Samme mønster som 0049_application_persistence_unique_active.
LOCK TABLE "control_technology_elements" IN SHARE ROW EXCLUSIVE MODE;

-- Defensiv dedup før index opprettes: arkiverer eventuelle dupliserte aktive
-- rader (beholder den med lavest id som tiebreaker for stabilitet på tvers av
-- vacuum/runs). Read-then-insert-mønsteret i koden har historisk forhindret
-- dette, men onConflictDoNothing() uten constraint var no-op slik at en race
-- teoretisk kunne ha laget duplikater.
WITH ranked AS (
	SELECT id, ROW_NUMBER() OVER (
		PARTITION BY control_id, element_id ORDER BY id
	) AS rn
	FROM control_technology_elements
	WHERE archived_at IS NULL
)
UPDATE control_technology_elements
SET archived_at = now(), archived_by = 'system:sd7-dedup'
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_control_tech_element_active"
	ON "control_technology_elements" ("control_id", "element_id")
	WHERE "archived_at" IS NULL;

-- ─── 10. application_technology_elements ─────────────────────────────────
-- Konverter eksisterende UNIQUE-constraint til partial unique index.
ALTER TABLE "application_technology_elements"
	ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone,
	ADD COLUMN IF NOT EXISTS "archived_by" text;

ALTER TABLE "application_technology_elements"
	DROP CONSTRAINT IF EXISTS "uq_app_tech_element";

CREATE UNIQUE INDEX IF NOT EXISTS "uq_app_tech_element_active"
	ON "application_technology_elements" ("application_id", "element_id")
	WHERE "archived_at" IS NULL;

-- ─── 11. screening_question_technology_elements ──────────────────────────
ALTER TABLE "screening_question_technology_elements"
	ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone,
	ADD COLUMN IF NOT EXISTS "archived_by" text;

ALTER TABLE "screening_question_technology_elements"
	DROP CONSTRAINT IF EXISTS "screening_question_technology_elements_question_id_element_id_unique";

CREATE UNIQUE INDEX IF NOT EXISTS "uq_screening_question_tech_element_active"
	ON "screening_question_technology_elements" ("question_id", "element_id")
	WHERE "archived_at" IS NULL;

-- ─── 12. application_team_mappings ───────────────────────────────────────
-- Tabellen har aldri hatt UNIQUE-constraint, men SD6 introduserte audit på
-- link/unlink. Med soft-delete blir replace-mønsteret race-utsatt uten
-- partial unique index. Legg til samme mønster som control_technology_elements.
ALTER TABLE "application_team_mappings"
	ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone,
	ADD COLUMN IF NOT EXISTS "archived_by" text;

LOCK TABLE "application_team_mappings" IN SHARE ROW EXCLUSIVE MODE;

WITH ranked AS (
	SELECT id, ROW_NUMBER() OVER (
		PARTITION BY application_id, dev_team_id ORDER BY id
	) AS rn
	FROM application_team_mappings
	WHERE archived_at IS NULL
)
UPDATE application_team_mappings
SET archived_at = now(), archived_by = 'system:sd7-dedup'
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_app_team_mapping_active"
	ON "application_team_mappings" ("application_id", "dev_team_id")
	WHERE "archived_at" IS NULL;

-- ─── 13. framework_risk_control_mappings ─────────────────────────────────
ALTER TABLE "framework_risk_control_mappings"
	ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone,
	ADD COLUMN IF NOT EXISTS "archived_by" text;
