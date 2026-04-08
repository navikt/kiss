CREATE TABLE "nais_discovered_apps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"nais_team_id" uuid NOT NULL,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "nais_discovered_apps" ADD CONSTRAINT "nais_discovered_apps_nais_team_id_nais_teams_id_fk" FOREIGN KEY ("nais_team_id") REFERENCES "public"."nais_teams"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "nais_discovered_apps_name_team_idx" ON "nais_discovered_apps" ("name", "nais_team_id");