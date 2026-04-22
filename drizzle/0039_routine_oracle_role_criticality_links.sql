CREATE TABLE IF NOT EXISTS "routine_oracle_role_criticality_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"routine_id" uuid NOT NULL,
	"criticality" text NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "routine_oracle_role_criticality_links"
		ADD CONSTRAINT "routine_oracle_role_criticality_links_routine_id_routines_id_fk"
		FOREIGN KEY ("routine_id") REFERENCES "public"."routines"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
