-- SCRUM-69: ratings and comments follow different visibility rules.
-- Requirement 5: a rating is published directly, a comment only after
-- product manager approval. A customer may therefore rate without commenting.
BEGIN;

ALTER TABLE reviews ALTER COLUMN comment DROP NOT NULL;

-- An empty comment is stored as NULL, never as blank text.
ALTER TABLE reviews ADD CONSTRAINT reviews_comment_not_blank
    CHECK (comment IS NULL OR btrim(comment) <> '');

-- A rating-only review has nothing to moderate, so it is always Approved.
-- Only rows that carry a comment can be Pending or Rejected.
ALTER TABLE reviews ADD CONSTRAINT reviews_rating_only_is_approved
    CHECK (comment IS NOT NULL OR status = 'Approved');

COMMIT;
