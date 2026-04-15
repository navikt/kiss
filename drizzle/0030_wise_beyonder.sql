CREATE TABLE "application_group_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"group_id" text NOT NULL,
	"criticality" text NOT NULL,
	"assessed_by" text NOT NULL,
	"assessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "application_group_assessments_application_id_group_id_unique" UNIQUE("application_id","group_id")
);
--> statement-breakpoint
CREATE TABLE "section_excluded_environments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"section_id" uuid NOT NULL,
	"cluster" text NOT NULL,
	"excluded_by" text NOT NULL,
	"excluded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_section_cluster" UNIQUE("section_id","cluster")
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nav_ident" text NOT NULL,
	"landing_page" text DEFAULT 'dashboard' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_preferences_nav_ident_unique" UNIQUE("nav_ident")
);
--> statement-breakpoint
CREATE TABLE "routine_review_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"snapshot_before" jsonb,
	"snapshot_after" jsonb,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routine_review_activity_entra_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"activity_id" uuid NOT NULL,
	"change_type" text NOT NULL,
	"group_id" text NOT NULL,
	"group_name" text,
	"previous_value" text,
	"new_value" text,
	"performed_by" text NOT NULL,
	"performed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ruleset_routines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ruleset_id" uuid NOT NULL,
	"routine_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "routines" ADD COLUMN "activity_type" text;--> statement-breakpoint
ALTER TABLE "application_group_assessments" ADD CONSTRAINT "application_group_assessments_application_id_monitored_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."monitored_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_excluded_environments" ADD CONSTRAINT "section_excluded_environments_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routine_review_activities" ADD CONSTRAINT "routine_review_activities_review_id_routine_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."routine_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routine_review_activity_entra_changes" ADD CONSTRAINT "routine_review_activity_entra_changes_activity_id_routine_review_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."routine_review_activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ruleset_routines" ADD CONSTRAINT "ruleset_routines_ruleset_id_rulesets_id_fk" FOREIGN KEY ("ruleset_id") REFERENCES "public"."rulesets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ruleset_routines" ADD CONSTRAINT "ruleset_routines_routine_id_routines_id_fk" FOREIGN KEY ("routine_id") REFERENCES "public"."routines"("id") ON DELETE cascade ON UPDATE no action;