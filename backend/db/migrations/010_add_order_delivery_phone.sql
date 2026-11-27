BEGIN;

-- Checkout stores the contact number with the order so later changes to a
-- customer's account do not change the delivery details.
ALTER TABLE orders ADD COLUMN delivery_phone VARCHAR(40);

COMMIT;
