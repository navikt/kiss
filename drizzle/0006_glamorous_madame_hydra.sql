CREATE TABLE "ruleset_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ruleset_id" uuid NOT NULL,
	"approved_by" text NOT NULL,
	"approved_by_name" text NOT NULL,
	"comment" text,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ruleset_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ruleset_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"bucket_path" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer,
	"uploaded_by" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ruleset_controls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ruleset_id" uuid NOT NULL,
	"control_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rulesets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"section_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"responsible_ident" text,
	"responsible_name" text,
	"frequency" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "rulesets_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "ruleset_approvals" ADD CONSTRAINT "ruleset_approvals_ruleset_id_rulesets_id_fk" FOREIGN KEY ("ruleset_id") REFERENCES "public"."rulesets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ruleset_attachments" ADD CONSTRAINT "ruleset_attachments_ruleset_id_rulesets_id_fk" FOREIGN KEY ("ruleset_id") REFERENCES "public"."rulesets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ruleset_controls" ADD CONSTRAINT "ruleset_controls_ruleset_id_rulesets_id_fk" FOREIGN KEY ("ruleset_id") REFERENCES "public"."rulesets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ruleset_controls" ADD CONSTRAINT "ruleset_controls_control_id_framework_controls_id_fk" FOREIGN KEY ("control_id") REFERENCES "public"."framework_controls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rulesets" ADD CONSTRAINT "rulesets_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE cascade ON UPDATE no action;