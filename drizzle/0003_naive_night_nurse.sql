CREATE TABLE "routine_screening_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"routine_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"choice_value" text
);
--> statement-breakpoint
ALTER TABLE "routine_screening_questions" ADD CONSTRAINT "routine_screening_questions_routine_id_routines_id_fk" FOREIGN KEY ("routine_id") REFERENCES "public"."routines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routine_screening_questions" ADD CONSTRAINT "routine_screening_questions_question_id_screening_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."screening_questions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
INSERT INTO "routine_screening_questions" ("routine_id", "question_id", "choice_value")
SELECT "id", "screening_question_id", "screening_choice_value"
FROM "routines"
WHERE "screening_question_id" IS NOT NULL;