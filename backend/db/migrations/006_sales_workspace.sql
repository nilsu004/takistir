BEGIN;

ALTER TABLE products ADD COLUMN list_price NUMERIC(12,2),
  ADD COLUMN discount_percent INTEGER NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 100);
UPDATE products SET list_price = price;
ALTER TABLE products ADD CONSTRAINT products_list_price_nonnegative
  CHECK (list_price IS NULL OR (list_price >= 0 AND list_price <> 'NaN'::numeric));

-- Preserve historical paid prices. Unknown historical costs use half of that
-- paid unit price, never today's product cost. Explicit zero remains zero.
ALTER TABLE order_items ADD COLUMN unit_cost NUMERIC(12,2);
UPDATE order_items SET unit_cost = round(unit_price * 0.5, 2);
CREATE FUNCTION snapshot_default_cost() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.unit_cost := COALESCE(NEW.unit_cost, round(NEW.unit_price * 0.5, 2));
  RETURN NEW;
END $$;
CREATE TRIGGER order_item_default_cost BEFORE INSERT ON order_items
  FOR EACH ROW EXECUTE FUNCTION snapshot_default_cost();
ALTER TABLE order_items ALTER COLUMN unit_cost SET NOT NULL;
ALTER TABLE order_items ADD CONSTRAINT order_items_cost_nonnegative
  CHECK (unit_cost >= 0 AND unit_cost <> 'NaN'::numeric);

CREATE TABLE wishlist_items (
  customer_id VARCHAR(60) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  PRIMARY KEY(customer_id, product_id)
);
CREATE TABLE demo_notifications (
  id UUID PRIMARY KEY,
  customer_id VARCHAR(60) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_key TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ,
  UNIQUE(customer_id, event_key)
);
CREATE INDEX notifications_customer ON demo_notifications(customer_id, created_at DESC);
CREATE TABLE discount_operations (
  id VARCHAR(100) PRIMARY KEY,
  product_codes TEXT[] NOT NULL,
  percent INTEGER NOT NULL CHECK (percent BETWEEN 0 AND 100),
  actor_id VARCHAR(60) NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE return_requests ADD COLUMN received_at TIMESTAMPTZ,
  ADD COLUMN received_by VARCHAR(60) REFERENCES users(id),
  ADD COLUMN resolved_at TIMESTAMPTZ,
  ADD COLUMN resolved_by VARCHAR(60) REFERENCES users(id),
  ADD COLUMN rejection_reason VARCHAR(500);
ALTER TABLE return_requests ADD CONSTRAINT return_status_valid
  CHECK (status IN ('Awaiting item', 'Received', 'Approved', 'Rejected'));
CREATE TABLE refunds (
  return_id VARCHAR(60) PRIMARY KEY REFERENCES return_requests(id),
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  returned_cost NUMERIC(12,2) NOT NULL CHECK (returned_cost >= 0),
  approved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id VARCHAR(60) NOT NULL REFERENCES users(id)
);
COMMIT;
