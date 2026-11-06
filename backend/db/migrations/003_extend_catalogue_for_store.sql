-- Store-facing catalogue fields used by the Express API.
-- Builds on 001 (Mahmut) without changing it. Safe on an empty database and on
-- one that already contains seed rows: new NOT NULL columns get defaults first.
BEGIN;

-- Public product code shown in URLs, carts and orders (for example TK-001).
-- The integer id stays the internal primary/foreign key.
CREATE SEQUENCE product_code_seq;

ALTER TABLE products
    ADD COLUMN code VARCHAR(40) NOT NULL
        DEFAULT ('PRD-' || lpad(nextval('product_code_seq')::TEXT, 4, '0')),
    ADD COLUMN material VARCHAR(160) NOT NULL DEFAULT '',
    ADD COLUMN image VARCHAR(100) NOT NULL DEFAULT 'necklace-card.svg',
    ADD COLUMN detail_image VARCHAR(100),
    ADD COLUMN collection VARCHAR(100) NOT NULL DEFAULT 'New arrivals',
    ADD COLUMN popularity INTEGER NOT NULL DEFAULT 0,
    -- Historical rating aggregate imported with the catalogue; approved reviews
    -- are added on top of it by the application.
    ADD COLUMN seed_rating NUMERIC(3, 2) NOT NULL DEFAULT 0,
    ADD COLUMN seed_rating_count INTEGER NOT NULL DEFAULT 0,
    -- Removed products are archived so past orders and invoices keep working.
    ADD COLUMN archived BOOLEAN NOT NULL DEFAULT FALSE,
    ADD CONSTRAINT products_code_format CHECK (code ~ '^[A-Za-z0-9-]{1,40}$'),
    ADD CONSTRAINT products_popularity_nonnegative CHECK (popularity >= 0),
    ADD CONSTRAINT products_seed_rating_range CHECK (seed_rating BETWEEN 0 AND 5),
    ADD CONSTRAINT products_seed_rating_count_nonnegative CHECK (seed_rating_count >= 0);

CREATE UNIQUE INDEX products_code_unique_ci ON products (lower(code));

-- Requirement 11: sales managers set prices. A product added by a product
-- manager has no price (NULL) until then and cannot be purchased.
ALTER TABLE products ALTER COLUMN price DROP NOT NULL;

-- Categories are referenced by name in the API, so names must be unique
-- (case-insensitive). Deleting a category archives it, because archived
-- products still reference it.
ALTER TABLE categories
    ADD COLUMN archived BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX categories_name_unique_ci ON categories (lower(btrim(name)));

COMMENT ON COLUMN products.code IS 'Public product identifier used by the API (immutable).';
COMMENT ON COLUMN products.price IS 'NULL until a sales manager sets the price; unpriced products cannot be ordered.';

COMMIT;
