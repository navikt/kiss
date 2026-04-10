CREATE TABLE "deployment_verification_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"environment" text NOT NULL,
	"team_slug" text NOT NULL,
	"app_name" text NOT NULL,
	"period_from" timestamp with time zone NOT NULL,
	"period_to" timestamp with time zone NOT NULL,
	"four_eyes_coverage_percent" integer,
	"four_eyes_total" integer,
	"four_eyes_approved" integer,
	"change_origin_coverage_percent" integer,
	"change_origin_total" integer,
	"change_origin_linked" integer,
	"last_deployment_at" timestamp with time zone,
	"raw_summary" jsonb NOT NULL,
	"status" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"last_sync_attempted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "uq_dvs_app_env" UNIQUE("application_id","environment")
);
--> statement-breakpoint
ALTER TABLE "deployment_verification_summaries" ADD CONSTRAINT "deployment_verification_summaries_application_id_monitored_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."monitored_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_dvs_status" ON "deployment_verification_summaries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_dvs_fetched_at" ON "deployment_verification_summaries" USING btree ("fetched_at");--> statement-breakpoint
CREATE INDEX "idx_dvs_four_eyes_pct" ON "deployment_verification_summaries" USING btree ("four_eyes_coverage_percent");