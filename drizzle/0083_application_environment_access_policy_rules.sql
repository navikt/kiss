CREATE TABLE IF NOT EXISTS "application_environment_access_policy_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_environment_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"rule_application" text NOT NULL,
	"rule_namespace" text,
	"rule_cluster" text,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"archived_by" text
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "application_environment_access_policy_rules" ADD CONSTRAINT "application_environment_access_policy_rules_application_environment_id_application_environments_id_fk" FOREIGN KEY ("application_environment_id") REFERENCES "public"."application_environments"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "application_env_access_policy_rules_active_unique_idx"
	ON "application_environment_access_policy_rules" USING btree (
		"application_environment_id",
		"direction",
		"rule_application",
		COALESCE("rule_namespace", ''),
		COALESCE("rule_cluster", '')
	)
	WHERE archived_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_app_env_access_policy_rules_env_direction"
	ON "application_environment_access_policy_rules" USING btree ("application_environment_id","direction");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_application_environments_app_team"
	ON "application_environments" USING btree ("application_id","nais_team_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_application_environments_team_app"
	ON "application_environments" USING btree ("nais_team_id","application_id");
