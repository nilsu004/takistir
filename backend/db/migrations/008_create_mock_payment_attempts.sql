BEGIN;

ALTER TABLE orders ADD CONSTRAINT orders_payment_identity_unique
    UNIQUE (customer_id, checkout_key, id);

CREATE TABLE mock_payment_attempts (
    id UUID PRIMARY KEY,
    customer_id VARCHAR(60) NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    checkout_key VARCHAR(100) NOT NULL CHECK (btrim(checkout_key) <> ''),
    attempt_key VARCHAR(100) NOT NULL CHECK (btrim(attempt_key) <> ''),
    outcome VARCHAR(10) NOT NULL CHECK (outcome IN ('succeeded', 'failed')),
    amount NUMERIC(24,2) NOT NULL CHECK (
        amount >= 0 AND amount <> 'NaN'::numeric
        AND amount <> 'Infinity'::numeric
    ),
    currency CHAR(3) NOT NULL DEFAULT 'TRY' CHECK (currency = 'TRY'),
    order_id VARCHAR(40),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT payment_attempt_key_unique UNIQUE (customer_id, attempt_key),
    CONSTRAINT payment_order_matches_checkout
        FOREIGN KEY (customer_id, checkout_key, order_id)
        REFERENCES orders(customer_id, checkout_key, id) ON DELETE RESTRICT,
    CONSTRAINT payment_outcome_matches_order CHECK (
        (outcome = 'succeeded' AND order_id IS NOT NULL)
        OR (outcome = 'failed' AND order_id IS NULL)
    )
);

CREATE UNIQUE INDEX payment_one_success_per_checkout
    ON mock_payment_attempts(customer_id, checkout_key)
    WHERE outcome = 'succeeded';
CREATE INDEX payment_checkout_history
    ON mock_payment_attempts(customer_id, checkout_key, created_at);

COMMIT;
