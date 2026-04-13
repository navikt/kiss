-- Add responsible role to routines
ALTER TABLE "routines" ADD COLUMN "responsible_role" text;

-- Junction table: routine ↔ framework control
CREATE TABLE "routine_controls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"routine_id" uuid NOT NULL,
	"control_id" uuid NOT NULL
);

ALTER TABLE "routine_controls"
  ADD CONSTRAINT "routine_controls_routine_id_routines_id_fk"
  FOREIGN KEY ("routine_id") REFERENCES "routines"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "routine_controls"
  ADD CONSTRAINT "routine_controls_control_id_framework_controls_id_fk"
  FOREIGN KEY ("control_id") REFERENCES "framework_controls"("id") ON DELETE cascade ON UPDATE no action;
