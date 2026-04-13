CREATE TABLE "screening_routine_selections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"choice_effect_id" uuid NOT NULL,
	"routine_id" uuid,
	"selected_by" text NOT NULL,
	"selected_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "screening_routine_selections_application_id_choice_effect_id_unique" UNIQUE("application_id","choice_effect_id")
);
--> statement-breakpoint
ALTER TABLE "screening_routine_selections" ADD CONSTRAINT "screening_routine_selections_application_id_monitored_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."monitored_applications"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "screening_routine_selections" ADD CONSTRAINT "screening_routine_selections_choice_effect_id_screening_choice_effects_id_fk" FOREIGN KEY ("choice_effect_id") REFERENCES "public"."screening_choice_effects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "screening_routine_selections" ADD CONSTRAINT "screening_routine_selections_routine_id_routines_id_fk" FOREIGN KEY ("routine_id") REFERENCES "public"."routines"("id") ON DELETE set null ON UPDATE no action;
