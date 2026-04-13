CREATE TABLE IF NOT EXISTS "screening_question_technology_elements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_id" uuid NOT NULL,
	"element_id" uuid NOT NULL,
	CONSTRAINT "screening_question_technology_elements_question_id_element_id_unique" UNIQUE("question_id","element_id")
);

ALTER TABLE "screening_question_technology_elements"
  ADD CONSTRAINT "screening_question_technology_elements_question_id_screening_questions_id_fk"
  FOREIGN KEY ("question_id") REFERENCES "public"."screening_questions"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "screening_question_technology_elements"
  ADD CONSTRAINT "screening_question_technology_elements_element_id_technology_elements_id_fk"
  FOREIGN KEY ("element_id") REFERENCES "public"."technology_elements"("id") ON DELETE cascade ON UPDATE no action;
