CREATE TABLE IF NOT EXISTS routine_review_follow_up_point_links (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	review_id uuid NOT NULL REFERENCES routine_reviews(id) ON DELETE CASCADE,
	point_id uuid NOT NULL REFERENCES routine_review_follow_up_points(id) ON DELETE CASCADE,
	source_type text NOT NULL,
	subject_username text NOT NULL,
	decision_kind text NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	created_by text NOT NULL,
	updated_at timestamptz NOT NULL DEFAULT now(),
	updated_by text NOT NULL,
	CONSTRAINT routine_review_follow_up_point_links_source_type_check
		CHECK (source_type IN ('github_access_maintenance')),
	CONSTRAINT routine_review_follow_up_point_links_decision_kind_check
		CHECK (decision_kind IN ('remove_access', 'adjust_access'))
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS routine_review_follow_up_point_links_unique_idx
	ON routine_review_follow_up_point_links (review_id, source_type, subject_username, decision_kind);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS routine_review_follow_up_point_links_review_id_idx
	ON routine_review_follow_up_point_links (review_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS routine_review_follow_up_point_links_point_id_idx
	ON routine_review_follow_up_point_links (point_id);
