ALTER TABLE "monitored_applications" ADD COLUMN IF NOT EXISTS "git_repository" text;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "github_repo_teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"team_slug" text NOT NULL,
	"team_name" text NOT NULL,
	"permission" text NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_github_repo_teams_app_team" UNIQUE("application_id","team_slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "github_repo_team_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_team_id" uuid NOT NULL,
	"username" text NOT NULL,
	"role" text NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_github_repo_team_members_team_user" UNIQUE("repo_team_id","username")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "github_repo_collaborators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"username" text NOT NULL,
	"permission" text NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_github_repo_collaborators_app_user" UNIQUE("application_id","username")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_github_repo_teams_app" ON "github_repo_teams" ("application_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_github_repo_team_members_team" ON "github_repo_team_members" ("repo_team_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_github_repo_collaborators_app" ON "github_repo_collaborators" ("application_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "github_repo_teams" ADD CONSTRAINT "github_repo_teams_application_id_monitored_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."monitored_applications"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "github_repo_team_members" ADD CONSTRAINT "github_repo_team_members_repo_team_id_github_repo_teams_id_fk" FOREIGN KEY ("repo_team_id") REFERENCES "public"."github_repo_teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "github_repo_collaborators" ADD CONSTRAINT "github_repo_collaborators_application_id_monitored_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."monitored_applications"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
