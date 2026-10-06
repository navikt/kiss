CREATE TABLE IF NOT EXISTS github_access_assessments (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	application_id UUID NOT NULL REFERENCES monitored_applications(id) ON DELETE RESTRICT,
	username TEXT NOT NULL,
	last_known_permission TEXT,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
	created_by TEXT NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
	updated_by TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_github_access_assessments_app_user
	ON github_access_assessments (application_id, username);

CREATE INDEX IF NOT EXISTS idx_github_access_assessments_app
	ON github_access_assessments (application_id);
