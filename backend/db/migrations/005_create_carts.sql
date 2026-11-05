-- SCRUM-48 cart schema as agreed by the team (owner: Mahmut).
-- Added with SCRUM-49 so the cart API can be built and tested in parallel;
-- replace this file with Mahmut's version if it differs before merging.
BEGIN;

-- A cart belongs to exactly one owner: a signed-in customer or a guest.
-- Guests are identified by an opaque cookie token stored only as a SHA-256 hash.
CREATE TABLE carts (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    customer_id VARCHAR(60) UNIQUE REFERENCES users (id) ON DELETE CASCADE,
    guest_token_hash CHAR(64) UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT carts_exactly_one_owner CHECK (
        (customer_id IS NULL) <> (guest_token_hash IS NULL)
    )
);

-- Guest carts expire after 30 days without changes.
CREATE INDEX carts_guest_updated_at_idx ON carts (updated_at)
    WHERE guest_token_hash IS NOT NULL;

-- One row per product per cart. The cart does not reserve stock; checkout
-- checks and decreases stock in its own transaction.
CREATE TABLE cart_items (
    cart_id BIGINT NOT NULL REFERENCES carts (id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products (id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL,
    added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (cart_id, product_id),
    CONSTRAINT cart_items_quantity_positive CHECK (quantity > 0)
);

CREATE INDEX cart_items_product_id_idx ON cart_items (product_id);

COMMIT;
