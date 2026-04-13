-- Simplify screening choices: remove `value` column, use `label` everywhere.
-- Step 1: Migrate screening_answers.answer from value to label where they differ.
UPDATE screening_answers sa
SET answer = sqc.label
FROM screening_question_choices sqc
WHERE sqc.question_id = sa.question_id
  AND sqc.value = sa.answer
  AND sqc.value != sqc.label;

-- Step 2: Migrate routines.screening_choice_value from value to label.
UPDATE routines r
SET screening_choice_value = sqc.label
FROM screening_question_choices sqc
WHERE sqc.question_id = r.screening_question_id
  AND sqc.value = r.screening_choice_value
  AND sqc.value != sqc.label;

-- Step 3: Migrate routine_screening_questions.choice_value from value to label.
UPDATE routine_screening_questions rsq
SET choice_value = sqc.label
FROM screening_question_choices sqc
WHERE sqc.question_id = rsq.question_id
  AND sqc.value = rsq.choice_value
  AND sqc.value != sqc.label;

-- Step 4: Drop the value column.
ALTER TABLE screening_question_choices DROP COLUMN "value";
