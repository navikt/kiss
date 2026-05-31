ALTER TABLE "routine_reviews" ADD COLUMN IF NOT EXISTS "inherited_from_review_id" uuid;
ALTER TABLE "routine_reviews" DROP CONSTRAINT IF EXISTS "routine_reviews_inherited_from_review_id_fkey";
ALTER TABLE "routine_reviews" ADD CONSTRAINT "routine_reviews_inherited_from_review_id_fkey" FOREIGN KEY ("inherited_from_review_id") REFERENCES "routine_reviews"("id") ON DELETE SET NULL;
