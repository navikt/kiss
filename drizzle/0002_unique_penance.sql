CREATE TABLE "application_access_policy_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"rule_application" text NOT NULL,
	"rule_namespace" text,
	"rule_cluster" text,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "application_access_policy_rules" ADD CONSTRAINT "application_access_policy_rules_application_id_monitored_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."monitored_applications"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "access_policy_unique_rule" ON "application_access_policy_rules" ("application_id", "direction", "rule_application", COALESCE("rule_namespace", ''), COALESCE("rule_cluster", ''));