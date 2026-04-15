CREATE TABLE "section_excluded_environments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"section_id" uuid NOT NULL,
	"cluster" text NOT NULL,
	"excluded_by" text NOT NULL,
	"excluded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_section_cluster" UNIQUE("section_id","cluster")
);

ALTER TABLE "section_excluded_environments" ADD CONSTRAINT "section_excluded_environments_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE no action ON UPDATE no action;
