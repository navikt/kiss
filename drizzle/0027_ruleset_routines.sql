CREATE TABLE "ruleset_routines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ruleset_id" uuid NOT NULL,
	"routine_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ruleset_routines_ruleset_id_rulesets_id_fk" FOREIGN KEY ("ruleset_id") REFERENCES "rulesets"("id") ON DELETE cascade,
	CONSTRAINT "ruleset_routines_routine_id_routines_id_fk" FOREIGN KEY ("routine_id") REFERENCES "routines"("id") ON DELETE cascade
);
