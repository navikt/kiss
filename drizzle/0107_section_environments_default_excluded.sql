-- Endre default for included til false:
-- Nye miljøer oppdaget av Nais-sync skal være deaktivert inntil seksjonsansvarlig eksplisitt aktiverer dem.
ALTER TABLE "section_environments" ALTER COLUMN "included" SET DEFAULT false;
