-- Soft-delete (arkivering) av documents. Documents-tabellen er en bladnode (ingen
-- inngående FK-er fra andre tabeller), så denne migrasjonen legger kun til
-- archived_at / archived_by og krever ingen FK-konvertering.
--
-- Beslutning om GCS-blob-livssyklus (Alt. A): Filinnholdet i bucket-en BEVARES
-- når dokumentet arkiveres. Dette sikrer at historiske lenker (f.eks. i
-- compliance-kommentarer) fortsatt kan lastes ned, og er konsistent med
-- AGENTS.md regel 5 om at data aldri slettes — kun arkiveres. Eventuell
-- opprydding av blobs etter retention-periode håndteres av GCS lifecycle
-- policy (11 års retention).
--
-- Samme generelle mønster som migrasjon 0040 (sections), 0041
-- (monitored_applications), 0042 (routines), 0043 (screening), 0044 (dev_teams)
-- og 0045 (technology_elements). Idempotens er sikret via IF NOT EXISTS.

-- ── Nye kolonner ────────────────────────────────────────────────────────
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "archived_by" text;
