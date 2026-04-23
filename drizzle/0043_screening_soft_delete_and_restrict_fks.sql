-- Soft-delete for screening: nye archived_at/archived_by-kolonner på
-- screening_questions, screening_question_choices og screening_choice_effects.
-- FK-er som peker til disse tabellene konverteres fra ON DELETE CASCADE
-- til ON DELETE RESTRICT slik at fysisk DELETE blir umulig så lenge det
-- finnes barn (svar, valg, effekter, rutinevalg).
--
-- Samme mønster som migrasjon 0040 (sections), 0041 (monitored_applications)
-- og 0042 (routines). Soft-delete bevarer audit-trail (AGENTS.md regel 5)
-- og brukernes svar/rutinevalg.
--
-- Migrasjonen er idempotent (IF NOT EXISTS / IF EXISTS) og bruker
-- ADD CONSTRAINT ... NOT VALID + VALIDATE CONSTRAINT for å minimere
-- lock-tid (se 0040-kommentaren for forbehold under Drizzle-batch-tx).

-- ── Nye kolonner ────────────────────────────────────────────────────────
ALTER TABLE "screening_questions" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "screening_questions" ADD COLUMN IF NOT EXISTS "archived_by" text;
--> statement-breakpoint

ALTER TABLE "screening_question_choices" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "screening_question_choices" ADD COLUMN IF NOT EXISTS "archived_by" text;
--> statement-breakpoint

ALTER TABLE "screening_choice_effects" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "screening_choice_effects" ADD COLUMN IF NOT EXISTS "archived_by" text;
--> statement-breakpoint

-- ── FK-er fra barn til screening_questions (cascade -> restrict) ────────
-- Drizzle bruker default-navn "<tabell>_<kolonne>_<refTabell>_<refKol>_fk".
-- Vi dropper også eldre Postgres-default ..._fkey-varianter for å unngå
-- duplikater.

-- screening_question_choices.question_id
ALTER TABLE "screening_question_choices" DROP CONSTRAINT IF EXISTS "screening_question_choices_question_id_screening_questions_id_fk";
--> statement-breakpoint
ALTER TABLE "screening_question_choices" DROP CONSTRAINT IF EXISTS "screening_question_choices_question_id_fkey";
--> statement-breakpoint
ALTER TABLE "screening_question_choices" ADD CONSTRAINT "screening_question_choices_question_id_screening_questions_id_fk"
	FOREIGN KEY ("question_id") REFERENCES "public"."screening_questions"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "screening_question_choices" VALIDATE CONSTRAINT "screening_question_choices_question_id_screening_questions_id_fk";
--> statement-breakpoint

-- screening_answers.question_id
ALTER TABLE "screening_answers" DROP CONSTRAINT IF EXISTS "screening_answers_question_id_screening_questions_id_fk";
--> statement-breakpoint
ALTER TABLE "screening_answers" DROP CONSTRAINT IF EXISTS "screening_answers_question_id_fkey";
--> statement-breakpoint
ALTER TABLE "screening_answers" ADD CONSTRAINT "screening_answers_question_id_screening_questions_id_fk"
	FOREIGN KEY ("question_id") REFERENCES "public"."screening_questions"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "screening_answers" VALIDATE CONSTRAINT "screening_answers_question_id_screening_questions_id_fk";
--> statement-breakpoint

-- screening_question_effects.question_id (legacy-tabell, men FK må også
-- være RESTRICT for konsistens med øvrige barn av screening_questions)
ALTER TABLE "screening_question_effects" DROP CONSTRAINT IF EXISTS "screening_question_effects_question_id_screening_questions_id_fk";
--> statement-breakpoint
ALTER TABLE "screening_question_effects" DROP CONSTRAINT IF EXISTS "screening_question_effects_question_id_fkey";
--> statement-breakpoint
ALTER TABLE "screening_question_effects" ADD CONSTRAINT "screening_question_effects_question_id_screening_questions_id_fk"
	FOREIGN KEY ("question_id") REFERENCES "public"."screening_questions"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "screening_question_effects" VALIDATE CONSTRAINT "screening_question_effects_question_id_screening_questions_id_fk";
--> statement-breakpoint

-- screening_question_technology_elements.question_id
ALTER TABLE "screening_question_technology_elements" DROP CONSTRAINT IF EXISTS "screening_question_technology_elements_question_id_screening_questions_id_fk";
--> statement-breakpoint
ALTER TABLE "screening_question_technology_elements" DROP CONSTRAINT IF EXISTS "screening_question_technology_elements_question_id_fkey";
--> statement-breakpoint
ALTER TABLE "screening_question_technology_elements" ADD CONSTRAINT "screening_question_technology_elements_question_id_screening_questions_id_fk"
	FOREIGN KEY ("question_id") REFERENCES "public"."screening_questions"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "screening_question_technology_elements" VALIDATE CONSTRAINT "screening_question_technology_elements_question_id_screening_questions_id_fk";
--> statement-breakpoint

-- routine_screening_questions.question_id
ALTER TABLE "routine_screening_questions" DROP CONSTRAINT IF EXISTS "routine_screening_questions_question_id_screening_questions_id_fk";
--> statement-breakpoint
ALTER TABLE "routine_screening_questions" DROP CONSTRAINT IF EXISTS "routine_screening_questions_question_id_fkey";
--> statement-breakpoint
ALTER TABLE "routine_screening_questions" ADD CONSTRAINT "routine_screening_questions_question_id_screening_questions_id_fk"
	FOREIGN KEY ("question_id") REFERENCES "public"."screening_questions"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "routine_screening_questions" VALIDATE CONSTRAINT "routine_screening_questions_question_id_screening_questions_id_fk";
--> statement-breakpoint

-- ── FK-er fra barn til screening_question_choices (cascade -> restrict) ─

-- screening_choice_effects.choice_id
ALTER TABLE "screening_choice_effects" DROP CONSTRAINT IF EXISTS "screening_choice_effects_choice_id_screening_question_choices_id_fk";
--> statement-breakpoint
ALTER TABLE "screening_choice_effects" DROP CONSTRAINT IF EXISTS "screening_choice_effects_choice_id_fkey";
--> statement-breakpoint
ALTER TABLE "screening_choice_effects" ADD CONSTRAINT "screening_choice_effects_choice_id_screening_question_choices_id_fk"
	FOREIGN KEY ("choice_id") REFERENCES "public"."screening_question_choices"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "screening_choice_effects" VALIDATE CONSTRAINT "screening_choice_effects_choice_id_screening_question_choices_id_fk";
--> statement-breakpoint

-- ── FK-er fra barn til screening_choice_effects (cascade -> restrict) ───

-- screening_routine_selections.choice_effect_id
ALTER TABLE "screening_routine_selections" DROP CONSTRAINT IF EXISTS "screening_routine_selections_choice_effect_id_screening_choice_effects_id_fk";
--> statement-breakpoint
ALTER TABLE "screening_routine_selections" DROP CONSTRAINT IF EXISTS "screening_routine_selections_choice_effect_id_fkey";
--> statement-breakpoint
ALTER TABLE "screening_routine_selections" ADD CONSTRAINT "screening_routine_selections_choice_effect_id_screening_choice_effects_id_fk"
	FOREIGN KEY ("choice_effect_id") REFERENCES "public"."screening_choice_effects"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "screening_routine_selections" VALIDATE CONSTRAINT "screening_routine_selections_choice_effect_id_screening_choice_effects_id_fk";
