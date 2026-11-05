-- Accounts, sessions, orders/deliveries, returns and reviews.
-- Requirements 3, 4, 5, 10, 12, 14, 16 and 17.
BEGIN;

CREATE TABLE users (
    id VARCHAR(60) PRIMARY KEY,
    name VARCHAR(160) NOT NULL,
    email VARCHAR(254) NOT NULL,
    home_address VARCHAR(500) NOT NULL DEFAULT '',
    tax_id VARCHAR(40) NOT NULL DEFAULT '',
    role VARCHAR(30) NOT NULL,
    -- scrypt "salt:hash" in hex; plain passwords are never stored.
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT users_name_not_blank CHECK (btrim(name) <> ''),
    CONSTRAINT users_email_lowercase CHECK (email = lower(email) AND email <> ''),
    CONSTRAINT users_role_valid CHECK (
        role IN ('customer', 'product-manager', 'sales-manager', 'support-agent')
    )
);

CREATE UNIQUE INDEX users_email_unique ON users (email);

-- Opaque session tokens are stored only as SHA-256 hashes.
CREATE TABLE sessions (
    token_hash CHAR(64) PRIMARY KEY,
    user_id VARCHAR(60) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

-- Order numbers continue after the demo orders (TK-1025, TK-1026, ...).
CREATE SEQUENCE order_number_seq START WITH 1025;

CREATE TABLE orders (
    id VARCHAR(40) PRIMARY KEY,
    -- Insertion order; history lists the newest order first.
    seq BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    customer_id VARCHAR(60) NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    delivery_id VARCHAR(50) NOT NULL UNIQUE,
    order_date DATE NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'Processing',
    delivery_address VARCHAR(600) NOT NULL,
    tracking_number VARCHAR(60),
    -- Idempotency key sent by the checkout page; a retried request returns
    -- the existing order instead of charging/decrementing stock twice.
    checkout_key VARCHAR(100),
    -- FALSE for imported demo orders whose stock was never decremented here.
    inventory_reserved BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT orders_status_valid CHECK (
        status IN ('Processing', 'In transit', 'Delivered', 'Cancelled')
    ),
    CONSTRAINT orders_checkout_key_unique UNIQUE (customer_id, checkout_key)
);

CREATE INDEX orders_customer_id_idx ON orders (customer_id);

-- Name, image and unit price are copied at purchase time so invoices and
-- refunds keep the paid (possibly discounted) price.
CREATE TABLE order_items (
    order_id VARCHAR(40) NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
    position SMALLINT NOT NULL,
    product_name VARCHAR(255) NOT NULL,
    product_image VARCHAR(100) NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price NUMERIC(12, 2) NOT NULL,
    PRIMARY KEY (order_id, product_id),
    CONSTRAINT order_items_quantity_positive CHECK (quantity > 0),
    CONSTRAINT order_items_unit_price_nonnegative CHECK (unit_price >= 0)
);

CREATE INDEX order_items_product_id_idx ON order_items (product_id);

-- One return request per order (requirement 16).
CREATE TABLE return_requests (
    id VARCHAR(60) PRIMARY KEY,
    order_id VARCHAR(40) NOT NULL UNIQUE REFERENCES orders (id) ON DELETE CASCADE,
    status VARCHAR(30) NOT NULL DEFAULT 'Awaiting item',
    amount NUMERIC(12, 2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT return_requests_amount_nonnegative CHECK (amount >= 0)
);

CREATE TABLE return_request_items (
    return_id VARCHAR(60) NOT NULL REFERENCES return_requests (id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL,
    PRIMARY KEY (return_id, product_id),
    CONSTRAINT return_request_items_quantity_positive CHECK (quantity > 0)
);

CREATE TABLE reviews (
    id VARCHAR(60) PRIMARY KEY,
    seq BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    product_id INTEGER NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
    -- NULL for imported reviews whose author has no account here.
    customer_id VARCHAR(60) REFERENCES users (id) ON DELETE SET NULL,
    author_name VARCHAR(160) NOT NULL,
    rating SMALLINT NOT NULL,
    comment VARCHAR(500) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'Pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT reviews_rating_range CHECK (rating BETWEEN 1 AND 5),
    CONSTRAINT reviews_status_valid CHECK (status IN ('Pending', 'Approved', 'Rejected'))
);

CREATE INDEX reviews_product_id_idx ON reviews (product_id);

-- Increases after every committed change; the frontend uses it to ignore
-- responses that are older than the state it already shows.
CREATE SEQUENCE state_revision;

COMMIT;
