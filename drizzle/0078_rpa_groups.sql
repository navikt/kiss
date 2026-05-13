-- RPA (Robotic Process Automation) groups and their synced members
-- Used to track which robot users have access to applications via Entra ID groups

CREATE TABLE IF NOT EXISTS "rpa_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" text NOT NULL,
	"group_name" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"archived_by" text
);

CREATE UNIQUE INDEX IF NOT EXISTS "rpa_groups_active_unique_idx" ON "rpa_groups" USING btree ("group_id") WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS "rpa_group_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rpa_group_id" uuid NOT NULL REFERENCES "rpa_groups"("id") ON DELETE restrict,
	"user_object_id" text NOT NULL,
	"display_name" text,
	"user_principal_name" text,
	"account_enabled" boolean,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"archived_by" text
);

CREATE UNIQUE INDEX IF NOT EXISTS "rpa_group_members_active_unique_idx" ON "rpa_group_members" USING btree ("rpa_group_id", "user_object_id") WHERE archived_at IS NULL;
