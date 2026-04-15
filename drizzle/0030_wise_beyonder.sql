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
ALTER TABLE "routines" ADD COLUMN "activity_type" text;--> statement-breakpoint
ALTER TABLE "routine_review_activities" ADD CONSTRAINT "routine_review_activities_review_id_routine_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."routine_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routine_review_activity_entra_changes" ADD CONSTRAINT "routine_review_activity_entra_changes_activity_id_routine_review_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."routine_review_activities"("id") ON DELETE cascade ON UPDATE no action;