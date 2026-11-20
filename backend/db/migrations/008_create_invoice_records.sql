BEGIN;

CREATE TABLE invoices (
    order_id VARCHAR(40) PRIMARY KEY REFERENCES orders(id) ON DELETE RESTRICT,
    number VARCHAR(50) NOT NULL UNIQUE,
    customer_name VARCHAR(160) NOT NULL,
    customer_email VARCHAR(254) NOT NULL,
    tax_id VARCHAR(40) NOT NULL,
    delivery_address VARCHAR(600) NOT NULL,
    order_date DATE NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'TRY' CHECK (currency = 'TRY'),
    total NUMERIC(24,2) NOT NULL CHECK (
        total >= 0 AND total <> 'NaN'::numeric
    ),
    captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE invoice_items (
    order_id VARCHAR(40) NOT NULL REFERENCES invoices(order_id) ON DELETE RESTRICT,
    position SMALLINT NOT NULL CHECK (position >= 0),
    product_code VARCHAR(40) NOT NULL,
    product_name VARCHAR(255) NOT NULL,
    product_image VARCHAR(100) NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(12,2) NOT NULL CHECK (
        unit_price >= 0 AND unit_price <> 'NaN'::numeric
    ),
    PRIMARY KEY (order_id, position),
    UNIQUE (order_id, product_code)
);

CREATE TABLE invoice_emails (
    order_id VARCHAR(40) PRIMARY KEY REFERENCES invoices(order_id) ON DELETE RESTRICT,
    status VARCHAR(10) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    claim_token UUID,
    lease_until TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT invoice_email_claim_state CHECK (
        (status = 'sending' AND claim_token IS NOT NULL AND lease_until IS NOT NULL)
        OR (status <> 'sending' AND claim_token IS NULL AND lease_until IS NULL)
    ),
    CONSTRAINT invoice_email_sent_state CHECK (
        (status = 'sent' AND sent_at IS NOT NULL)
        OR (status <> 'sent' AND sent_at IS NULL)
    )
);
CREATE INDEX invoice_email_pending ON invoice_emails(status, lease_until);

-- Imported orders capture the customer details available during this upgrade.
INSERT INTO invoices
    (order_id, number, customer_name, customer_email, tax_id, delivery_address, order_date, total)
SELECT o.id, 'TK-F-' || regexp_replace(o.id, '^TK-', ''), u.name, u.email, u.tax_id, o.delivery_address, o.order_date,
    sum(i.quantity * i.unit_price)
FROM orders o JOIN users u ON u.id = o.customer_id
JOIN order_items i ON i.order_id = o.id
GROUP BY o.id, u.id;

INSERT INTO invoice_items
    (order_id, position, product_code, product_name, product_image, quantity, unit_price)
SELECT i.order_id, i.position, p.code, i.product_name, i.product_image,
    i.quantity, i.unit_price
FROM order_items i JOIN products p ON p.id = i.product_id
JOIN invoices v ON v.order_id = i.order_id;

-- Imported orders are available on screen. Email is queued for new checkouts.
COMMIT;
