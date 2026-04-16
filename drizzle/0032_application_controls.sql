CREATE TABLE "application_control_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_control_id" uuid NOT NULL,
	"action" text NOT NULL,
	"previous_status" text,
	"new_status" text,
	"previous_comment" text,
	"new_comment" text,
	"reason" text,
	"performed_by" text NOT NULL,
	"performed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "application_controls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"control_id" uuid NOT NULL,
	"technology_element_id" uuid,
	"status" text,
	"auto_reason" text,
	"establishment" text DEFAULT 'not_established' NOT NULL,
	"routine_compliance" text DEFAULT 'not_applicable' NOT NULL,
	"routines_established" integer DEFAULT 0 NOT NULL,
	"routines_completed" integer DEFAULT 0 NOT NULL,
	"routines_overdue" integer DEFAULT 0 NOT NULL,
	"match_sources" text[],
	"matching_routine_ids" uuid[],
	"is_screening_derived" boolean DEFAULT true NOT NULL,
	"comment" text,
	"comment_updated_at" timestamp with time zone,
	"comment_updated_by" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"deactivated_at" timestamp with time zone,
	"deactivated_reason" text,
	"activated_at" timestamp with time zone DEFAULT now(),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "uq_app_control" UNIQUE("application_id","control_id","technology_element_id")
);
--> statement-breakpoint
ALTER TABLE "application_control_history" ADD CONSTRAINT "application_control_history_application_control_id_application_controls_id_fk" FOREIGN KEY ("application_control_id") REFERENCES "public"."application_controls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_controls" ADD CONSTRAINT "application_controls_application_id_monitored_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."monitored_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_controls" ADD CONSTRAINT "application_controls_control_id_framework_controls_id_fk" FOREIGN KEY ("control_id") REFERENCES "public"."framework_controls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_controls" ADD CONSTRAINT "application_controls_technology_element_id_technology_elements_id_fk" FOREIGN KEY ("technology_element_id") REFERENCES "public"."technology_elements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_app_controls_app_active" ON "application_controls" ("application_id") WHERE is_active = true;--> statement-breakpoint
CREATE INDEX "idx_app_controls_control_id" ON "application_controls" ("control_id");--> statement-breakpoint
CREATE INDEX "idx_app_control_history_ac_id" ON "application_control_history" ("application_control_id");