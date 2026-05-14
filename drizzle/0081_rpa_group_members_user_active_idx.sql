CREATE INDEX IF NOT EXISTS rpa_group_members_user_active_idx
ON rpa_group_members (user_object_id)
WHERE archived_at IS NULL;
