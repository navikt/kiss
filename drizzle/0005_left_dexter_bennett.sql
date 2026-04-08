-- Remove duplicate link suggestions, keeping only the oldest per pair+matchType
DELETE FROM "link_suggestions" a
  USING "link_suggestions" b
  WHERE a.primary_app_id = b.primary_app_id
    AND a.secondary_app_id = b.secondary_app_id
    AND a.match_type = b.match_type
    AND a.created_at > b.created_at;

ALTER TABLE "link_suggestions" ADD CONSTRAINT "uq_link_suggestion_pair" UNIQUE("primary_app_id","secondary_app_id","match_type");