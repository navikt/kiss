-- Støtter getLastFinishedSyncJobAt() (ORDER BY finished_at DESC LIMIT 1 per jobType),
-- kalt hver scheduler-syklus for hver enkelt aktivert synk-jobb.
CREATE INDEX IF NOT EXISTS sync_jobs_type_finished_at_idx
	ON sync_jobs (job_type, finished_at DESC);
