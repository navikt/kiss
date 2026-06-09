-- Utvider oracle_role_assessments med audit-kolonner (created_at, created_by)
-- og myk sletting (archived_at, archived_by).
-- Den eksisterende unike constraint erstattes med en partiell unik indeks
-- slik at arkiverte rader kan eksistere side om side med aktive rader.

ALTER TABLE "oracle_role_assessments" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone NOT NULL DEFAULT now();
ALTER TABLE "oracle_role_assessments" ADD COLUMN IF NOT EXISTS "created_by" text NOT NULL DEFAULT '';
ALTER TABLE "oracle_role_assessments" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;
ALTER TABLE "oracle_role_assessments" ADD COLUMN IF NOT EXISTS "archived_by" text;

-- Bruk assessed_by som backfill for created_by på eksisterende rader
UPDATE "oracle_role_assessments" SET "created_by" = "assessed_by" WHERE "created_by" = '';

-- Fjern default slik at nye rader MÅ oppgi created_by eksplisitt
ALTER TABLE "oracle_role_assessments" ALTER COLUMN "created_by" DROP DEFAULT;

-- Drop gammel unik constraint (dekker alle rader inkludert arkiverte)
ALTER TABLE "oracle_role_assessments" DROP CONSTRAINT IF EXISTS "uq_oracle_role_assessment";

-- Ny partiell unik indeks: kun én aktiv (ikke-arkivert) rad per (applikasjon, instans, rollenavn)
CREATE UNIQUE INDEX IF NOT EXISTS "oracle_role_assessments_active_uniq_idx"
  ON "oracle_role_assessments" ("application_id", "instance_id", "role_name")
  WHERE "archived_at" IS NULL;
