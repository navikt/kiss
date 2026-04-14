CREATE TABLE IF NOT EXISTS "application_manual_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL REFERENCES "monitored_applications"("id"),
	"group_id" text NOT NULL,
	"group_name" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "application_manual_groups_application_id_group_id_unique" UNIQUE("application_id","group_id")
);
