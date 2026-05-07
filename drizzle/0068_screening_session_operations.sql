CREATE TABLE IF NOT EXISTS "screening_session_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"intent" text NOT NULL,
	"payload" jsonb NOT NULL,
	"performed_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "screening_session_operations" ADD CONSTRAINT "screening_session_operations_session_id_screening_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."screening_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "screening_session_operations_economy_unique"
ON "screening_session_operations" ("session_id")
WHERE intent = 'save-economy-classification';
