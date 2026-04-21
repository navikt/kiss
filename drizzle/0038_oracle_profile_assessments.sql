CREATE TABLE "oracle_profile_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"instance_id" text NOT NULL,
	"profile_name" text NOT NULL,
	"criticality" text NOT NULL,
	"assessed_by" text NOT NULL,
	"assessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_oracle_profile_assessment" UNIQUE("application_id","instance_id","profile_name")
);

ALTER TABLE "oracle_profile_assessments" ADD CONSTRAINT "oracle_profile_assessments_application_id_monitored_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."monitored_applications"("id") ON DELETE no action ON UPDATE no action;
