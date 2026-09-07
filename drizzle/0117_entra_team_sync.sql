ALTER TABLE dev_teams ADD COLUMN IF NOT EXISTS entra_group_id TEXT;
ALTER TABLE dev_teams ADD COLUMN IF NOT EXISTS entra_group_name TEXT;

-- Én Entra-gruppe kan kun kobles til ett aktivt team (1:1)
CREATE UNIQUE INDEX IF NOT EXISTS dev_teams_entra_group_active_unique_idx
	ON dev_teams (entra_group_id)
	WHERE entra_group_id IS NOT NULL AND archived_at IS NULL;

CREATE TABLE IF NOT EXISTS dev_team_entra_members (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	dev_team_id UUID NOT NULL REFERENCES dev_teams(id) ON DELETE RESTRICT,
	nav_ident TEXT NOT NULL,
	display_name TEXT,
	mail TEXT,
	synced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
	created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
	created_by TEXT NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
	updated_by TEXT NOT NULL,
	archived_at TIMESTAMP WITH TIME ZONE,
	archived_by TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS dev_team_entra_members_active_unique_idx
	ON dev_team_entra_members (dev_team_id, nav_ident)
	WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS dev_team_entra_members_nav_ident_active_idx
	ON dev_team_entra_members (nav_ident)
	WHERE archived_at IS NULL;
