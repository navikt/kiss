ALTER TABLE "screening_choice_effects" ADD COLUMN IF NOT EXISTS "preset_routine_id" uuid;

ALTER TABLE "screening_choice_effects" DROP CONSTRAINT IF EXISTS "screening_choice_effects_preset_routine_id_fk";
ALTER TABLE "screening_choice_effects" ADD CONSTRAINT "screening_choice_effects_preset_routine_id_fk" FOREIGN KEY ("preset_routine_id") REFERENCES "routines"("id");

-- Two-way CHECK constraint: preset_routine ↔ preset_routine_id IS NOT NULL
ALTER TABLE "screening_choice_effects" DROP CONSTRAINT IF EXISTS "screening_choice_effects_preset_routine_requires_id";
ALTER TABLE "screening_choice_effects" ADD CONSTRAINT "screening_choice_effects_preset_routine_requires_id"
    CHECK (
        CASE WHEN effect = 'preset_routine' THEN preset_routine_id IS NOT NULL
             ELSE preset_routine_id IS NULL
        END
    );
