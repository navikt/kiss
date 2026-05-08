CREATE TABLE IF NOT EXISTS "screening_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	"archived_at" timestamp with time zone,
	"archived_by" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "screening_session_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"user_ident" text NOT NULL,
	"user_name" text,
	"confirmed_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"archived_by" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "screening_session_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"answer" text,
	"comment" text,
	"link" text,
	"answered_by" text NOT NULL,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "screening_sessions" ADD CONSTRAINT "screening_sessions_application_id_monitored_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."monitored_applications"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "screening_session_participants" ADD CONSTRAINT "screening_session_participants_session_id_screening_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."screening_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "screening_session_answers" ADD CONSTRAINT "screening_session_answers_session_id_screening_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."screening_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "screening_session_answers" ADD CONSTRAINT "screening_session_answers_question_id_screening_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."screening_questions"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "screening_session_participants_active_unique_idx" ON "screening_session_participants" USING btree ("session_id","user_ident") WHERE "screening_session_participants"."archived_at" IS NULL;
--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM pg_constraint WHERE conname = 'screening_session_answers_session_id_question_id_unique'
 ) THEN
   ALTER TABLE "screening_session_answers" ADD CONSTRAINT "screening_session_answers_session_id_question_id_unique" UNIQUE("session_id","question_id");
 END IF;
END $$;
