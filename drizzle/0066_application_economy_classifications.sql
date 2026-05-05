CREATE TABLE IF NOT EXISTS "application_economy_classifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"is_economy_system" boolean NOT NULL,
	"economy_system_type" text,
	"justification" text NOT NULL,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	"archived_at" timestamp with time zone,
	"archived_by" text
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "application_economy_classifications" ADD CONSTRAINT "application_economy_classifications_application_id_monitored_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."monitored_applications"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "application_economy_classifications_active_unique_idx" ON "application_economy_classifications" USING btree ("application_id") WHERE archived_at IS NULL;
