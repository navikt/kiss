CREATE TABLE "application_group_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"group_id" text NOT NULL,
	"criticality" text NOT NULL,
	"assessed_by" text NOT NULL,
	"assessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "application_group_assessments_application_id_group_id_unique" UNIQUE("application_id","group_id")
);
--> statement-breakpoint
ALTER TABLE "application_group_assessments" ADD CONSTRAINT "application_group_assessments_application_id_monitored_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."monitored_applications"("id") ON DELETE no action ON UPDATE no action;
