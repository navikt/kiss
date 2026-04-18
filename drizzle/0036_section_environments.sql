CREATE TABLE "section_environments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"section_id" uuid NOT NULL,
	"cluster" text NOT NULL,
	"included" boolean DEFAULT true NOT NULL,
	"added_by" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT 'migration' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_section_environments_cluster" UNIQUE("section_id","cluster")
);

ALTER TABLE "section_environments" ADD CONSTRAINT "section_environments_section_id_sections_id_fk"
  FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE cascade ON UPDATE no action;

CREATE INDEX "section_environments_active_idx" ON "section_environments" ("section_id") WHERE included = true;

-- Seed: all currently-discovered (section, cluster) pairs as included=true
INSERT INTO section_environments (section_id, cluster, included, added_by, added_at, updated_by, updated_at)
SELECT DISTINCT nt.section_id, ae.cluster, true, 'migration', NOW(), 'migration', NOW()
FROM application_environments ae
JOIN nais_teams nt ON ae.nais_team_id = nt.id
WHERE nt.section_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Mark currently-excluded clusters as included=false
INSERT INTO section_environments (section_id, cluster, included, added_by, added_at, updated_by, updated_at)
SELECT section_id, cluster, false, 'migration', NOW(), 'migration', NOW()
FROM section_excluded_environments
ON CONFLICT (section_id, cluster) DO UPDATE SET included = false, updated_by = 'migration', updated_at = NOW();
