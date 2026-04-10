CREATE TABLE "persistence_audit_confirmations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"persistence_id" uuid NOT NULL,
	"enabled_at" date NOT NULL,
	"description" text NOT NULL,
	"evidence_url" text NOT NULL,
	"confirmed_by" text NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "persistence_audit_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"persistence_id" uuid NOT NULL,
	"conclusion" text NOT NULL,
	"reason" text,
	"unified_auditing_enabled" boolean,
	"active_policy_count" integer,
	"audited_object_count" integer,
	"unaudited_table_count" integer,
	"excluded_user_count" integer,
	"policies_without_failure_audit" integer,
	"has_audit_trail_data" boolean,
	"findings" jsonb,
	"fetched_at" timestamp with time zone NOT NULL,
	"last_sync_attempted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "persistence_audit_summaries_persistence_id_unique" UNIQUE("persistence_id")
);
--> statement-breakpoint
ALTER TABLE "persistence_audit_confirmations" ADD CONSTRAINT "persistence_audit_confirmations_persistence_id_application_persistence_id_fk" FOREIGN KEY ("persistence_id") REFERENCES "public"."application_persistence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persistence_audit_summaries" ADD CONSTRAINT "persistence_audit_summaries_persistence_id_application_persistence_id_fk" FOREIGN KEY ("persistence_id") REFERENCES "public"."application_persistence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_pac_active_unique" ON "persistence_audit_confirmations" USING btree ("persistence_id") WHERE revoked_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_pas_conclusion" ON "persistence_audit_summaries" USING btree ("conclusion");--> statement-breakpoint
CREATE INDEX "idx_pas_fetched_at" ON "persistence_audit_summaries" USING btree ("fetched_at");