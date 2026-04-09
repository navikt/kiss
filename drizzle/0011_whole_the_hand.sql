CREATE TABLE "access_policy_acknowledgments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"rule_application" text NOT NULL,
	"comment" text NOT NULL,
	"acknowledged_by" text NOT NULL,
	"acknowledged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" text
);
--> statement-breakpoint
ALTER TABLE "access_policy_acknowledgments" ADD CONSTRAINT "access_policy_acknowledgments_application_id_monitored_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."monitored_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ack_active_unique" ON "access_policy_acknowledgments" ("application_id", "rule_application") WHERE "revoked_at" IS NULL;