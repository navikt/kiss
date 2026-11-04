CREATE TABLE IF NOT EXISTS github_access_sync_status (
	application_id UUID PRIMARY KEY REFERENCES monitored_applications(id) ON DELETE CASCADE,
	git_repository TEXT NOT NULL,
	last_success_at TIMESTAMP WITH TIME ZONE NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
	created_by TEXT NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
	updated_by TEXT NOT NULL
);
