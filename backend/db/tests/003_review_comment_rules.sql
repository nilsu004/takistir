-- SCRUM-69: tests for rating-only reviews and comment moderation rules
-- Run against a migrated database. Everything is rolled back at the end.
BEGIN;

INSERT INTO categories (name) VALUES ('Zxqtest Reviews');

INSERT INTO products (category_id, name, model, serial_number, description,
                      stock_quantity, price, warranty_status, distributor)
SELECT c.id, 'Zxqtest Ring', 'T-RV', 'TEST-RV-0001', 'Review test product',
       1, 100.00, '1 year', 'Test Distributor'
FROM categories c WHERE c.name = 'Zxqtest Reviews';

CREATE FUNCTION pg_temp.try_review(review_id TEXT, review_comment TEXT, review_status TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO reviews (id, product_id, author_name, rating, comment, status)
    SELECT review_id, p.id, 'Zxqtest', 4, review_comment, review_status
    FROM products p WHERE p.serial_number = 'TEST-RV-0001';
    RETURN TRUE;
EXCEPTION WHEN check_violation THEN
    RETURN FALSE;
END;
$$;

DO $$
BEGIN
    -- a rating without a comment is accepted when it is Approved
    ASSERT pg_temp.try_review('zxq-1', NULL, 'Approved'),
        'Test 1 failed: rating-only review should be accepted';

    -- a rating-only review cannot wait for moderation
    ASSERT NOT pg_temp.try_review('zxq-2', NULL, 'Pending'),
        'Test 2 failed: rating-only review must not be Pending';

    -- a rating-only review cannot be Rejected either
    ASSERT NOT pg_temp.try_review('zxq-3', NULL, 'Rejected'),
        'Test 3 failed: rating-only review must not be Rejected';

    -- blank comments are rejected (they should be stored as NULL)
    ASSERT NOT pg_temp.try_review('zxq-4', '   ', 'Pending'),
        'Test 4 failed: blank comment should be rejected';

    -- a review with a comment still starts as Pending
    ASSERT pg_temp.try_review('zxq-5', 'Nice ring', 'Pending'),
        'Test 5 failed: commented review should be accepted as Pending';

    RAISE NOTICE 'All review comment rule tests passed';
END;
$$;

ROLLBACK;
