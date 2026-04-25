-- Soft-delete (logisk arkivering) for `application_persistence`.
--
-- Tidligere ble manuelt opprettede persistens-oppføringer hard-slettet via
-- `deleteManualPersistence()`. Nais-detekterte oppføringer kunne ikke slettes
-- i det hele tatt. Denne migrasjonen innfører `archived_at` / `archived_by`
-- slik at *alle* persistens-rader bevares for sporbarhet, og at Nais-sync
-- automatisk kan reaktivere en arkivert oppføring hvis ressursen dukker opp
-- igjen i klyngen.
--
-- Innkommende FK-er (`persistence_audit_summaries.persistence_id`,
-- `persistence_audit_confirmations.persistence_id`) er allerede uten
-- ON DELETE-handling, så soft-delete er det riktige mønsteret her — hard
-- DELETE ville feilet på FK når det fantes audit-historikk.
--
-- Idempotent via IF NOT EXISTS.

ALTER TABLE "application_persistence"
	ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone,
	ADD COLUMN IF NOT EXISTS "archived_by" text;
