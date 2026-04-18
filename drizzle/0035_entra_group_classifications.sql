CREATE TABLE IF NOT EXISTS "entra_group_classifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" text NOT NULL,
	"classification" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entra_group_classifications_group_id_unique" UNIQUE("group_id")
);

CREATE TABLE IF NOT EXISTS "routine_group_classification_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"routine_id" uuid NOT NULL,
	"classification" text NOT NULL,
	CONSTRAINT "routine_group_classification_links_routine_id_fk" FOREIGN KEY ("routine_id") REFERENCES "routines"("id") ON DELETE cascade
);
