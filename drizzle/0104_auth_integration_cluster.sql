ALTER TABLE application_auth_integrations ADD COLUMN IF NOT EXISTS cluster TEXT;
-- Rydder alle eksisterende merged rader — dette er synk-data som repopuleres ved neste Nais-synk
DELETE FROM application_auth_integrations WHERE cluster IS NULL;
ALTER TABLE application_auth_integrations ALTER COLUMN cluster SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS application_auth_integrations_app_type_cluster_key
	ON application_auth_integrations (application_id, type, cluster);
