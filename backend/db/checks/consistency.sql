-- SCRUM-72: data consistency checks for catalogue, orders, stock and returns.
--
-- Read-only. Returns one row per problem found; an empty result means the
-- database is consistent. These rules span several tables, so table
-- constraints alone cannot enforce them.
--
-- Run before a demo, after seeding, or after manual SQL changes:
--   docker compose exec -T db psql -U takistir -d takistir < backend/db/checks/consistency.sql
-- The automated test (backend/test/consistency.test.js) runs the same file.

-- 1. An active product must not sit in an archived (deleted) category,
--    otherwise it is sold but cannot be browsed by category.
SELECT 'active_product_in_archived_category' AS check_name,
       p.code AS ref,
       'category ' || c.name || ' is archived' AS detail
FROM products p
JOIN categories c ON c.id = p.category_id
WHERE NOT p.archived AND c.archived

UNION ALL
-- 2. Every order must contain at least one item (invoice, delivery list).
SELECT 'order_without_items', o.id, 'order has no items'
FROM orders o
WHERE NOT EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id)

UNION ALL
-- 3. Orders belong to customers only; staff accounts never buy.
SELECT 'order_by_non_customer', o.id, 'customer_id ' || u.id || ' has role ' || u.role
FROM orders o
JOIN users u ON u.id = o.customer_id
WHERE u.role <> 'customer'

UNION ALL
-- 4. Returns are only possible for delivered orders (requirement 14/16).
SELECT 'return_for_undelivered_order', r.id, 'order ' || o.id || ' is ' || o.status
FROM return_requests r
JOIN orders o ON o.id = r.order_id
WHERE o.status <> 'Delivered'

UNION ALL
-- 5. A returned product must be part of that order, and no more units may be
--    returned than were bought.
SELECT 'return_item_not_in_order_or_too_many', ri.return_id,
       'product ' || ri.product_id || ': returned ' || ri.quantity ||
       ', bought ' || COALESCE(oi.quantity::TEXT, 'none')
FROM return_request_items ri
JOIN return_requests r ON r.id = ri.return_id
LEFT JOIN order_items oi
       ON oi.order_id = r.order_id AND oi.product_id = ri.product_id
WHERE oi.product_id IS NULL OR ri.quantity > oi.quantity

UNION ALL
-- 6. Approved returns have exactly one refund and only approved returns do,
--    so stock is restored and money refunded together.
SELECT 'approved_return_without_refund', r.id, 'status Approved, no refund row'
FROM return_requests r
WHERE r.status = 'Approved'
  AND NOT EXISTS (SELECT 1 FROM refunds f WHERE f.return_id = r.id)

UNION ALL
SELECT 'refund_without_approved_return', f.return_id, 'return status ' || r.status
FROM refunds f
JOIN return_requests r ON r.id = f.return_id
WHERE r.status <> 'Approved'

UNION ALL
-- 7. The refund equals the price paid at purchase (possibly discounted) for
--    the returned units, never today's catalogue price (requirement 16).
SELECT 'refund_amount_mismatch', f.return_id,
       'refund ' || f.amount || ', paid for returned units ' || paid.amount
FROM refunds f
JOIN return_requests r ON r.id = f.return_id
JOIN LATERAL (
    SELECT COALESCE(SUM(oi.unit_price * ri.quantity), 0) AS amount
    FROM return_request_items ri
    JOIN order_items oi
      ON oi.order_id = r.order_id AND oi.product_id = ri.product_id
    WHERE ri.return_id = r.id
) paid ON TRUE
WHERE f.amount <> paid.amount

UNION ALL
-- 8. A review written by an account needs a delivered purchase of that
--    product (requirement 5). Imported reviews have no account (NULL).
SELECT 'review_without_delivered_purchase', rv.id,
       'customer ' || rv.customer_id || ', product ' || rv.product_id
FROM reviews rv
WHERE rv.customer_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      WHERE o.customer_id = rv.customer_id
        AND oi.product_id = rv.product_id
        AND o.status = 'Delivered'
  )

UNION ALL
-- 9. Discounted price never exceeds the list price.
SELECT 'price_above_list_price', p.code,
       'price ' || p.price || ' > list price ' || p.list_price
FROM products p
WHERE p.price IS NOT NULL AND p.list_price IS NOT NULL AND p.price > p.list_price

ORDER BY 1, 2;
