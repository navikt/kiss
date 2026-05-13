CREATE TABLE IF NOT EXISTS "rpa_user_group_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_object_id" text NOT NULL,
	"group_id" text NOT NULL,
	"group_display_name" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "rpa_user_group_memberships_unique_idx" ON "rpa_user_group_memberships" USING btree ("user_object_id","group_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rpa_user_group_memberships_group_idx" ON "rpa_user_group_memberships" USING btree ("group_id");
--> statement-breakpoint
-- Force re-sync of all RPA groups so user group memberships get populated
UPDATE "rpa_groups" SET "updated_at" = '1970-01-01T00:00:00.000Z' WHERE "archived_at" IS NULL;
