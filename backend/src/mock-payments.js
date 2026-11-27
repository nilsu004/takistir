import { randomUUID } from 'node:crypto';

/**
 * Internal storage contract for SCRUM-58. The caller supplies the transaction
 * client and the authenticated customer ID. Only allowlisted fields reach SQL.
 * Successful amounts are always calculated from the stored purchase prices.
 */
export async function recordMockPayment(
  c,
  { customerId, checkoutKey, attemptKey, outcome, orderId = null, amount },
) {
  const { rows } = await c.query(
    `INSERT INTO mock_payment_attempts
       (id, customer_id, checkout_key, attempt_key, outcome, order_id, amount)
     VALUES ($1, $2, $3, $4, $5::varchar, $6::varchar,
       CASE WHEN $5::varchar = 'succeeded' THEN
         (SELECT sum(quantity * unit_price) FROM order_items WHERE order_id = $6::varchar)
       ELSE $7::numeric END)
     ON CONFLICT (customer_id, attempt_key) DO UPDATE
       SET attempt_key = EXCLUDED.attempt_key
       WHERE mock_payment_attempts.checkout_key = EXCLUDED.checkout_key
         AND mock_payment_attempts.outcome = EXCLUDED.outcome
         AND mock_payment_attempts.order_id IS NOT DISTINCT FROM EXCLUDED.order_id
         AND mock_payment_attempts.amount = EXCLUDED.amount
     RETURNING id, outcome, order_id, amount, currency`,
    [
      randomUUID(),
      customerId,
      checkoutKey,
      attemptKey,
      outcome,
      orderId,
      outcome === 'succeeded' ? null : amount,
    ],
  );
  if (!rows.length)
    throw Object.assign(
      new Error(
        'This payment attempt key was already used for another result.',
      ),
      { status: 409 },
    );
  return rows[0];
}
