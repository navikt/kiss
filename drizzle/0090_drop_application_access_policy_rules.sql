-- Drop legacy app-level access policy rules table
-- All access policy data is now stored per environment in application_environment_access_policy_rules
DROP TABLE IF EXISTS application_access_policy_rules;
