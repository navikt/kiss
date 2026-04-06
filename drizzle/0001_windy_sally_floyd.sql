CREATE TABLE "application_auth_integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"type" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"allow_all_users" boolean,
	"claims_extra" text,
	"groups" text,
	"sidecar_enabled" boolean,
	"inbound_rules" text,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "application_persistence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"version" text,
	"tier" text,
	"high_availability" boolean,
	"audit_logging" boolean,
	"audit_log_url" text,
	"extra" text,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dev_team_nais_team_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dev_team_id" uuid NOT NULL,
	"nais_team_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "link_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"primary_app_id" uuid NOT NULL,
	"secondary_app_id" uuid NOT NULL,
	"match_type" text NOT NULL,
	"confidence" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "section_ignored_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"section_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"reason" text,
	"ignored_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ignored_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"previous_value" text,
	"new_value" text,
	"metadata" text,
	"performed_by" text NOT NULL,
	"performed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"original_file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"bucket_path" text NOT NULL,
	"uploaded_by" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "application_technology_elements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"element_id" uuid NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"confirmed_at" timestamp with time zone,
	"confirmed_by" text,
	"rejected_at" timestamp with time zone,
	"rejected_by" text,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_app_tech_element" UNIQUE("application_id","element_id")
);
--> statement-breakpoint
CREATE TABLE "control_dependencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"control_id" uuid NOT NULL,
	"depends_on_control_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "control_predefined_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"control_id" uuid NOT NULL,
	"label" text NOT NULL,
	"status" text NOT NULL,
	"comment" text,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "control_technology_elements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"control_id" uuid NOT NULL,
	"element_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "framework_field_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"field_name" text NOT NULL,
	"previous_value" text,
	"new_value" text,
	"import_id" uuid NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"changed_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "technology_elements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "technology_elements_name_unique" UNIQUE("name"),
	CONSTRAINT "technology_elements_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "routine_review_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"bucket_path" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer,
	"uploaded_by" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routine_review_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"url" text NOT NULL,
	"title" text,
	"added_by" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routine_review_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"user_ident" text NOT NULL,
	"user_name" text,
	"confirmed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "routine_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"routine_id" uuid NOT NULL,
	"application_id" uuid,
	"title" text NOT NULL,
	"summary" text,
	"routine_snapshot_path" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"reviewed_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routine_technology_elements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"routine_id" uuid NOT NULL,
	"element_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"section_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"frequency" text NOT NULL,
	"screening_question_id" uuid,
	"screening_choice_value" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "screening_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"answer" text,
	"comment" text,
	"link" text,
	"answered_by" text,
	"answered_at" timestamp with time zone,
	CONSTRAINT "screening_answers_application_id_question_id_unique" UNIQUE("application_id","question_id")
);
--> statement-breakpoint
CREATE TABLE "screening_choice_effects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"choice_id" uuid NOT NULL,
	"control_id" uuid NOT NULL,
	"effect" text,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "screening_question_choices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_id" uuid NOT NULL,
	"value" text NOT NULL,
	"label" text NOT NULL,
	"requires_comment" boolean DEFAULT false NOT NULL,
	"requires_link" boolean DEFAULT false NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "screening_question_effects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_id" uuid NOT NULL,
	"control_id" uuid NOT NULL,
	"yes_effect" text,
	"no_effect" text,
	"yes_comment" text,
	"no_comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "screening_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"section_id" uuid,
	"question_text" text NOT NULL,
	"description" text,
	"answer_type" text DEFAULT 'boolean' NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "compliance_assessments" DROP CONSTRAINT "compliance_assessments_framework_version_id_framework_versions_id_fk";
