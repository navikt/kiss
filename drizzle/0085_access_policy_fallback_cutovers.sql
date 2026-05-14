CREATE TABLE IF NOT EXISTS "application_access_policy_fallback_cutovers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"cutover_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "application_access_policy_fallback_cutovers_direction_check" CHECK ("direction" IN ('inbound', 'outbound'))
);

DO $$ BEGIN
 ALTER TABLE "application_access_policy_fallback_cutovers"
 ADD CONSTRAINT "application_access_policy_fallback_cutovers_application_id_monitored_applications_id_fk"
 FOREIGN KEY ("application_id") REFERENCES "public"."monitored_applications"("id")
 ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "application_access_policy_fallback_cutovers_unique_idx"
	ON "application_access_policy_fallback_cutovers" USING btree ("application_id", "direction");
