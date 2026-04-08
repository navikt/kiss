CREATE TABLE "application_oracle_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"instance_id" text NOT NULL,
	"include_in_report" boolean DEFAULT true NOT NULL,
	"configured_by" text NOT NULL,
	"configured_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_application_oracle_instance" UNIQUE("application_id","instance_id")
);
--> statement-breakpoint
CREATE TABLE "audit_evidence_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"section_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"summary" text,
	"error" text,
	"result_json" jsonb
);
--> statement-breakpoint
CREATE TABLE "audit_evidence_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"instance_id" text NOT NULL,
	"overall_status" text NOT NULL,
	"collected_at" timestamp with time zone NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"fetched_by" text NOT NULL,
	"bucket_path" text NOT NULL,
	"excel_bucket_path" text
);
--> statement-breakpoint
ALTER TABLE "application_oracle_instances" ADD CONSTRAINT "application_oracle_instances_application_id_monitored_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."monitored_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_evidence_sections" ADD CONSTRAINT "audit_evidence_sections_snapshot_id_audit_evidence_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."audit_evidence_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_evidence_snapshots" ADD CONSTRAINT "audit_evidence_snapshots_application_id_monitored_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."monitored_applications"("id") ON DELETE no action ON UPDATE no action;