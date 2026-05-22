CREATE TABLE IF NOT EXISTS "routine_rpa_user_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"user_object_id" text NOT NULL,
	"owner" text,
	"need_comment" text,
	"criticality_comment" text,
	"security_comment" text,
	"decision" text,
	"decision_deadline" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "routine_rpa_user_assessments_decision_check" CHECK (
		"decision" IS NULL OR "decision" IN ('avvikles', 'endres', 'videreføres')
	),
	CONSTRAINT "routine_rpa_user_assessments_deadline_check" CHECK (
		decision_deadline IS NULL OR decision IN ('avvikles', 'endres')
	)
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "routine_rpa_user_assessments"
		ADD CONSTRAINT "routine_rpa_user_assessments_review_id_fk"
		FOREIGN KEY ("review_id")
		REFERENCES "routine_reviews"("id")
		ON DELETE RESTRICT;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "routine_rpa_user_assessments_unique_idx"
	ON "routine_rpa_user_assessments" ("review_id", "user_object_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "routine_rpa_user_assessments_review_idx"
	ON "routine_rpa_user_assessments" ("review_id");