--> statement-breakpoint
ALTER TABLE "framework_controls" DROP CONSTRAINT "framework_controls_version_id_framework_versions_id_fk";
--> statement-breakpoint
ALTER TABLE "framework_controls" DROP CONSTRAINT "framework_controls_domain_id_framework_domains_id_fk";
--> statement-breakpoint
ALTER TABLE "framework_domains" DROP CONSTRAINT "framework_domains_version_id_framework_versions_id_fk";
--> statement-breakpoint
ALTER TABLE "framework_risk_control_mappings" DROP CONSTRAINT "framework_risk_control_mappings_version_id_framework_versions_id_fk";
--> statement-breakpoint
ALTER TABLE "framework_risks" DROP CONSTRAINT "framework_risks_version_id_framework_versions_id_fk";
--> statement-breakpoint
ALTER TABLE "framework_versions" ALTER COLUMN "status" SET DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "application_environments" ADD COLUMN "image_name" text;--> statement-breakpoint
ALTER TABLE "application_environments" ADD COLUMN "git_repository" text;--> statement-breakpoint
ALTER TABLE "monitored_applications" ADD COLUMN "primary_application_id" uuid;--> statement-breakpoint
ALTER TABLE "nais_teams" ADD COLUMN "app_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "nais_teams" ADD COLUMN "section_id" uuid;--> statement-breakpoint
ALTER TABLE "compliance_assessments" ADD COLUMN "technology_element_id" uuid;--> statement-breakpoint
ALTER TABLE "framework_controls" ADD COLUMN "short_title" text;--> statement-breakpoint
ALTER TABLE "framework_controls" ADD COLUMN "cron_frequency" text;--> statement-breakpoint
ALTER TABLE "framework_controls" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "framework_controls" ADD COLUMN "last_import_id" uuid;--> statement-breakpoint
ALTER TABLE "framework_domains" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "framework_domains" ADD COLUMN "last_import_id" uuid;--> statement-breakpoint
ALTER TABLE "framework_risks" ADD COLUMN "short_title" text;--> statement-breakpoint
ALTER TABLE "framework_risks" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "framework_risks" ADD COLUMN "last_import_id" uuid;--> statement-breakpoint
ALTER TABLE "application_auth_integrations" ADD CONSTRAINT "application_auth_integrations_application_id_monitored_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."monitored_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_persistence" ADD CONSTRAINT "application_persistence_application_id_monitored_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."monitored_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dev_team_nais_team_mappings" ADD CONSTRAINT "dev_team_nais_team_mappings_dev_team_id_dev_teams_id_fk" FOREIGN KEY ("dev_team_id") REFERENCES "public"."dev_teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dev_team_nais_team_mappings" ADD CONSTRAINT "dev_team_nais_team_mappings_nais_team_id_nais_teams_id_fk" FOREIGN KEY ("nais_team_id") REFERENCES "public"."nais_teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_suggestions" ADD CONSTRAINT "link_suggestions_primary_app_id_monitored_applications_id_fk" FOREIGN KEY ("primary_app_id") REFERENCES "public"."monitored_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_suggestions" ADD CONSTRAINT "link_suggestions_secondary_app_id_monitored_applications_id_fk" FOREIGN KEY ("secondary_app_id") REFERENCES "public"."monitored_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_ignored_applications" ADD CONSTRAINT "section_ignored_applications_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_ignored_applications" ADD CONSTRAINT "section_ignored_applications_application_id_monitored_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."monitored_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_technology_elements" ADD CONSTRAINT "application_technology_elements_application_id_monitored_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."monitored_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_technology_elements" ADD CONSTRAINT "application_technology_elements_element_id_technology_elements_id_fk" FOREIGN KEY ("element_id") REFERENCES "public"."technology_elements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_dependencies" ADD CONSTRAINT "control_dependencies_control_id_framework_controls_id_fk" FOREIGN KEY ("control_id") REFERENCES "public"."framework_controls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_dependencies" ADD CONSTRAINT "control_dependencies_depends_on_control_id_framework_controls_id_fk" FOREIGN KEY ("depends_on_control_id") REFERENCES "public"."framework_controls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_predefined_answers" ADD CONSTRAINT "control_predefined_answers_control_id_framework_controls_id_fk" FOREIGN KEY ("control_id") REFERENCES "public"."framework_controls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_technology_elements" ADD CONSTRAINT "control_technology_elements_control_id_framework_controls_id_fk" FOREIGN KEY ("control_id") REFERENCES "public"."framework_controls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_technology_elements" ADD CONSTRAINT "control_technology_elements_element_id_technology_elements_id_fk" FOREIGN KEY ("element_id") REFERENCES "public"."technology_elements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "framework_field_history" ADD CONSTRAINT "framework_field_history_import_id_framework_versions_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."framework_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routine_review_attachments" ADD CONSTRAINT "routine_review_attachments_review_id_routine_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."routine_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routine_review_links" ADD CONSTRAINT "routine_review_links_review_id_routine_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."routine_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routine_review_participants" ADD CONSTRAINT "routine_review_participants_review_id_routine_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."routine_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routine_reviews" ADD CONSTRAINT "routine_reviews_routine_id_routines_id_fk" FOREIGN KEY ("routine_id") REFERENCES "public"."routines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routine_reviews" ADD CONSTRAINT "routine_reviews_application_id_monitored_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."monitored_applications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routine_technology_elements" ADD CONSTRAINT "routine_technology_elements_routine_id_routines_id_fk" FOREIGN KEY ("routine_id") REFERENCES "public"."routines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routine_technology_elements" ADD CONSTRAINT "routine_technology_elements_element_id_technology_elements_id_fk" FOREIGN KEY ("element_id") REFERENCES "public"."technology_elements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routines" ADD CONSTRAINT "routines_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routines" ADD CONSTRAINT "routines_screening_question_id_screening_questions_id_fk" FOREIGN KEY ("screening_question_id") REFERENCES "public"."screening_questions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screening_answers" ADD CONSTRAINT "screening_answers_application_id_monitored_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."monitored_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screening_answers" ADD CONSTRAINT "screening_answers_question_id_screening_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."screening_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screening_choice_effects" ADD CONSTRAINT "screening_choice_effects_choice_id_screening_question_choices_id_fk" FOREIGN KEY ("choice_id") REFERENCES "public"."screening_question_choices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screening_choice_effects" ADD CONSTRAINT "screening_choice_effects_control_id_framework_controls_id_fk" FOREIGN KEY ("control_id") REFERENCES "public"."framework_controls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screening_question_choices" ADD CONSTRAINT "screening_question_choices_question_id_screening_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."screening_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screening_question_effects" ADD CONSTRAINT "screening_question_effects_question_id_screening_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."screening_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screening_question_effects" ADD CONSTRAINT "screening_question_effects_control_id_framework_controls_id_fk" FOREIGN KEY ("control_id") REFERENCES "public"."framework_controls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screening_questions" ADD CONSTRAINT "screening_questions_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nais_teams" ADD CONSTRAINT "nais_teams_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_assessments" ADD CONSTRAINT "compliance_assessments_technology_element_id_technology_elements_id_fk" FOREIGN KEY ("technology_element_id") REFERENCES "public"."technology_elements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "framework_controls" ADD CONSTRAINT "framework_controls_last_import_id_framework_versions_id_fk" FOREIGN KEY ("last_import_id") REFERENCES "public"."framework_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "framework_domains" ADD CONSTRAINT "framework_domains_last_import_id_framework_versions_id_fk" FOREIGN KEY ("last_import_id") REFERENCES "public"."framework_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "framework_risks" ADD CONSTRAINT "framework_risks_last_import_id_framework_versions_id_fk" FOREIGN KEY ("last_import_id") REFERENCES "public"."framework_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_assessments" DROP COLUMN "framework_version_id";--> statement-breakpoint
ALTER TABLE "framework_controls" DROP COLUMN "version_id";--> statement-breakpoint
ALTER TABLE "framework_controls" DROP COLUMN "domain_id";--> statement-breakpoint
ALTER TABLE "framework_domains" DROP COLUMN "version_id";--> statement-breakpoint
ALTER TABLE "framework_risk_control_mappings" DROP COLUMN "version_id";--> statement-breakpoint
ALTER TABLE "framework_risks" DROP COLUMN "version_id";--> statement-breakpoint
ALTER TABLE "framework_controls" ADD CONSTRAINT "framework_controls_control_id_unique" UNIQUE("control_id");--> statement-breakpoint
ALTER TABLE "framework_domains" ADD CONSTRAINT "framework_domains_code_unique" UNIQUE("code");--> statement-breakpoint
ALTER TABLE "framework_risks" ADD CONSTRAINT "framework_risks_risk_id_unique" UNIQUE("risk_id");