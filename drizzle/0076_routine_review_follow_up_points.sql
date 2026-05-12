CREATE TABLE IF NOT EXISTS "routine_review_follow_up_points" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"text" text NOT NULL,
	"description" text,
	"resolution" text,
	"status" text DEFAULT 'needs_follow_up' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text
);--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "routine_review_follow_up_points"
		ADD CONSTRAINT "routine_review_follow_up_points_review_id_routine_reviews_id_fk"
		FOREIGN KEY ("review_id") REFERENCES "public"."routine_reviews"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "routine_review_follow_up_points"
		ADD CONSTRAINT "routine_review_follow_up_points_status_check"
		CHECK ("status" IN ('needs_follow_up', 'completed', 'not_relevant'));
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "routine_review_follow_up_points_review_id_idx"
	ON "routine_review_follow_up_points" ("review_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "routine_review_follow_up_point_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"point_id" uuid NOT NULL REFERENCES "routine_review_follow_up_points"("id") ON DELETE CASCADE,
	"kind" text NOT NULL DEFAULT 'resolution',
	"file_name" text NOT NULL,
	"bucket_path" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer,
	"uploaded_by" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "routine_review_follow_up_point_attachments"
		ADD CONSTRAINT "routine_review_follow_up_point_attachments_kind_check"
		CHECK ("kind" IN ('description', 'resolution'));
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "routine_review_follow_up_point_attachments_point_idx"
	ON "routine_review_follow_up_point_attachments" ("point_id");
