CREATE TABLE "application_environments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"cluster" text NOT NULL,
	"namespace" text NOT NULL,
	"nais_team_id" uuid,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "application_team_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"dev_team_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monitored_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"added_manually" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nais_teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"display_name" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"dev_team_id" uuid,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" text,
	CONSTRAINT "nais_teams_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "bucket_objects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bucket_name" text NOT NULL,
	"object_path" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer,
	"object_type" text NOT NULL,
	"uploaded_by" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" text
);
--> statement-breakpoint
CREATE TABLE "compliance_assessment_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_id" uuid NOT NULL,
	"previous_status" text,
	"new_status" text NOT NULL,
	"previous_comment" text,
	"new_comment" text,
	"changed_by" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"control_id" uuid NOT NULL,
	"framework_version_id" uuid NOT NULL,
	"status" text NOT NULL,
	"comment" text,
	"assessed_by" text NOT NULL,
	"assessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "framework_controls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"domain_id" uuid NOT NULL,
	"control_id" text NOT NULL,
	"technology_element" text,
	"requirement" text,
	"responsible" text,
	"routine" text,
	"frequency" text,
	"documentation_requirement" text,
	"test_procedure" text,
	"dependencies" text,
	"references" text,
	"common_pitfalls" text
);
--> statement-breakpoint
CREATE TABLE "framework_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "framework_risk_control_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"risk_id" uuid NOT NULL,
	"control_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "framework_risks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"domain_id" uuid NOT NULL,
	"risk_id" text NOT NULL,
	"description" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "framework_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"source_file_name" text NOT NULL,
	"source_bucket_path" text NOT NULL,
	"status" text DEFAULT 'staging' NOT NULL,
	"activated_at" timestamp with time zone,
	"activated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clusters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"section_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dev_teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"section_id" uuid NOT NULL,
	"cluster_id" uuid,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "sections_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"section_id" uuid,
	"dev_team_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nav_ident" text NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_nav_ident_unique" UNIQUE("nav_ident")
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"report_type" text NOT NULL,
	"scope" text NOT NULL,
	"scope_id" uuid,
	"snapshot_bucket_path" text NOT NULL,
	"report_bucket_path" text,
	"app_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "application_environments" ADD CONSTRAINT "application_environments_application_id_monitored_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."monitored_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_environments" ADD CONSTRAINT "application_environments_nais_team_id_nais_teams_id_fk" FOREIGN KEY ("nais_team_id") REFERENCES "public"."nais_teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_team_mappings" ADD CONSTRAINT "application_team_mappings_application_id_monitored_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."monitored_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_team_mappings" ADD CONSTRAINT "application_team_mappings_dev_team_id_dev_teams_id_fk" FOREIGN KEY ("dev_team_id") REFERENCES "public"."dev_teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nais_teams" ADD CONSTRAINT "nais_teams_dev_team_id_dev_teams_id_fk" FOREIGN KEY ("dev_team_id") REFERENCES "public"."dev_teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_assessment_history" ADD CONSTRAINT "compliance_assessment_history_assessment_id_compliance_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."compliance_assessments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_assessments" ADD CONSTRAINT "compliance_assessments_application_id_monitored_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."monitored_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_assessments" ADD CONSTRAINT "compliance_assessments_control_id_framework_controls_id_fk" FOREIGN KEY ("control_id") REFERENCES "public"."framework_controls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_assessments" ADD CONSTRAINT "compliance_assessments_framework_version_id_framework_versions_id_fk" FOREIGN KEY ("framework_version_id") REFERENCES "public"."framework_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "framework_controls" ADD CONSTRAINT "framework_controls_version_id_framework_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."framework_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "framework_controls" ADD CONSTRAINT "framework_controls_domain_id_framework_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."framework_domains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "framework_domains" ADD CONSTRAINT "framework_domains_version_id_framework_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."framework_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "framework_risk_control_mappings" ADD CONSTRAINT "framework_risk_control_mappings_version_id_framework_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."framework_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "framework_risk_control_mappings" ADD CONSTRAINT "framework_risk_control_mappings_risk_id_framework_risks_id_fk" FOREIGN KEY ("risk_id") REFERENCES "public"."framework_risks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "framework_risk_control_mappings" ADD CONSTRAINT "framework_risk_control_mappings_control_id_framework_controls_id_fk" FOREIGN KEY ("control_id") REFERENCES "public"."framework_controls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "framework_risks" ADD CONSTRAINT "framework_risks_version_id_framework_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."framework_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "framework_risks" ADD CONSTRAINT "framework_risks_domain_id_framework_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."framework_domains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clusters" ADD CONSTRAINT "clusters_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dev_teams" ADD CONSTRAINT "dev_teams_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dev_teams" ADD CONSTRAINT "dev_teams_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_dev_team_id_dev_teams_id_fk" FOREIGN KEY ("dev_team_id") REFERENCES "public"."dev_teams"("id") ON DELETE no action ON UPDATE no action;